/**
 * Fuji Recipes — app UI.
 *
 * Two views: the recipe Library and the Camera (C1-C7 slots + USB sync).
 * Rendering is plain DOM: state changes call render() to rebuild the view.
 */

import './style.css'

import { Library } from './store.ts'
import {
  createRecipe,
  describeSettings,
  exportRecipes,
  filmSimName,
  importRecipes,
  type Recipe,
} from './model.ts'
import {
  FilmSimLabels,
  WBModeLabels,
  WBMode,
  GrainEffect,
} from './vendor/filmkit/profile/enums.ts'
import {
  PRESET_DEFAULTS,
  type PresetUIValues,
} from './vendor/filmkit/profile/preset-translate.ts'
import { parseTextPreset, FIELD_LABELS } from './vendor/filmkit/parse-text-preset.ts'
import { extractRecipeFromFile } from './exif.ts'
import {
  cameraPresetToSettings,
  createCamera,
  isWebUsbSupported,
  syncSlots,
  type CameraLike,
  type SlotWriteResult,
} from './camera.ts'
import type { PresetData } from './vendor/filmkit/ptp/session.ts'

// ==========================================================================
// State
// ==========================================================================

const lib = new Library()

type View = 'library' | 'camera'
let view: View = 'library'
let search = ''

const mockMode = new URLSearchParams(location.search).has('mock')
let camera: CameraLike | null = null
let cameraLogLines: string[] = []
let cameraPresets: PresetData[] = []
let slotResults = new Map<number, SlotWriteResult>()
let busy = false

function log(msg: string): void {
  cameraLogLines.push(msg)
  if (cameraLogLines.length > 200) cameraLogLines = cameraLogLines.slice(-200)
  const el = document.querySelector('.log')
  if (el) {
    el.textContent = cameraLogLines.join('\n')
    el.scrollTop = el.scrollHeight
  }
}

lib.onChange(render)

// ==========================================================================
// Tiny DOM helper
// ==========================================================================

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((ev: Event) => void)> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      el.addEventListener(key.replace(/^on/, ''), value)
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '')
    } else {
      el.setAttribute(key, value)
    }
  }
  for (const child of children) {
    if (child === null) continue
    el.append(child)
  }
  return el
}

// ==========================================================================
// Root render
// ==========================================================================

const root = document.getElementById('app')!

function render(): void {
  root.replaceChildren(
    h(
      'header',
      { class: 'app-header' },
      h('h1', {}, 'Fuji ', h('span', {}, 'Recipes')),
      h(
        'nav',
        { class: 'tabs' },
        tabButton('library', 'Library'),
        tabButton('camera', 'Camera'),
      ),
    ),
    h('main', {}, view === 'library' ? renderLibrary() : renderCamera()),
    h(
      'footer',
      {},
      'Recipes are stored locally in your browser. USB protocol based on ',
      h('a', { href: 'https://github.com/eggricesoy/filmkit', target: '_blank' }, 'FilmKit'),
      ' (MIT). Not affiliated with FUJIFILM.',
    ),
  )
}

function tabButton(target: View, label: string): HTMLButtonElement {
  return h(
    'button',
    {
      class: view === target ? 'active' : '',
      onclick: () => {
        view = target
        render()
      },
    },
    label,
  )
}

// ==========================================================================
// Library view
// ==========================================================================

