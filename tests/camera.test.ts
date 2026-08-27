import { describe, it, expect } from 'vitest'
import { MockCamera, presetNameForCamera, syncSlots } from '../src/camera.ts'
import {
  translateUIToPresetProps,
  translatePresetToUI,
  PRESET_DEFAULTS,
} from '../src/vendor/filmkit/profile/preset-translate.ts'
import { FilmSim, WBMode, GrainEffect } from '../src/vendor/filmkit/profile/enums.ts'
import { createRecipe } from '../src/model.ts'

const noop = () => {}

describe('preset translation round-trip', () => {
  it('preserves a color recipe through write encoding and back', () => {
    const values = {
      ...PRESET_DEFAULTS,
      filmSimulation: FilmSim.ClassicChrome,
      dynamicRange: 2,
      grainEffect: GrainEffect.WeakSmall,
      colorChrome: 2,
      colorChromeFxBlue: 1,
      whiteBalance: WBMode.Daylight,
      wbShiftR: 2,
      wbShiftB: -5,
      highlightTone: 1,
      shadowTone: -1.5,
      color: 2,
      sharpness: -2,
      noiseReduction: -4,
      clarity: 3,
    }

    const props = translateUIToPresetProps(values)
    // Decode the way the camera read path would (int16 LE from bytes)
    const decoded = props.map((p) => {
      if (p.bytes.length !== 2) return p
      const v = new DataView(p.bytes.buffer, p.bytes.byteOffset, 2).getInt16(0, true)
      return { ...p, value: v }
    })
    const back = translatePresetToUI(decoded)

    expect(back.filmSimulation).toBe(FilmSim.ClassicChrome)
    expect(back.dynamicRange).toBe(2)
    expect(back.grainEffect).toBe(GrainEffect.WeakSmall)
    expect(back.colorChrome).toBe(2)
    expect(back.colorChromeFxBlue).toBe(1)
    expect(back.whiteBalance).toBe(WBMode.Daylight)
    expect(back.wbShiftR).toBe(2)
    expect(back.wbShiftB).toBe(-5)
    expect(back.highlightTone).toBe(1)
    expect(back.shadowTone).toBe(-1.5)
    expect(back.color).toBe(2)
    expect(back.sharpness).toBe(-2)
    expect(back.noiseReduction).toBe(-4)
    expect(back.clarity).toBe(3)
  })

  it('omits Color for monochrome sims and keeps toning', () => {
    const values = {
      ...PRESET_DEFAULTS,
      filmSimulation: FilmSim.Acros,
      monoWC: 3,
      monoMG: -2,
      color: 4, // should not be written for B&W
    }
    const props = translateUIToPresetProps(values)
    expect(props.find((p) => p.id === 0xd19f)).toBeUndefined()
    expect(props.find((p) => p.id === 0xd193)).toBeDefined()
    expect(props.find((p) => p.id === 0xd194)).toBeDefined()
  })

  it('writes Kelvin color temp only in ColorTemp WB mode', () => {
    const kelvin = translateUIToPresetProps({
      ...PRESET_DEFAULTS,
      whiteBalance: WBMode.ColorTemp,
      wbColorTemp: 3200,
    })
    expect(kelvin.find((p) => p.id === 0xd19c)).toBeDefined()

    const auto = translateUIToPresetProps({ ...PRESET_DEFAULTS, whiteBalance: WBMode.Auto })
    expect(auto.find((p) => p.id === 0xd19c)).toBeUndefined()
  })
})

describe('camera sync', () => {
  it('writes assigned slots to the mock camera and verifies', async () => {
    const cam = new MockCamera(noop)
    await cam.connect()

    const recipe = createRecipe({
      name: 'Kodachrome 64',
      settings: { ...PRESET_DEFAULTS, filmSimulation: FilmSim.ClassicChrome, color: 2 },
    })
    const slots = [null, recipe, null, null, null, null, null]

    const results = await syncSlots(cam, slots, noop)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ slot: 2, ok: true })

    const presets = await cam.scanPresets()
    expect(presets[1].name).toBe('Kodachrome 64')
    expect(translatePresetToUI(presets[1].settings).filmSimulation).toBe(FilmSim.ClassicChrome)
    expect(translatePresetToUI(presets[1].settings).color).toBe(2)
  })

  it('sanitizes preset names for the camera', () => {
    expect(presetNameForCamera('Kodachrome 64 ★✨')).toBe('Kodachrome 64')
    expect(presetNameForCamera('')).toBe('RECIPE')
    expect(presetNameForCamera('A very long recipe name that exceeds limits')).toHaveLength(25)
  })
})
