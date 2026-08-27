/**
 * Library persistence — recipes and C1-C7 slot assignments in localStorage.
 *
 * localStorage is fine here: a recipe is < 1 KB of JSON and there is no
 * binary data. Every mutation writes through immediately.
 */

import { SLOT_COUNT, createRecipe, type Recipe } from './model.ts'
import { STARTER_RECIPES } from './starter-recipes.ts'

const RECIPES_KEY = 'fuji-recipes.recipes.v1'
const SLOTS_KEY = 'fuji-recipes.slots.v1'
const SEEDED_KEY = 'fuji-recipes.seeded.v1'

type Listener = () => void

export class Library {
  private recipes: Recipe[] = []
  /** slot index 0-6 (C1-C7) → recipe id or null */
  private slots: (string | null)[] = new Array(SLOT_COUNT).fill(null)
  private listeners: Listener[] = []

  constructor(private storage: Storage = localStorage) {
    this.load()
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(RECIPES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.recipes = parsed.map((r) => createRecipe(r))
        }
      } else if (!this.storage.getItem(SEEDED_KEY)) {
        // First run: seed the starter library (once — deleting starters sticks)
        this.recipes = STARTER_RECIPES.map((r) => createRecipe(r))
        this.persistRecipes()
        this.storage.setItem(SEEDED_KEY, '1')
      }

      const slotsRaw = this.storage.getItem(SLOTS_KEY)
      if (slotsRaw) {
        const parsed = JSON.parse(slotsRaw)
        if (Array.isArray(parsed)) {
          for (let i = 0; i < SLOT_COUNT; i++) {
            this.slots[i] = typeof parsed[i] === 'string' ? parsed[i] : null
          }
        }
      }
    } catch {
      // Corrupt storage — start empty rather than crash
      this.recipes = []
    }
    // Drop slot assignments pointing at deleted recipes
    this.slots = this.slots.map((id) => (id && this.byId(id) ? id : null))
  }

  private persistRecipes(): void {
    this.storage.setItem(RECIPES_KEY, JSON.stringify(this.recipes))
  }

  private persistSlots(): void {
    this.storage.setItem(SLOTS_KEY, JSON.stringify(this.slots))
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn)
  }

  // -- Recipes --

  all(): Recipe[] {
    return [...this.recipes]
  }

  byId(id: string): Recipe | undefined {
    return this.recipes.find((r) => r.id === id)
  }

  add(recipe: Recipe): void {
    this.recipes.push(recipe)
    this.persistRecipes()
    this.notify()
  }

  addMany(recipes: Recipe[]): number {
    // Skip exact id duplicates (re-importing the same export file)
    const fresh = recipes.filter((r) => !this.byId(r.id))
    this.recipes.push(...fresh)
    this.persistRecipes()
    this.notify()
    return fresh.length
  }

  update(recipe: Recipe): void {
    const i = this.recipes.findIndex((r) => r.id === recipe.id)
    if (i === -1) return
    this.recipes[i] = recipe
    this.persistRecipes()
    this.notify()
  }

  remove(id: string): void {
    this.recipes = this.recipes.filter((r) => r.id !== id)
    this.slots = this.slots.map((s) => (s === id ? null : s))
    this.persistRecipes()
    this.persistSlots()
    this.notify()
  }

  toggleFavorite(id: string): void {
    const r = this.byId(id)
    if (!r) return
    r.favorite = !r.favorite
    this.persistRecipes()
    this.notify()
  }

  // -- Slots --

  getSlots(): (Recipe | null)[] {
    return this.slots.map((id) => (id ? this.byId(id) ?? null : null))
  }

  assignSlot(slotIndex: number, recipeId: string | null): void {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return
    this.slots[slotIndex] = recipeId
    this.persistSlots()
    this.notify()
  }
}