function renderLibrary(): HTMLElement {
  const container = h('div', {})

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('input', {
      type: 'search',
      placeholder: 'Search recipes…',
      value: search,
      oninput: (ev) => {
        search = (ev.target as HTMLInputElement).value
        renderCards()
      },
    }),
    h('button', { class: 'primary', onclick: () => openRecipeForm() }, '+ New recipe'),
    h('button', { onclick: openPasteDialog }, 'Paste recipe'),
    h('button', { onclick: openPhotoDialog }, 'From photo'),
    h('button', { onclick: doImport }, 'Import'),
    h('button', { onclick: doExport }, 'Export'),
  )

  const grid = h('div', { class: 'grid' })

  function renderCards(): void {
    const q = search.trim().toLowerCase()
    const recipes = lib
      .all()
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          filmSimName(r.settings).toLowerCase().includes(q) ||
          r.source.toLowerCase().includes(q),
      )
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))

    grid.replaceChildren(
      ...(recipes.length
        ? recipes.map(recipeCard)
        : [h('div', { class: 'empty' }, 'No recipes yet. Add one, paste one, or drop in a photo.')]),
    )
  }

  renderCards()
  container.append(toolbar, grid)
  return container
}

function recipeCard(recipe: Recipe): HTMLElement {
  const s = recipe.settings
  const lines = describeSettings(s).slice(1, 5)
  return h(
    'div',
    { class: 'card', onclick: () => openDetailDialog(recipe) },
    h(
      'div',
      { class: 'card-head' },
      h('h3', {}, recipe.name),
      h(
        'button',
        {
          class: 'fav-btn' + (recipe.favorite ? ' on' : ''),
          title: 'Favorite',
          onclick: (ev) => {
            ev.stopPropagation()
            lib.toggleFavorite(recipe.id)
          },
        },
        recipe.favorite ? '★' : '☆',
      ),
    ),
    h('span', { class: 'chip' }, filmSimName(s)),
    h('div', { class: 'summary' }, ...lines.map(([k, v]) => h('div', {}, `${k}: ${v}`))),
    recipe.source ? h('div', { class: 'source' }, recipe.source) : null,
  )
}

// ==========================================================================
// Recipe detail dialog
// ==========================================================================

function showDialog(dialog: HTMLDialogElement): void {
  document.body.append(dialog)
  dialog.addEventListener('close', () => dialog.remove())
  dialog.showModal()
}

function openDetailDialog(recipe: Recipe): void {
  const dialog = h(
    'dialog',
    {},
    h('h2', {}, recipe.name),
    recipe.source ? h('p', { class: 'hint' }, `Source: ${recipe.source}`) : null,
    recipe.notes ? h('p', {}, recipe.notes) : null,
    h(
      'table',
      { class: 'settings-table' },
      ...describeSettings(recipe.settings).map(([k, v]) =>
        h('tr', {}, h('td', {}, k), h('td', {}, v)),
      ),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            if (confirm(`Delete "${recipe.name}"?`)) {
              dialog.close()
              lib.remove(recipe.id)
            }
          },
        },
        'Delete',
      ),
      h(
        'button',
        {
          onclick: () => {
            dialog.close()
            openRecipeForm(recipe)
          },
        },
        'Edit',
      ),
      h('button', { class: 'primary', onclick: () => dialog.close() }, 'Close'),
    ),
  )
  showDialog(dialog)
}

// ==========================================================================
// Recipe form (create / edit / confirm-extracted)
// ==========================================================================

interface FormPrefill {
  name?: string
  source?: string
  notes?: string
  settings?: Partial<PresetUIValues>
}

