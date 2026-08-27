/**
 * Recipe extractor — reads Fujifilm maker notes from a straight-out-of-camera
 * JPEG (or RAF) and reconstructs the film simulation recipe that shot it.
 *
 * Tag IDs and value encodings follow the exiftool FujiFilm maker-note
 * documentation (lib/Image/ExifTool/FujiFilm.pm). Everything runs in the
 * browser; the file never leaves the machine.
 *
 * Limitations: social media and most editors strip maker notes, so this only
 * works on original camera files (or full-quality copies of them).
 */

import type { PresetUIValues } from './vendor/filmkit/profile/preset-translate.ts'
import { FilmSim, WBMode, GrainEffect } from './vendor/filmkit/profile/enums.ts'

export interface ExtractResult {
  settings: Partial<PresetUIValues>
  /** Camera model string from EXIF, e.g. "X100VI" */
  cameraModel: string
  /** ISO of this particular shot (recipe ISO guidance isn't stored in EXIF) */
  iso: number | null
  /** Fields we could not extract or map */
  warnings: string[]
}

// ==========================================================================
// TIFF/IFD primitives
// ==========================================================================

interface IfdEntry {
  tag: number
  type: number
  count: number
  /** Absolute offset of the value bytes within the buffer */
  valueOffset: number
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8,
}

class TiffReader {
  constructor(
    private view: DataView,
    private le: boolean,
    /** All IFD offsets are relative to this base (TIFF header start) */
    public base: number,
  ) {}

  u16(off: number): number { return this.view.getUint16(off, this.le) }
  u32(off: number): number { return this.view.getUint32(off, this.le) }
  i32(off: number): number { return this.view.getInt32(off, this.le) }
  i16(off: number): number { return this.view.getInt16(off, this.le) }
  i8(off: number): number { return this.view.getInt8(off) }
  u8(off: number): number { return this.view.getUint8(off) }

  get byteLength(): number { return this.view.byteLength }

  /** Parse IFD entries at absolute offset */
  readIfd(absOffset: number): IfdEntry[] {
    if (absOffset + 2 > this.view.byteLength) return []
    const count = this.u16(absOffset)
    const entries: IfdEntry[] = []
    for (let i = 0; i < count; i++) {
      const e = absOffset + 2 + i * 12
      if (e + 12 > this.view.byteLength) break
      const tag = this.u16(e)
      const type = this.u16(e + 2)
      const n = this.u32(e + 4)
      const size = (TYPE_SIZES[type] ?? 1) * n
      // Values ≤ 4 bytes are stored inline; larger ones are at an offset
      const valueOffset = size <= 4 ? e + 8 : this.base + this.u32(e + 8)
      entries.push({ tag, type, count: n, valueOffset })
    }
    return entries
  }

  /** Read the first numeric value of an entry */
  num(e: IfdEntry): number | null {
    const off = e.valueOffset
    if (off + (TYPE_SIZES[e.type] ?? 1) > this.view.byteLength) return null
    switch (e.type) {
      case 1: case 7: return this.u8(off)
      case 3: return this.u16(off)
      case 4: return this.u32(off)
      case 6: return this.i8(off)
      case 8: return this.i16(off)
      case 9: return this.i32(off)
      case 5: { // RATIONAL
        const num = this.u32(off), den = this.u32(off + 4)
        return den === 0 ? null : num / den
      }
      case 10: { // SRATIONAL
        const num = this.i32(off), den = this.i32(off + 4)
        return den === 0 ? null : num / den
      }
      default: return null
    }
  }

  /** Read the nth signed 32-bit value of an entry */
  i32At(e: IfdEntry, index: number): number | null {
    const off = e.valueOffset + index * 4
    if (off + 4 > this.view.byteLength) return null
    return this.i32(off)
  }

