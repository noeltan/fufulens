import { describe, it, expect } from 'vitest'
import { parseTextPreset } from '../src/vendor/filmkit/parse-text-preset.ts'
import { FilmSim, WBMode, GrainEffect } from '../src/vendor/filmkit/profile/enums.ts'

describe('paste-a-recipe parser', () => {
  it('parses a Fuji X Weekly style recipe', () => {
    const text = `
      Classic Chrome
      Dynamic Range: DR400
      Grain Effect: Weak
      Color Chrome Effect: Strong
      Color Chrome Effect Blue: Weak
      White Balance: Daylight, +2 Red & -5 Blue
      Highlight: -1
      Shadow: -2
      Color: +2
      Sharpness: -2
      Noise Reduction: -4
      Clarity: +2
      ISO: Auto, up to ISO 6400
      Exposure Compensation: +1/3 to +1 (typically)
    `
    const { values, unrecognized, ignored } = parseTextPreset(text)

    expect(values.filmSimulation).toBe(FilmSim.ClassicChrome)
    expect(values.dynamicRange).toBe(3)
    expect(values.grainEffect).toBe(GrainEffect.WeakSmall)
    expect(values.colorChrome).toBe(2)
    expect(values.colorChromeFxBlue).toBe(1)
    expect(values.whiteBalance).toBe(WBMode.Daylight)
    expect(values.wbShiftR).toBe(2)
    expect(values.wbShiftB).toBe(-5)
    expect(values.highlightTone).toBe(-1)
    expect(values.shadowTone).toBe(-2)
    expect(values.color).toBe(2)
    expect(values.sharpness).toBe(-2)
    expect(values.noiseReduction).toBe(-4)
    expect(values.clarity).toBe(2)
    expect(values.exposure).toBe(1)
    expect(ignored.length).toBe(1) // ISO line
    expect(unrecognized.length).toBe(0)
  })

  it('parses Kelvin white balance with shift', () => {
    const { values } = parseTextPreset('White Balance: 3200K, -2 Red & +3 Blue')
    expect(values.whiteBalance).toBe(WBMode.ColorTemp)
    expect(values.wbColorTemp).toBe(3200)
    expect(values.wbShiftR).toBe(-2)
    expect(values.wbShiftB).toBe(3)
  })

  it('parses grain with size and film sim aliases', () => {
    const { values } = parseTextPreset(`
      Film Simulation: Classic Negative
      Grain: Strong, Large
    `)
    expect(values.filmSimulation).toBe(FilmSim.ClassicNeg)
    expect(values.grainEffect).toBe(GrainEffect.StrongLarge)
  })

  it('parses Acros filter variants', () => {
    const { values } = parseTextPreset('Film Simulation: Acros + Red Filter')
    expect(values.filmSimulation).toBe(FilmSim.AcrosR)
  })

  it('reports unrecognized lines instead of guessing', () => {
    const { values, unrecognized } = parseTextPreset('Bokeh Amount: Maximum')
    expect(Object.keys(values).length).toBe(0)
    expect(unrecognized).toEqual(['Bokeh Amount: Maximum'])
  })
})