function openRecipeForm(existing?: Recipe, prefill?: FormPrefill): void {
  const initial: PresetUIValues = {
    ...PRESET_DEFAULTS,
    ...(existing?.settings ?? {}),
    ...(prefill?.settings ?? {}),
  }

  const nameInput = h('input', {
    type: 'text',
    value: existing?.name ?? prefill?.name ?? '',
    placeholder: 'Recipe name',
  })
  const sourceInput = h('input', {
    type: 'text',
    value: existing?.source ?? prefill?.source ?? '',
    placeholder: 'Source / credit (optional)',
  })
  const notesInput = h('textarea', { rows: '2', placeholder: 'Notes (optional)' })
  notesInput.value = existing?.notes ?? prefill?.notes ?? ''

  const fields = buildSettingsFields(initial)

  const dialog = h(
    'dialog',
    {},
    h('h2', {}, existing ? 'Edit recipe' : 'New recipe'),
    h(
      'div',
      { class: 'form-grid' },
      h('div', { class: 'field wide' }, h('label', {}, 'Name'), nameInput),
      h('div', { class: 'field wide' }, h('label', {}, 'Source'), sourceInput),
      ...fields.elements,
      h('div', { class: 'field wide' }, h('label', {}, 'Notes'), notesInput),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { onclick: () => dialog.close() }, 'Cancel'),
      h(
        'button',
        {
          class: 'primary',
          onclick: () => {
            const name = nameInput.value.trim()
            if (!name) {
              nameInput.focus()
              return
            }
            const recipe = createRecipe({
              ...(existing ?? {}),
              name,
              source: sourceInput.value.trim(),
              notes: notesInput.value.trim(),
              settings: fields.read(),
            })
            if (existing) lib.update(recipe)
            else lib.add(recipe)
            dialog.close()
          },
        },
        existing ? 'Save' : 'Add to library',
      ),
    ),
  )
  showDialog(dialog)
}

interface SettingsFields {
  elements: HTMLElement[]
  read: () => PresetUIValues
}

function buildSettingsFields(initial: PresetUIValues): SettingsFields {
  const inputs = new Map<keyof PresetUIValues, HTMLInputElement | HTMLSelectElement>()

  function selectField(
    key: keyof PresetUIValues,
    label: string,
    options: [number, string][],
  ): HTMLElement {
    const select = h('select', {})
    for (const [value, text] of options) {
      const opt = h('option', { value: String(value) }, text)
      if (initial[key] === value) opt.selected = true
      select.append(opt)
    }
    inputs.set(key, select)
    return h('div', { class: 'field' }, h('label', {}, label), select)
  }

  function numberField(
    key: keyof PresetUIValues,
    label: string,
    min: number,
    max: number,
    step = 1,
  ): HTMLElement {
    const input = h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(initial[key]),
    })
    inputs.set(key, input)
    return h('div', { class: 'field' }, h('label', {}, label), input)
  }

  const filmSims: [number, string][] = Object.entries(FilmSimLabels)
    .map(([v, l]) => [Number(v), l] as [number, string])
    .sort((a, b) => a[0] - b[0])

  const wbModes: [number, string][] = [
    WBMode.Auto,
    WBMode.AmbiencePriority,
    WBMode.Daylight,
    WBMode.Shade,
    WBMode.Fluorescent1,
    WBMode.Fluorescent2,
    WBMode.Fluorescent3,
    WBMode.Incandescent,
    WBMode.Underwater,
    WBMode.ColorTemp,
  ].map((v) => [v, WBModeLabels[v]] as [number, string])

  const elements = [
    selectField('filmSimulation', 'Film Simulation', filmSims),
    selectField('dynamicRange', 'Dynamic Range', [
      [0, 'Auto'],
      [1, 'DR100'],
      [2, 'DR200'],
      [3, 'DR400'],
    ]),
    selectField('whiteBalance', 'White Balance', wbModes),
    numberField('wbColorTemp', 'Color Temp (K)', 2500, 10000, 10),
    numberField('wbShiftR', 'WB Shift Red', -9, 9),
    numberField('wbShiftB', 'WB Shift Blue', -9, 9),
    numberField('highlightTone', 'Highlight', -2, 4, 0.5),
    numberField('shadowTone', 'Shadow', -2, 4, 0.5),
    numberField('color', 'Color', -4, 4),
    numberField('sharpness', 'Sharpness', -4, 4),
    numberField('noiseReduction', 'High ISO NR', -4, 4),
    numberField('clarity', 'Clarity', -5, 5),
    selectField('grainEffect', 'Grain Effect', [
      [GrainEffect.Off, 'Off'],
      [GrainEffect.WeakSmall, 'Weak / Small'],
      [GrainEffect.StrongSmall, 'Strong / Small'],
      [GrainEffect.WeakLarge, 'Weak / Large'],
      [GrainEffect.StrongLarge, 'Strong / Large'],
    ]),
    selectField('colorChrome', 'Color Chrome Effect', [
      [0, 'Off'],
      [1, 'Weak'],
      [2, 'Strong'],
    ]),
    selectField('colorChromeFxBlue', 'Color Chrome FX Blue', [
      [0, 'Off'],
      [1, 'Weak'],
      [2, 'Strong'],
    ]),
    numberField('monoWC', 'Mono Warm/Cool (B&W)', -9, 9),
    numberField('monoMG', 'Mono Magenta/Green (B&W)', -9, 9),
    numberField('exposure', 'Exposure Comp. (typical)', -5, 5, 0.01),
  ]

  return {
    elements,
    read: () => {
      const out = { ...PRESET_DEFAULTS }
      for (const [key, input] of inputs) {
        const n = Number(input.value)
        if (isFinite(n)) out[key] = n
      }
      return out
    },
  }
}

