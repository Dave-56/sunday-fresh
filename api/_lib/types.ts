export interface RecipeStep {
  text: string;
  time?: string;
}

export interface RecipeSection {
  title: string;
  steps: RecipeStep[];
}

export interface Dish {
  name: string;
  cuisine: string;
  why: string;
  difficulty: "Easy" | "Intermediate";
  prepTime: string;
  servings: number;
  servedWith?: {
    primary: string;
    alternatives?: string[];
  };
  ingredients?: string[] | ShoppingIngredient[];
  sections?: RecipeSection[];
  imageUrl?: string;
  type: "Heritage" | "Explorer";
}

export interface HistoryItem {
  week: string;
  dish: Dish;
  date: string;
}

export interface EssentialItem {
  id: string;
  name: string;
  quantity: string;
  category: 'Fruits & Veg' | 'Beverages' | 'Snacks' | 'Breakfast' | 'Dairy' | 'Pantry' | 'Bread & Bakery' | 'Proteins' | 'Frozen' | 'Household';
}

export interface ShoppingIngredient {
  /** Emoji-prefixed display string for recipe cards & Telegram */
  display: string;
  /** The term you'd type into a grocery store search bar */
  item: string;
  /** Ordered fallback search queries, most specific first */
  searchTerms: string[];
  /** Product forms to reject (e.g., "dried", "ground", "pickled") */
  forbiddenForms?: string[];
  /** Numeric quantity from recipe */
  qty: number;
  /** How quantity maps to cart */
  qtyMode: 'container' | 'unit-count' | 'single-pack';
}

export function isShoppingIngredient(value: unknown): value is ShoppingIngredient {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.display === 'string' &&
    typeof v.item === 'string' &&
    Array.isArray(v.searchTerms) &&
    v.searchTerms.every((t) => typeof t === 'string') &&
    typeof v.qty === 'number' &&
    (v.qtyMode === 'container' || v.qtyMode === 'unit-count' || v.qtyMode === 'single-pack')
  );
}

export function isStructuredIngredients(
  ingredients: Dish['ingredients'] | undefined
): ingredients is ShoppingIngredient[] {
  return Array.isArray(ingredients) && ingredients.every(isShoppingIngredient);
}

export interface IngredientMapping {
  ingredient: string;
  searchTerm: string;
  attemptedTerms: string[];
  krogerProduct: string | null;
  krogerBrand: string | null;
  upc: string | null;
  isEssential: boolean;
  /** Quantity from recipe string (e.g. 3 for "3 Bell Peppers") */
  recipeQty?: number;
  /** Quantity actually added to cart */
  cartQty?: number;
  /** How quantity was determined */
  qtyMode?: 'container' | 'unit-count' | 'single-pack';
  /** How reliable the computed cart quantity is */
  qtyConfidence?: 'high' | 'medium' | 'low';
  /** Short explanation of the quantity decision */
  qtyRationale?: string;
  /** How confident the match is */
  matchType?: 'exact' | 'close' | 'substitute' | 'weak';
}

export interface ReconciliationResult {
  /** Total ingredients required by recipe + essentials */
  required: number;
  /** Items matched and added to cart */
  matched: IngredientMapping[];
  /** Items matched but to a substitute product */
  substituted: IngredientMapping[];
  /** Items that could not be found */
  missing: IngredientMapping[];
  /** Duplicate UPCs (same product matched by multiple ingredients) */
  duplicates: { upc: string; ingredients: string[] }[];
  /** Overall confidence: ratio of exact+close to total */
  confidence: number;
}

export interface UserPreferences {
  householdSize: string;
  cuisines: string[];
  restrictions: string[];
  prepTime: string;
  variety: string;
  onboardingComplete: boolean;
  essentials: EssentialItem[];
  selectedEssentialCategories: string[];
  zipCode: string;
}
