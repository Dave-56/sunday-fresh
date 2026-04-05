import { Dish, EssentialItem } from './types.js';

/**
 * Strip emojis, quantities, measurements, and prep notes to extract
 * the core food item name for Kroger product search.
 *
 * Examples:
 *   "🍅 2 Large Tomatoes, diced"  → "Tomatoes"
 *   "🫗 1/2 Cup Vegetable Oil"    → "Vegetable Oil"
 *   "3 cloves Garlic (minced)"    → "Garlic"
 *   "Salt or Kosher Salt"         → "Salt"
 */
export function cleanSearchTerm(ingredient: string): string {
  return ingredient
    // Remove emojis: presentation, extended pictographic, ZWJ, variation selectors
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
    // Remove leading quantities + units: "2", "1/2", "500g", "2 cups", etc.
    .replace(
      /^\s*\d+[\s/]*\d*\s*(g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|lbs|cloves?|pieces?|cans?|bunch|head|stalks?|slices?|pinch|large|medium|small)?\s*/i,
      ''
    )
    // Remove trailing prep instructions after comma
    .replace(/,.*$/, '')
    // Remove parenthetical notes
    .replace(/\(.*?\)/g, '')
    // Remove "or" alternatives (keep first option)
    .replace(/\s+or\s+.*/i, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collect all grocery items from a locked dish's ingredients
 * and the user's essential items.
 */
export function getAllItems(
  dish: Dish | null,
  essentials: EssentialItem[]
): string[] {
  const items: string[] = [];

  if (dish?.ingredients) {
    dish.ingredients.forEach(ing => items.push(ing));
  }

  essentials.forEach(e => {
    const qty = parseInt(e.quantity) || 1;
    for (let i = 0; i < qty; i++) {
      items.push(e.name);
    }
  });

  return items;
}