// ==========================================================================
// Paste-a-recipe dialog
// ==========================================================================

function openPasteDialog(): void {
  const nameInput = h('input', { type: 'text', placeholder: 'Recipe name' })
  const textarea = h('textarea', {
    rows: '10',
    placeholder:
      'Paste a recipe from any website, e.g.\n\n' +
      'Film Simulation: Classic Chrome\nDynamic Range: DR200\nHighlight: +1\nShadow: +1\n' +
      'Color: +2\nGrain Effect: Weak, Small\nWhite Balance: Daylight, +2 Red & -5 Blue\n…',
  })
  const report = h('div', { class: 'parse-report' })
  const continueBtn = h('button', { class: 'primary', disabled: true }, 'Review & save')

  let parsedValues: Partial<PresetUIValues> = {}

  function reparse(): void {
    const text = textarea.value
    if (!text.trim()) {
      report.replaceChildren()
      continueBtn.disabled = true
      return
    }
    const result = parseTextPreset(text)
    parsedValues = result.values

    const rows: HTMLElement[] = []
    for (const { fields } of result.recognized) {
      for (const f of fields) {
        rows.push(h('div', { class: 'ok' }, `✓ ${FIELD_LABELS[f] ?? f}`))
      }
    }
    for (const line of result.unrecognized) {
      rows.push(h('div', { class: 'miss' }, `? Not recognized: "${line}"`))
    }
    for (const line of result.ignored) {
      rows.push(h('div', {}, `– Ignored (not a camera preset field): "${line}"`))
    }
    report.replaceChildren(...rows)
    continueBtn.disabled = Object.keys(parsedValues).length === 0
  }

  textarea.addEventListener('input', reparse)

  continueBtn.addEventListener('click', () => {
    dialog.close()
    openRecipeForm(undefined, {
      name: nameInput.value.trim(),
      settings: parsedValues,
    })
  })

  const dialog = h(
    'dialog',
    {},
    h('h2', {}, 'Paste a recipe'),
    h('p', { class: 'hint' }, 'Copy recipe text from any blog or website and paste it below — fields are detected automatically. You can fix anything on the next screen.'),
    h(
      'div',
      { class: 'form-grid' },
      h('div', { class: 'field wide' }, h('label', {}, 'Name'), nameInput),
      h('div', { class: 'field wide' }, h('label', {}, 'Recipe text'), textarea),
    ),
    report,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { onclick: () => dialog.close() }, 'Cancel'),
      continueBtn,
    ),
  )
  showDialog(dialog)
}

// ==========================================================================
// From-photo dialog
// ==========================================================================

