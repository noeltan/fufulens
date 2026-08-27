/**
 * Camera abstraction — the real WebUSB-backed FujiCamera from FilmKit, plus
 * a MockCamera for developing/demoing without hardware (add ?mock=1 to the
 * URL). syncSlots() drives the write-all-assigned-slots flow.
 */

import { FujiCamera, type PresetData } from './vendor/filmkit/ptp/session.ts'
import {
  translatePresetToUI,
  translateUIToPresetProps,
  PRESET_DEFAULTS,
  type PresetUIValues,
} from './vendor/filmkit/profile/preset-translate.ts'
import { MAX_PRESET_NAME_LENGTH, type Recipe } from './model.ts'

export interface CameraLike {
  readonly connected: boolean
  readonly modelName: string
  connect(): Promise<{ ok: true } | { ok: false; error: string }>
  disconnect(): Promise<void>
  scanPresets(): Promise<PresetData[]>
  writePreset(
    slot: number,
    name: string,
    settings: ReturnType<typeof translateUIToPresetProps>,
  ): Promise<{ ok: boolean; warnings: string[] }>
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

export function createCamera(log: (msg: string) => void, mock: boolean): CameraLike {
  return mock ? new MockCamera(log) : new FujiCamera(log)
}

// ==========================================================================
// Slot sync
// ==========================================================================

export interface SlotWriteResult {
  slot: number // 1-based (C1-C7)
  recipeName: string
  ok: boolean
  warnings: string[]
}

/** Camera preset names: keep it ASCII-safe and within the camera's limit */
export function presetNameForCamera(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '').trim() || 'RECIPE'
  return ascii.slice(0, MAX_PRESET_NAME_LENGTH)
}

/**
 * Write every assigned slot to the camera, one at a time, with read-back
 * verification (done inside writePreset). Unassigned slots are left alone.
 */
export async function syncSlots(
  camera: CameraLike,
  slots: (Recipe | null)[],
  onProgress: (msg: string) => void,
): Promise<SlotWriteResult[]> {
  const results: SlotWriteResult[] = []

  for (let i = 0; i < slots.length; i++) {
    const recipe = slots[i]
    if (!recipe) continue
    const slotNum = i + 1

    onProgress(`Writing C${slotNum}: ${recipe.name}…`)
    const props = translateUIToPresetProps(recipe.settings)
    try {
      const res = await camera.writePreset(slotNum, presetNameForCamera(recipe.name), props)
      results.push({ slot: slotNum, recipeName: recipe.name, ok: res.ok, warnings: res.warnings })
    } catch (err) {
      results.push({
        slot: slotNum,
        recipeName: recipe.name,
        ok: false,
        warnings: [String(err)],
      })
    }
  }

  return results
}

/** Convert a scanned camera preset into recipe-ready values */
export function cameraPresetToSettings(preset: PresetData): PresetUIValues {
  return translatePresetToUI(preset.settings)
}

// ==========================================================================
// Mock camera — in-memory X100VI for demos and development
// ==========================================================================

export class MockCamera implements CameraLike {
  connected = false
  modelName = 'X100VI (mock)'

  private presets: { name: string; values: PresetUIValues }[] = [
    { name: 'PROVIA', values: { ...PRESET_DEFAULTS, filmSimulation: 1 } },
    { name: 'Velvia', values: { ...PRESET_DEFAULTS, filmSimulation: 2 } },
    { name: 'ASTIA', values: { ...PRESET_DEFAULTS, filmSimulation: 3 } },
    { name: 'CLASSIC CHROME', values: { ...PRESET_DEFAULTS, filmSimulation: 11 } },
    { name: 'CLASSIC Neg', values: { ...PRESET_DEFAULTS, filmSimulation: 17 } },
    { name: 'ACROS', values: { ...PRESET_DEFAULTS, filmSimulation: 12 } },
    { name: 'NOSTALGIC Neg', values: { ...PRESET_DEFAULTS, filmSimulation: 19 } },
  ]

  constructor(private log: (msg: string) => void) {}

  async connect(): Promise<{ ok: true }> {
    await delay(300)
    this.connected = true
    this.log('Mock camera connected (no USB involved)')
    return { ok: true }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.log('Mock camera disconnected')
  }

  async scanPresets(): Promise<PresetData[]> {
    await delay(400)
    // Round-trip through the real translation layer so the mock exercises it
    return this.presets.map((p, i) => ({
      slot: i + 1,
      name: p.name,
      settings: withDecodedValues(translateUIToPresetProps(p.values)),
    }))
  }

  async writePreset(
    slot: number,
    name: string,
    settings: ReturnType<typeof translateUIToPresetProps>,
  ): Promise<{ ok: boolean; warnings: string[] }> {
    await delay(500)
    if (slot < 1 || slot > 7) return { ok: false, warnings: ['Invalid slot'] }
    this.presets[slot - 1] = { name, values: translatePresetToUI(withDecodedValues(settings)) }
    this.log(`Mock: wrote "${name}" to C${slot} (${settings.length} properties)`)
    return { ok: true, warnings: [] }
  }
}

/**
 * translateUIToPresetProps() fills bytes but leaves `value` at 0 (real writes
 * only need bytes). The mock reads values back, so decode int16 LE from bytes
 * the same way the real camera read path does.
 */
function withDecodedValues(
  props: ReturnType<typeof translateUIToPresetProps>,
): ReturnType<typeof translateUIToPresetProps> {
  return props.map((p) => {
    if (p.bytes.length !== 2) return p
    const view = new DataView(p.bytes.buffer, p.bytes.byteOffset, p.bytes.byteLength)
    return { ...p, value: view.getInt16(0, true) }
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
