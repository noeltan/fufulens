/**
 * Starter recipe library — seeded on first run.
 *
 * These are widely shared community film simulation recipes (settings lists
 * are community-documented facts; each entry credits its creator). Settings
 * cross-checked against the open-fuji-recipes community dataset. Most were
 * designed on X-Trans IV/V and work as-is on the X100VI. Users can edit or
 * delete freely.
 */

import type { Recipe } from './model.ts'
import { FilmSim, WBMode, GrainEffect } from './vendor/filmkit/profile/enums.ts'
import { PRESET_DEFAULTS } from './vendor/filmkit/profile/preset-translate.ts'

type Seed = Omit<Recipe, 'id' | 'createdAt' | 'favorite'>

function seed(s: {
  name: string
  source: string
  notes: string
  settings: Partial<Recipe['settings']>
}): Seed {
  return {
    name: s.name,
    source: s.source,
    notes: s.notes,
    settings: { ...PRESET_DEFAULTS, ...s.settings },
  }
}

const FXW = 'Fuji X Weekly (Ritchie Roesch) — fujixweekly.com'

export const STARTER_RECIPES: Seed[] = [
  seed({
    name: 'Kodachrome 64 (V2)',
    source: FXW,
    notes: 'The classic Kodachrome slide-film look. Exposure comp. typically +2/3.',
    settings: {
      filmSimulation: FilmSim.ClassicChrome,
      dynamicRange: 2, // DR200
      whiteBalance: WBMode.Daylight,
      wbShiftR: 2, wbShiftB: -5,
      highlightTone: 0, shadowTone: 0,
      color: 2, sharpness: 1, noiseReduction: -4, clarity: 0,
      grainEffect: GrainEffect.WeakSmall,
      colorChrome: 2, colorChromeFxBlue: 1,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Kodak Portra 400',
    source: FXW,
    notes: 'Soft, warm portrait negative film look. Exposure comp. typically +1/3 to +1.',
    settings: {
      filmSimulation: FilmSim.ClassicChrome,
      dynamicRange: 0, // Auto
      whiteBalance: WBMode.Daylight,
      wbShiftR: 3, wbShiftB: -5,
      highlightTone: -1, shadowTone: -2,
      color: 2, sharpness: -2, noiseReduction: -4, clarity: 2,
      grainEffect: GrainEffect.StrongSmall,
      colorChrome: 2, colorChromeFxBlue: 1,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Kodak Portra 160',
    source: FXW,
    notes: 'Lower-contrast, fine-grain portrait film. Exposure comp. typically +1/3 to +1.',
    settings: {
      filmSimulation: FilmSim.ClassicChrome,
      dynamicRange: 0,
      whiteBalance: WBMode.Daylight,
      wbShiftR: 4, wbShiftB: -5,
      highlightTone: -2, shadowTone: -2,
      color: 1, sharpness: -2, noiseReduction: -4, clarity: 0,
      grainEffect: GrainEffect.WeakSmall,
      colorChrome: 0, colorChromeFxBlue: 0,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Fujicolor Reala 100',
    source: FXW,
    notes: 'Neutral, true-to-life color negative film. Exposure comp. typically +1/3 to +1.',
    settings: {
      filmSimulation: FilmSim.ClassicNeg,
      dynamicRange: 3, // DR400
      whiteBalance: WBMode.Daylight,
      wbShiftR: 0, wbShiftB: 0,
      highlightTone: -1, shadowTone: -1,
      color: 0, sharpness: -2, noiseReduction: -4, clarity: -3,
      grainEffect: GrainEffect.WeakSmall,
      colorChrome: 2, colorChromeFxBlue: 2,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Fujicolor Superia 800',
    source: FXW,
    notes: 'Gritty high-speed consumer film look. Exposure comp. typically +2/3.',
    settings: {
      filmSimulation: FilmSim.ClassicNeg,
      dynamicRange: 3,
      whiteBalance: WBMode.Daylight,
      wbShiftR: -1, wbShiftB: -3,
      highlightTone: -1, shadowTone: 1,
      color: -1, sharpness: -1, noiseReduction: -4, clarity: -4,
      grainEffect: GrainEffect.StrongLarge,
      colorChrome: 2, colorChromeFxBlue: 1,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Kodak Tri-X 400',
    source: FXW,
    notes: 'Classic gritty black & white. WB shift adds subtle warm toning. Exposure comp. typically +1/3 to +1.',
    settings: {
      filmSimulation: FilmSim.Acros,
      dynamicRange: 2,
      whiteBalance: WBMode.Daylight,
      wbShiftR: 9, wbShiftB: -9,
      highlightTone: 0, shadowTone: 3,
      color: 0, sharpness: 1, noiseReduction: -4, clarity: 4,
      grainEffect: GrainEffect.StrongLarge,
      colorChrome: 2, colorChromeFxBlue: 0,
      exposure: 0.67,
    },
  }),
  seed({
    name: 'Velvia',
    source: FXW,
    notes: 'Punchy, saturated landscape slide film. Exposure comp. typically -1/3.',
    settings: {
      filmSimulation: FilmSim.Velvia,
      dynamicRange: 0,
      whiteBalance: WBMode.Auto,
      wbShiftR: 1, wbShiftB: -1,
      highlightTone: 0, shadowTone: 1,
      color: 3, sharpness: 2, noiseReduction: -4, clarity: 0,
      grainEffect: GrainEffect.WeakSmall,
      colorChrome: 2, colorChromeFxBlue: 0,
      exposure: -0.33,
    },
  }),
]