function openPhotoDialog(): void {
  const fileInput = h('input', { type: 'file', accept: '.jpg,.jpeg,.raf,image/jpeg' })
  const report = h('div', { class: 'parse-report' })
  const continueBtn = h('button', { class: 'primary', disabled: true }, 'Review & save')

  let extracted: FormPrefill | null = null

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    report.replaceChildren(h('div', {}, 'Reading…'))
    continueBtn.disabled = true
    try {
      const result = extractRecipeFromFile(await file.arrayBuffer())
      extracted = {
        name: file.name.replace(/\.(jpe?g|raf)$/i, ''),
        source: result.cameraModel ? `Extracted from photo (${result.cameraModel})` : 'Extracted from photo',
        settings: result.settings,
      }
      const rows: HTMLElement[] = []
      if (result.cameraModel) rows.push(h('div', { class: 'ok' }, `✓ Camera: ${result.cameraModel}`))
      for (const key of Object.keys(result.settings)) {
        rows.push(h('div', { class: 'ok' }, `✓ ${FIELD_LABELS[key] ?? key}`))
      }
      if (result.iso !== null) rows.push(h('div', {}, `– Shot at ISO ${result.iso}`))
      for (const w of result.warnings) rows.push(h('div', { class: 'miss' }, `! ${w}`))
      report.replaceChildren(...rows)
      continueBtn.disabled = false
    } catch (err) {
      extracted = null
      report.replaceChildren(h('div', { class: 'miss' }, String(err instanceof Error ? err.message : err)))
    }
  })

  continueBtn.addEventListener('click', () => {
    if (!extracted) return
    dialog.close()
    openRecipeForm(undefined, extracted)
  })

  const dialog = h(
    'dialog',
    {},
    h('h2', {}, 'Extract recipe from a photo'),
    h(
      'p',
      { class: 'hint' },
      'Pick a straight-out-of-camera Fujifilm JPEG (or RAF). The recipe is read from the photo’s metadata, entirely on your device. Exports from editors or social media won’t work — they strip the data.',
    ),
    h('div', { class: 'form-grid' }, h('div', { class: 'field wide' }, fileInput)),
    report,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { onclick: () => dialog.close() }, 'Cancel'),
      continueBtn,
    ),
  )
  showDialog(dialog)
}

// ==========================================================================
// Import / export
// ==========================================================================