  str(e: IfdEntry): string {
    let s = ''
    for (let i = 0; i < e.count; i++) {
      const off = e.valueOffset + i
      if (off >= this.view.byteLength) break
      const c = this.u8(off)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }
}

// ==========================================================================
// File-format scaffolding: JPEG APP1 → TIFF, RAF → embedded JPEG
// ==========================================================================

/** Find the EXIF TIFF block inside a JPEG. Returns byte offset of TIFF header, or -1. */
function findExifInJpeg(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return -1
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xFF) break
    const marker = bytes[pos + 1]
    if (marker === 0xDA || marker === 0xD9) break // start of scan / EOI
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3]
    if (marker === 0xE1 && segLen >= 8) {
      // APP1: check for "Exif\0\0"
      const p = pos + 4
      if (
        bytes[p] === 0x45 && bytes[p + 1] === 0x78 && bytes[p + 2] === 0x69 &&
        bytes[p + 3] === 0x66 && bytes[p + 4] === 0x00
      ) {
        return p + 6
      }
    }
    pos += 2 + segLen
  }
  return -1
}

/** Locate the embedded JPEG inside a Fujifilm RAF file, or null. */
function embeddedJpegInRaf(bytes: Uint8Array): Uint8Array | null {
  const magic = 'FUJIFILMCCD-RAW'
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return null
  }
  if (bytes.length < 92) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jpegOffset = view.getUint32(84, false) // RAF header is big-endian
  const jpegLength = view.getUint32(88, false)
  if (jpegOffset + jpegLength > bytes.length || jpegLength < 4) return null
  return bytes.subarray(jpegOffset, jpegOffset + jpegLength)
}

// ==========================================================================
// Fujifilm maker-note value mappings (per exiftool FujiFilm.pm)
// ==========================================================================

/** 0x1401 FilmMode → FilmSim (color simulations; B&W comes from Saturation) */
const FILM_MODE_MAP: Record<number, number> = {
  0x000: FilmSim.Provia,
  0x120: FilmSim.Astia,
  0x200: FilmSim.Velvia,
  0x400: FilmSim.Velvia,
  0x500: FilmSim.ProNegStd,
  0x501: FilmSim.ProNegHi,
  0x600: FilmSim.ClassicChrome,
  0x700: FilmSim.Eterna,
  0x800: FilmSim.ClassicNeg,
  0x900: FilmSim.EternaBleach,
  0xa00: FilmSim.NostalgicNeg,
  0xb00: FilmSim.RealaAce,
}

/** 0x1003 Saturation → B&W film sim (when monochrome) */
const SATURATION_BW_MAP: Record<number, number> = {
  0x300: FilmSim.Monochrome,
  0x301: FilmSim.MonochromeR,
  0x302: FilmSim.MonochromeYe,
  0x303: FilmSim.MonochromeG,
  0x310: FilmSim.Sepia,
  0x500: FilmSim.Acros,
  0x501: FilmSim.AcrosR,
  0x502: FilmSim.AcrosYe,
  0x503: FilmSim.AcrosG,
}

/** 0x1003 Saturation → Color value (-4..+4) for color sims */
const SATURATION_COLOR_MAP: Record<number, number> = {
  0x000: 0, 0x080: 1, 0x100: 2, 0x0c0: 3, 0x0e0: 4,
  0x180: -1, 0x400: -2, 0x4c0: -3, 0x4e0: -4,
}

/** 0x1001 Sharpness → -4..+4 */
const SHARPNESS_MAP: Record<number, number> = {
  0x00: -4, 0x01: -3, 0x02: -2, 0x82: -1, 0x03: 0, 0x84: 1, 0x04: 2, 0x05: 3, 0x06: 4,
}

/** 0x100e NoiseReduction → -4..+4 */
const NR_MAP: Record<number, number> = {
  0x000: 0, 0x100: 2, 0x180: 1, 0x1c0: 3, 0x1e0: 4,
  0x200: -2, 0x280: -1, 0x2c0: -3, 0x2e0: -4,
}

