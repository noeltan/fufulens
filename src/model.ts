/**
 * Recipe data model.
 *
 * A Recipe wraps the camera-compatible settings (PresetUIValues from the
 * vendored FilmKit translation layer) with library metadata: name, source
 * credit, notes, favorite flag. Settings use FilmKit's UI encoding, which
 * translates 1:1 to the camera's C1-C7 preset properties.
 */

import {
  PRESET_DEFAULTS,
  type PresetUIValues,
} from './vendor/filmkit/profile/preset-translate.ts'
import {
  FilmSimLabels,
  WBModeLabels,
  DynRangeLabels,
  GrainEffect,
  WBMode,
  MONOCHROME_SIMS,
} from './vendor/filmkit/profile/enums.ts'

export interface Recipe {
  id: string
  name: string
  /** Where the recipe came from: URL or free-text credit */
  source: string
  notes: string
  favorite: boolean
  createdAt: string
  settings: PresetUIValues
}

export const SLOT_COUNT = 7

/** Camera preset names are limited; keep writes safe */
export const MAX_PRESET_NAME_LENGTH = 25

export function newRecipeId(): string {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

export function createRecipe(partial: Partial<Recipe> & { name: string }): Recipe {
  return {
    id: partial.id ?? newRecipeId(),
    name: partial.name,
    source: partial.source ?? '',
    notes: partial.notes ?? '',
    favorite: partial.favorite ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    settings: { ...PRESET_DEFAULTS, ...partial.settings },
  }
}

// ==========================================================================
// Display helpers
// ==========================================================================

const GRAIN_LABELS: Record<number, string> = {
  [GrainEffect.Off]: 'Off',
  [GrainEffect.WeakSmall]: 'Weak / Small',
  [GrainEffect.StrongSmall]: 'Strong / Small',
  [GrainEffect.WeakLarge]: 'Weak / Large',
  [GrainEffect.StrongLarge]: 'Strong / Large',
}

const EFFECT_LABELS: Record<number, string> = { 0: 'Off', 1: 'Weak', 2: 'Strong' }

function signed(n: number): string {
  return (n > 0 ? '+' : '') + n
}

export function filmSimName(settings: PresetUIValues): string {
  return FilmSimLabels[settings.filmSimulation] ?? 'Unknown'
}

export function isMonochrome(settings: PresetUIValues): boolean {
  return MONOCHROME_SIMS.has(settings.filmSimulation)
}

/** Human-readable summary lines for a recipe card / detail view */
export function describeSettings(s: PresetUIValues): [string, string][] {
  const out: [string, string][] = []
  out.push(['Film Simulation', filmSimName(s)])
  out.push(['Dynamic Range', s.dynamicRange === 0 ? 'Auto' : (DynRangeLabels[s.dynamicRange] ?? 'Auto')])

  let wb = WBModeLabels[s.whiteBalance] ?? 'Auto'
  if (s.whiteBalance === WBMode.ColorTemp) wb = `${s.wbColorTemp}K`
  out.push(['White Balance', `${wb}, ${signed(s.wbShiftR)} Red & ${signed(s.wbShiftB)} Blue`])

  out.push(['Highlight', signed(s.highlightTone)])
  out.push(['Shadow', signed(s.shadowTone)])
  if (isMonochrome(s)) {
    out.push(['Mono WC / MG', `${signed(s.monoWC)} / ${signed(s.monoMG)}`])
  } else {
    out.push(['Color', signed(s.color)])
  }
  out.push(['Sharpness', signed(s.sharpness)])
  out.push(['Noise Reduction', signed(s.noiseReduction)])
  out.push(['Clarity', signed(s.clarity)])
  out.push(['Grain Effect', GRAIN_LABELS[s.grainEffect] ?? 'Off'])
  out.push(['Color Chrome Effect', EFFECT_LABELS[s.colorChrome] ?? 'Off'])
  out.push(['Color Chrome FX Blue', EFFECT_LABELS[s.colorChromeFxBlue] ?? 'Off'])
  if (s.exposure !== 0) {
    const ev = s.exposure > 0 ? `+${formatEv(s.exposure)}` : formatEv(s.exposure)
    out.push(['Exposure Comp.', `${ev} (typical)`])
  }
  return out
}

function formatEv(v: number): string {
  // Render thirds as fractions where possible: 0.33 → 1/3
  const thirds = Math.round(v * 3)
  if (Math.abs(thirds / 3 - v) < 0.05 && thirds % 3 !== 0) {
    const whole = Math.trunc(thirds / 3)
    const frac = Math.abs(thirds % 3)
    const fracStr = `${frac}/3`
    return whole !== 0 ? `${whole} ${fracStr}` : (v < 0 ? `-${fracStr}` : fracStr)
  }
  return String(Math.round(v * 100) / 100)
}

// ==========================================================================
// JSON import/export
// ==========================================================================

export interface ExportFile {
  app: string
  version: 1
  exportedAt: string
  recipes: Recipe[]
}

export function exportRecipes(recipes: Recipe[]): string {
  const file: ExportFile = {
    app: 'fuji-recipes',
    version: 1,
    exportedAt: new Date().toISOString(),
    recipes,
  }
  return JSON.stringify(file, null, 2)
}

/** Parse an export file (or a bare recipe array). Throws on malformed input. */
export function importRecipes(json: string): Recipe[] {
  const data = JSON.parse(json)
  const list: unknown[] = Array.isArray(data) ? data : data?.recipes
  if (!Array.isArray(list)) throw new Error('Not a recipe export file')

  return list.map((raw) => {
    const r = raw as Partial<Recipe>
    if (typeof r.name !== 'string' || !r.name) throw new Error('Recipe missing name')
    if (typeof r.settings !== 'object' || r.settings === null) {
      throw new Error(`Recipe "${r.name}" missing settings`)
    }
    // Keep only known settings keys, coerce to numbers
    const settings = { ...PRESET_DEFAULTS }
    for (const key of Object.keys(PRESET_DEFAULTS) as (keyof PresetUIValues)[]) {
      const v = (r.settings as unknown as Record<string, unknown>)[key]
      if (typeof v === 'number' && isFinite(v)) settings[key] = v
    }
    return createRecipe({
      id: typeof r.id === 'string' ? r.id : undefined,
      name: r.name,
      source: typeof r.source === 'string' ? r.source : '',
      notes: typeof r.notes === 'string' ? r.notes : '',
      favorite: r.favorite === true,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : undefined,
      settings,
    })
  })
}
