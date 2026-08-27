import { describe, it, expect } from 'vitest'
import { createRecipe, exportRecipes, importRecipes, describeSettings } from '../src/model.ts'
import { Library } from '../src/store.ts'
import { STARTER_RECIPES } from '../src/starter-recipes.ts'
import { FilmSim } from '../src/vendor/filmkit/profile/enums.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

describe('recipe model', () => {
  it('round-trips through export/import', () => {
    const recipe = createRecipe({
      name: 'Test Recipe',
      source: 'unit test',
      notes: 'hello',
      favorite: true,
      settings: {
        ...createRecipe({ name: 'x' }).settings,
        filmSimulation: FilmSim.ClassicNeg,
        highlightTone: -1.5,
        wbShiftR: 4,
      },
    })

    const [back] = importRecipes(exportRecipes([recipe]))
    expect(back.name).toBe('Test Recipe')
    expect(back.favorite).toBe(true)
    expect(back.settings.filmSimulation).toBe(FilmSim.ClassicNeg)
    expect(back.settings.highlightTone).toBe(-1.5)
    expect(back.settings.wbShiftR).toBe(4)
  })

  it('drops unknown settings keys and rejects garbage', () => {
    const json = JSON.stringify([
      { name: 'Weird', settings: { filmSimulation: 2, hackerField: 'x', color: 'NaN' } },
    ])
    const [r] = importRecipes(json)
    expect(r.settings.filmSimulation).toBe(2)
    expect((r.settings as unknown as Record<string, unknown>).hackerField).toBeUndefined()
    expect(r.settings.color).toBe(0) // non-numeric ignored, default kept

    expect(() => importRecipes('{"nope": true}')).toThrow()
    expect(() => importRecipes('[{"settings": {}}]')).toThrow(/name/)
  })

  it('describes settings for humans', () => {
    const r = createRecipe({ name: 'x', settings: { ...createRecipe({ name: 'y' }).settings, filmSimulation: FilmSim.ClassicChrome, wbShiftR: 2, wbShiftB: -5 } })
    const desc = Object.fromEntries(describeSettings(r.settings))
    expect(desc['Film Simulation']).toBe('Classic Chrome')
    expect(desc['White Balance']).toContain('+2 Red & -5 Blue')
  })
})

describe('library store', () => {
  it('seeds starter recipes on first run only', () => {
    const storage = memoryStorage()
    const lib = new Library(storage)
    expect(lib.all().length).toBe(STARTER_RECIPES.length)

    for (const r of lib.all()) lib.remove(r.id)
    const lib2 = new Library(storage)
    expect(lib2.all().length).toBe(0) // deletion sticks, no re-seed
  })

  it('persists recipes and slot assignments', () => {
    const storage = memoryStorage()
    const lib = new Library(storage)
    const recipe = createRecipe({ name: 'Slot Test' })
    lib.add(recipe)
    lib.assignSlot(2, recipe.id)

    const lib2 = new Library(storage)
    expect(lib2.byId(recipe.id)?.name).toBe('Slot Test')
    expect(lib2.getSlots()[2]?.id).toBe(recipe.id)

    lib2.remove(recipe.id)
    expect(lib2.getSlots()[2]).toBeNull()
  })

  it('skips duplicate ids on import', () => {
    const lib = new Library(memoryStorage())
    const r = createRecipe({ name: 'Dup' })
    lib.add(r)
    expect(lib.addMany([r, createRecipe({ name: 'New' })])).toBe(1)
  })
})