/** 0x1002 WhiteBalance → WBMode */
const WB_MAP: Record<number, number> = {
  0x000: WBMode.Auto,
  0x001: WBMode.Auto,             // Auto (white priority)
  0x002: WBMode.AmbiencePriority, // Auto (ambiance priority)
  0x100: WBMode.Daylight,
  0x200: WBMode.Shade,            // "Cloudy"
  0x300: WBMode.Fluorescent1,     // Daylight fluorescent
  0x301: WBMode.Fluorescent2,     // Day white fluorescent
  0x302: WBMode.Fluorescent3,     // White fluorescent
  0x600: WBMode.Underwater,
  0x400: WBMode.Incandescent,
  0xff0: WBMode.ColorTemp,        // Kelvin
}

/** Off/Weak/Strong encoded as 0/32/64 (grain roughness, CCE, CCFX Blue) */
function effect32(v: number): number {
  return v >= 64 ? 2 : v >= 32 ? 1 : 0
}

// ==========================================================================
// Main extractor
// ==========================================================================

export function extractRecipeFromFile(buffer: ArrayBuffer): ExtractResult {
  let bytes: Uint8Array = new Uint8Array(buffer)

  const fromRaf = embeddedJpegInRaf(bytes)
  if (fromRaf) bytes = fromRaf

  const tiffOffset = findExifInJpeg(bytes)
  if (tiffOffset < 0) {
    throw new Error('No EXIF data found — is this an unedited camera JPEG or RAF?')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const byteOrder = view.getUint16(tiffOffset, false)
  const le = byteOrder === 0x4949 // 'II'
  if (!le && byteOrder !== 0x4D4D) throw new Error('Malformed EXIF (bad byte order)')

  const tiff = new TiffReader(view, le, tiffOffset)
  const ifd0 = tiff.readIfd(tiffOffset + tiff.u32(tiffOffset + 4))

  const warnings: string[] = []
  let cameraModel = ''
  let iso: number | null = null
  let exposureBias: number | null = null
  let makerNoteEntry: IfdEntry | null = null

  const modelEntry = ifd0.find((e) => e.tag === 0x0110)
  if (modelEntry) cameraModel = tiff.str(modelEntry)

  const exifPointer = ifd0.find((e) => e.tag === 0x8769)
  if (exifPointer) {
    const exifIfd = tiff.readIfd(tiffOffset + tiff.u32(exifPointer.valueOffset))
    for (const e of exifIfd) {
      if (e.tag === 0x8827) iso = tiff.num(e)          // ISOSpeedRatings
      if (e.tag === 0x9204) exposureBias = tiff.num(e) // ExposureBiasValue
      if (e.tag === 0x927C) makerNoteEntry = e         // MakerNote
    }
  }

  if (!makerNoteEntry) {
    throw new Error(
      'No Fujifilm maker notes found — the recipe data has been stripped ' +
      '(exports from editors and social media lose it). Use an original camera file.',
    )
  }

  // Fujifilm maker note: "FUJIFILM" + uint32 LE offset to IFD.
  // All offsets inside are relative to the maker note start, always little-endian.
  const mnStart = makerNoteEntry.valueOffset
  const magic = 'FUJIFILM'
  for (let i = 0; i < magic.length; i++) {
    if (tiff.u8(mnStart + i) !== magic.charCodeAt(i)) {
      throw new Error('Maker note is not Fujifilm format')
    }
  }
  const mn = new TiffReader(view, true, mnStart)
  const mnIfdOffset = mn.u32(mnStart + 8)
  const entries = mn.readIfd(mnStart + mnIfdOffset)
  const byTag = new Map(entries.map((e) => [e.tag, e]))

  const get = (tag: number): number | null => {
    const e = byTag.get(tag)
    return e ? mn.num(e) : null
  }

  const settings: Partial<PresetUIValues> = {}

  // -- Film simulation: FilmMode for color, Saturation for B&W --
  const saturation = get(0x1003)
  const filmMode = get(0x1401)
  if (saturation !== null && SATURATION_BW_MAP[saturation] !== undefined) {
    settings.filmSimulation = SATURATION_BW_MAP[saturation]
  } else if (filmMode !== null && FILM_MODE_MAP[filmMode] !== undefined) {
    settings.filmSimulation = FILM_MODE_MAP[filmMode]
  } else {
    warnings.push('Film simulation could not be identified')
  }

  // -- Color (saturation) for color sims --
  if (saturation !== null && SATURATION_BW_MAP[saturation] === undefined) {
    const c = SATURATION_COLOR_MAP[saturation]
    if (c !== undefined) settings.color = c
  }

  // -- B&W toning (X-Trans IV+: warm/cool and magenta/green) --
  const bwAdj = get(0x1049)
  if (bwAdj !== null) settings.monoWC = bwAdj
  const bwMg = get(0x104b)
  if (bwMg !== null) settings.monoMG = bwMg

  // -- Tones: stored ×16 with inverted sign --
  const highlight = get(0x1041)
  if (highlight !== null) settings.highlightTone = -highlight / 16
  const shadow = get(0x1040)
  if (shadow !== null) settings.shadowTone = -shadow / 16

  // -- Sharpness / NR / Clarity --
  const sharp = get(0x1001)
  if (sharp !== null && SHARPNESS_MAP[sharp] !== undefined) {
    settings.sharpness = SHARPNESS_MAP[sharp]
  }
  const nr = get(0x100e)
  if (nr !== null && NR_MAP[nr] !== undefined) settings.noiseReduction = NR_MAP[nr]
  const clarity = get(0x100f)
  if (clarity !== null) settings.clarity = clarity / 1000

  // -- Grain --
  const roughness = get(0x1047)
  const grainSize = get(0x104c)
  if (roughness !== null) {
    const strength = effect32(roughness)
    if (strength === 0) {
      settings.grainEffect = GrainEffect.Off
    } else {
      const large = grainSize !== null && grainSize >= 32
      settings.grainEffect = large
        ? (strength === 1 ? GrainEffect.WeakLarge : GrainEffect.StrongLarge)
        : (strength === 1 ? GrainEffect.WeakSmall : GrainEffect.StrongSmall)
    }
  }

  // -- Color Chrome Effect / FX Blue --
  const cce = get(0x1048)
  if (cce !== null) settings.colorChrome = effect32(cce)
  const ccfxb = get(0x104e)
  if (ccfxb !== null) settings.colorChromeFxBlue = effect32(ccfxb)

  // -- White balance --
  const wb = get(0x1002)
  if (wb !== null) {
    if (wb >= 0xf00 && wb < 0xff0) {
      warnings.push('Shot used a Custom white balance — set WB manually')
    } else if (WB_MAP[wb] !== undefined) {
      settings.whiteBalance = WB_MAP[wb]
      if (WB_MAP[wb] === WBMode.ColorTemp) {
        const kelvin = get(0x1005)
        if (kelvin !== null) settings.wbColorTemp = kelvin
      }
    } else {
      warnings.push('Unrecognized white balance mode')
    }
  }

  const fineTune = byTag.get(0x100a)
  if (fineTune && fineTune.count >= 2) {
    const r = mn.i32At(fineTune, 0)
    const b = mn.i32At(fineTune, 1)
    // Newer cameras (X100VI included) store the shift ×20; older ones store it raw
    const scale = (v: number) => (v % 20 === 0 ? v / 20 : v)
    if (r !== null) settings.wbShiftR = scale(r)
    if (b !== null) settings.wbShiftB = scale(b)
  }

  // -- Dynamic range --
  const drSetting = get(0x1402)
  const devDr = get(0x1403)
  if (drSetting === 0) {
    settings.dynamicRange = 0 // Auto
  } else if (devDr !== null) {
    settings.dynamicRange = devDr >= 400 ? 3 : devDr >= 200 ? 2 : 1
  }

  // -- Exposure compensation (standard EXIF, per-shot) --
  if (exposureBias !== null) settings.exposure = Math.round(exposureBias * 100) / 100

  return { settings, cameraModel, iso, warnings }
}
