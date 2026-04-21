import type {
  ProductCandidate,
  StructuredIngredientIntent,
} from './matchScorer.js';

export type IngredientClass =
  | 'fresh-produce'
  | 'specialty-asian'
  | 'pantry'
  | 'other';

export type CandidateBucket =
  | 'produce'
  | 'protein'
  | 'pantry'
  | 'beverage'
  | 'prepared'
  | 'household'
  | 'other';

export type AvailabilityTier = 'ok' | 'weak' | 'out';

export const CANDIDATE_BUCKET_ORDER: CandidateBucket[] = [
  'produce',
  'protein',
  'pantry',
  'other',
  'beverage',
  'prepared',
  'household',
];

const SPECIALTY_ASIAN_TERMS = [
  'lemongrass', 'galangal', 'gochujang', 'gochugaru', 'doubanjiang',
  'fish sauce', 'shaoxing', 'mirin', 'nori', 'miso', 'udon', 'soba',
  'thai basil', 'bok choy', 'rice noodle', 'red chili',
];

const FRESH_PRODUCE_TERMS = [
  'pepper', 'peppers', 'onion', 'shallot', 'garlic', 'ginger', 'scallion',
  'cilantro', 'parsley', 'spinach', 'kale', 'lettuce', 'tomato', 'tomatoes',
  'carrot', 'cabbage', 'zucchini', 'eggplant', 'yam', 'plantain', 'potato',
  'chili', 'chile',
];

const PANTRY_TERMS = [
  'salt', 'sugar', 'brown sugar', 'honey', 'vinegar', 'soy sauce', 'oil',
  'flour', 'cornstarch', 'starch', 'cumin', 'paprika', 'coriander', 'curry',
  'turmeric', 'oregano', 'thyme', 'bay leaf', 'stock', 'broth', 'spice',
  'powder',
];

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function classifyIngredientClass(
  ingredient: Pick<StructuredIngredientIntent, 'item' | 'searchTerms'>
): IngredientClass {
  const text = `${ingredient.item} ${ingredient.searchTerms.join(' ')}`.toLowerCase();
  if (containsAny(text, SPECIALTY_ASIAN_TERMS)) {
    return 'specialty-asian';
  }
  if (containsAny(text, PANTRY_TERMS)) {
    return 'pantry';
  }
  if (containsAny(text, FRESH_PRODUCE_TERMS)) {
    return 'fresh-produce';
  }
  return 'other';
}

/**
 * Classify a candidate's availability signal from Kroger's location-scoped
 * inventory + fulfillment fields. Missing data defaults to 'ok' — we don't
 * punish absent signals, since Kroger omits these fields when no locationId
 * is passed in the product search.
 *
 * - 'out':   stockLevel TEMPORARILY_OUT_OF_STOCK, OR every fulfillment flag
 *            is explicitly false.
 * - 'weak':  stockLevel LOW, OR only shipToHome is true among the four
 *            fulfillment flags (no local option at all).
 * - 'ok':    everything else, including missing data.
 */
export function classifyAvailability(
  candidate: Pick<ProductCandidate, 'stockLevel' | 'fulfillment'>
): AvailabilityTier {
  const { stockLevel, fulfillment } = candidate;

  if (stockLevel === 'TEMPORARILY_OUT_OF_STOCK') return 'out';

  if (fulfillment) {
    const flags = [
      fulfillment.inStore,
      fulfillment.shipToHome,
      fulfillment.delivery,
      fulfillment.curbside,
    ];
    const allDefined = flags.every((f) => typeof f === 'boolean');
    if (allDefined) {
      const anyTrue = flags.some((f) => f === true);
      if (!anyTrue) return 'out';

      if (
        fulfillment.shipToHome === true &&
        fulfillment.inStore === false &&
        fulfillment.delivery === false &&
        fulfillment.curbside === false
      ) {
        return 'weak';
      }
    }
  }

  if (stockLevel === 'LOW') return 'weak';
  return 'ok';
}

export function bucketProductCandidate(
  candidate: Pick<ProductCandidate, 'description' | 'brand'>
): CandidateBucket {
  const text = `${candidate.description || ''} ${candidate.brand || ''}`.toLowerCase();
  if (/(wipes|cleaner|detergent|soap|disinfectant|trash bag)/.test(text)) return 'household';
  if (/(soda|juice|drink|beverage|sparkling water|tea|coffee)/.test(text)) return 'beverage';
  if (/(soup bowl|noodle bowl|frozen meal|chips|puffs|ramen)/.test(text)) return 'prepared';
  if (/(beef|chicken|pork|lamb|goat|fish|salmon|shrimp|turkey|sausage|brisket)/.test(text)) return 'protein';
  if (/(fresh|produce|organic|whole|each|pepper|onion|tomato|cilantro|ginger|garlic|lemongrass|shallot|herb)/.test(text)) return 'produce';
  if (/(flour|sugar|salt|oil|vinegar|stock|broth|seasoning|spice|powder|paste|sauce)/.test(text)) return 'pantry';
  return 'other';
}