function doExport(): void {
  const blob = new Blob([exportRecipes(lib.all())], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: 'fuji-recipes.json' })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function doImport(): void {
  const input = h('input', { type: 'file', accept: '.json,application/json' })
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const recipes = importRecipes(await file.text())
      const added = lib.addMany(recipes)
      alert(`Imported ${added} recipe${added === 1 ? '' : 's'}.`)
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`)
    }
  })
  input.click()
}

// ==========================================================================
// Camera view
// ==========================================================================

function renderCamera(): HTMLElement {
  const container = h('div', {})

  if (!mockMode && !isWebUsbSupported()) {
    container.append(
      h(
        'div',
        { class: 'notice' },
        'This browser has no WebUSB — use Chrome or Edge on desktop, or Chrome on Android, to sync with the camera. ',
        h('a', { href: '?mock=1' }, 'Try mock mode'),
      ),
    )
  }

  const connected = camera?.connected ?? false

  const connectBtn = h(
    'button',
    {
      class: 'primary',
      onclick: async () => {
        if (busy) return
        busy = true
        try {
          if (!camera || !camera.connected) {
            camera = createCamera(log, mockMode)
            const result = await camera.connect()
            if (!result.ok) {
              log(`Connection failed: ${result.error}`)
              camera = null
            }
          } else {
            await camera.disconnect()
            camera = null
            cameraPresets = []
          }
        } finally {
          busy = false
          render()
        }
      },
    },
    connected ? 'Disconnect' : mockMode ? 'Connect mock camera' : 'Connect camera',
  )

  const panel = h(
    'div',
    { class: 'camera-panel' },
    h(
      'div',
      { class: 'row' },
      h('span', {}, h('span', { class: 'status-dot' + (connected ? ' on' : '') }), connected ? `Connected: ${camera!.modelName}` : 'Not connected'),
      connectBtn,
      h(
        'button',
        {
          disabled: !connected || busy,
          onclick: async () => {
            if (!camera) return
            busy = true
            render()
            try {
              cameraPresets = await camera.scanPresets()
            } catch (err) {
              log(`Preset scan failed: ${err}`)
            } finally {
              busy = false
              render()
            }
          },
        },
        'Read camera presets',
      ),
    ),
    mockMode
      ? h('p', { class: 'hint' }, 'Mock mode — no real camera involved. Remove ?mock=1 from the URL for the real thing.')
      : h(
          'p',
          { class: 'hint' },
          'Plug the camera in with USB-C, and set it to ',
          h('b', {}, 'USB RAW CONV./BACKUP RESTORE'),
          ' mode (SETTINGS → CONNECTION SETTING → USB MODE), then connect.',
        ),
    cameraPresetsList(),
    h('div', { class: 'log' }, cameraLogLines.join('\n')),
  )

  const slotRows = lib.getSlots().map((recipe, i) => slotRow(recipe, i))

  const syncBtn = h(
    'button',
    {
      class: 'primary',
      disabled: !connected || busy || lib.getSlots().every((r) => r === null),
      onclick: async () => {
        if (!camera) return
        busy = true
        slotResults = new Map()
        render()
        try {
          const results = await syncSlots(camera, lib.getSlots(), log)
          slotResults = new Map(results.map((r) => [r.slot, r]))
          const okCount = results.filter((r) => r.ok).length
          log(`Sync done: ${okCount}/${results.length} slots written and verified.`)
        } finally {
          busy = false
          render()
        }
      },
    },
    busy ? 'Working…' : 'Send assigned recipes to camera',
  )

  container.append(
    panel,
    h('h2', {}, 'Custom slots (C1–C7)'),
    h(
      'p',
      { class: 'hint' },
      'Assign recipes from your library to the camera’s seven custom slots, then send them over USB. Slots left as “— keep current —” are untouched.',
    ),
    h('div', { class: 'slots' }, ...slotRows),
    syncBtn,
  )
  return container
}

function slotRow(assigned: Recipe | null, index: number): HTMLElement {
  const select = h('select', {
    onchange: (ev) => {
      const id = (ev.target as HTMLSelectElement).value
      lib.assignSlot(index, id || null)
    },
  })
  select.append(h('option', { value: '' }, '— keep current —'))
  for (const r of lib.all().sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = h('option', { value: r.id }, `${r.name} (${filmSimName(r.settings)})`)
    if (assigned?.id === r.id) opt.selected = true
    select.append(opt)
  }

  const result = slotResults.get(index + 1)
  const resultEl = result
    ? h(
        'span',
        { class: 'result ' + (result.ok ? 'ok' : 'fail'), title: result.warnings.join('\n') },
        result.ok ? (result.warnings.length ? '✓ written (with warnings)' : '✓ written & verified') : '✗ failed',
      )
    : null

  return h(
    'div',
    { class: 'slot-row' },
    h('span', { class: 'slot-name' }, `C${index + 1}`),
    select,
    resultEl,
  )
}

function cameraPresetsList(): HTMLElement | null {
  if (cameraPresets.length === 0) return null
  return h(
    'div',
    { class: 'camera-presets' },
    h('b', {}, 'Currently on the camera:'),
    ...cameraPresets.map((p) =>
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'slot-name' }, `C${p.slot}`),
        h('span', {}, p.name || '(unnamed)'),
        h(
          'button',
          {
            onclick: () => {
              const settings = cameraPresetToSettings(p)
              openRecipeForm(undefined, {
                name: p.name || `Camera C${p.slot}`,
                source: 'Imported from camera',
                settings,
              })
            },
          },
          'Import to library',
        ),
      ),
    ),
  )
}

// ==========================================================================
// Boot
// ==========================================================================

render()
