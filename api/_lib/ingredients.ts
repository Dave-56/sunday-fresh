import { Dish, EssentialItem } from './types.js';

const LEADING_QTY_AND_UNIT_RE =
  /^\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(g|kg|ml|l|cups?|tbsp|tsp|oz|lb|lbs|cloves?|pieces?|cans?|bunch(?:es)?|heads?|stalks?|slices?|pinch|large|medium|small|bottles?|bags?|box(?:es)?|packages?|jars?|packs?)?\b\s*/i;

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
    .replace(LEADING_QTY_AND_UNIT_RE, '')
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
 * Build an ordered list of search terms to try for a single ingredient,
 * including "or" alternatives and simplified fallbacks.
 *
 * Examples:
 *   "🍅 2 Scotch Bonnet Peppers or Habanero, seeded"
 *     → ["Scotch Bonnet Peppers", "Habanero", "Peppers"]
 *   "🫗 1/2 Cup Vegetable Oil"
 *     → ["Vegetable Oil"]
 *   "3 cloves Garlic (minced)"
 *     → ["Garlic"]
 */
export function getSearchTerms(ingredient: string): string[] {
  // Strip emojis and leading quantities/units
  const stripped = ingredient
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
    .replace(LEADING_QTY_AND_UNIT_RE, '')
    .trim();

  // Split on " or " to get all alternatives
  const alternatives = stripped.split(/\s+or\s+/i);

  const terms: string[] = [];
  for (const alt of alternatives) {
    // Clean each alternative: remove prep instructions and parenthetical notes
    const cleaned = alt
      .replace(/,.*$/, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) terms.push(cleaned);
  }

  // Add simplified fallbacks: last 1-2 words of the primary term (the core noun)
  if (terms.length > 0) {
    const words = terms[0].split(' ');
    if (words.length > 2) {
      const simplified = words.slice(-1).join(' ');
      if (!terms.includes(simplified)) terms.push(simplified);
    }
  }

  // Cap at 3 terms to limit API calls
  return terms.slice(0, 3);
}

/**
 * Extract a cart-meaningful quantity from an ingredient string.
 * Only returns >1 when an explicit container unit is present
 * (cans, jars, bottles, bags, boxes, packages, bunches, heads, packs).
 * Without a container unit, defaults to 1 to prevent over-ordering.
 *
 * Examples:
 *   "2 cans Coconut Milk"    → 2
 *   "3 jars Tomato Paste"    → 3
 *   "2 Large Tomatoes"       → 1  (no container unit)
 *   "1/2 Cup Vegetable Oil"  → 1  (measurement, not container)
 *   "3 cloves Garlic"        → 1  (sub-unit, not container)
 */
export function extractQuantity(ingredient: string): number {
  const stripped = ingredient
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
    .trim();

  const match = stripped.match(
    /^\s*(\d+)\s*(cans?|jars?|bottles?|bags?|box(?:es)?|packages?|bunch(?:es)?|heads?|packs?)\b/i
  );

  if (!match) return 1;

  const qty = parseInt(match[1], 10);
  if (isNaN(qty) || qty < 1) return 1;
  return Math.min(qty, 5); // Cap at 5 to guard against parsing errors
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
