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
