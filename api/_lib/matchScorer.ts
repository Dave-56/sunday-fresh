/**
 * Shared ingredient -> product scoring module.
 *
 * Used by both the server-side Telegram flow (handleMealSelection)
 * and the client-side web flow (KrogerCheckout).
 *
 * Each environment owns its own fetch logic. This module only
 * receives candidate products and scores them against the parsed
 * ingredient intent.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QtyMode = 'container' | 'unit-count' | 'single-pack';

export type QtyConfidence = 'high' | 'medium' | 'low';

export interface ParsedIngredient {
  /** Original raw ingredient string */
  raw: string;
  /** Core food noun: "Beef Brisket", "Bell Peppers", "Tomato Paste" */
  coreItem: string;
  /** Alternative items from "or" clauses: ["Habanero"] */
  alternatives: string[];
  /** Quantity from the recipe string */
  recipeQty: number;
  /** Normalized recipe unit when present (e.g. kg, oz, ml, container) */
  recipeUnit?: NormalizedUnit;
  /** Whether the original ingredient text had an explicit leading quantity */
  hasExplicitQty: boolean;
  /** How quantity maps to cart: container (cans/jars), unit-count (peppers), single-pack (oil) */
  qtyMode: QtyMode;
  /** Words that must appear in product description for a strong match */
  mustHaveTerms: string[];
  /** Prep/processing terms that signal a BAD match unless explicitly requested */
  avoidTerms: string[];
}

export interface ProductCandidate {
  upc: string;
  description: string;
  brand: string;
  /** Size text from Kroger payload when available (e.g. "13.5 fl oz", "8 ct / 12 fl oz") */
  size?: string;
  /** Optional soldBy hint from Kroger payload */
  soldBy?: string;
  /** Optional count hint from Kroger payload */
  countPerPack?: number;
}

export interface ScoredCandidate extends ProductCandidate {
  score: number;
  matchType: 'exact' | 'close' | 'substitute' | 'weak';
  penalties: string[];
}

export interface QuantityResolution {
  cartQty: number;
  confidence: QtyConfidence;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Processing terms that drastically change the food item */
const DANGEROUS_PREP_TERMS = [
  'corned', 'cured', 'smoked', 'pickled', 'dried', 'candied',
  'fermented', 'jerky', 'bacon', 'spam',
];

/** Category keywords to detect mismatches (protein swapped for non-protein, etc.) */
const PROTEIN_KEYWORDS = [
  'beef', 'chicken', 'pork', 'lamb', 'turkey', 'fish', 'salmon',
  'shrimp', 'tilapia', 'steak', 'brisket', 'chuck', 'thigh',
  'breast', 'drumstick', 'ground', 'sausage', 'goat',
];

/** Household/non-edible terms we should never auto-match as food */
const NON_FOOD_TERMS = [
  'wipes', 'disinfectant', 'cleaner', 'detergent', 'soap', 'shampoo',
  'conditioner', 'paper towel', 'trash bag', 'sponge',
];

/** Prepared/snack/meal terms that are usually not valid ingredient matches */
const PREPARED_MEAL_TERMS = [
  'soup bowl', 'noodle bowl', 'ramen', 'frozen meal', 'chips', 'puffs',
];

const CONTAINER_UNITS = /^(cans?|jars?|bottles?|bags?|box(?:es)?|packages?|bunch(?:es)?|heads?|packs?)$/i;
const UNIT_COUNT_UNITS = /^(pieces?|stalks?|slices?|large|medium|small|bulbs?)$/i;
/** Sub-units that don't map to individual cart items (3 cloves -> buy 1 garlic) */
const SUB_UNITS = /^(cloves?)$/i;

const LEADING_QTY_RE =
  /^\s*(?:(\d+)\s+(\d+\/\d+)|(\d+\/\d+)|(\d+(?:\.\d+)?)|([¼½¾⅓⅔⅛⅜⅝⅞]))\s*/;

const UNIT_RE =
  /^(fl\.?\s*oz|floz|kg|g|ml|l|cups?|tbsp|tsp|oz|lb|lbs|gal(?:lons?)?|cloves?|pieces?|cans?|bunch(?:es)?|heads?|stalks?|slices?|pinch|large|medium|small|bulbs?|bottles?|bags?|box(?:es)?|packages?|jars?|packs?)\b\s*/i;

const FRACTION_MAP: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 0.33, '⅔': 0.67,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const MAX_CART_QTY = 24;

type QuantityBasis = 'weight' | 'volume' | 'count' | 'container' | 'unknown';

export type NormalizedUnit =
  | 'g' | 'kg' | 'oz' | 'lb'
  | 'ml' | 'l' | 'floz' | 'gal' | 'cup' | 'tbsp' | 'tsp'
  | 'count' | 'container';

interface Requirement {
  basis: QuantityBasis;
  amount: number;
}

interface Capacity {
  basis: QuantityBasis;
  amount: number;
  countPerPack?: number;
  derivedFromEach?: boolean;
}

const NUMBER_TOKEN = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';

// ---------------------------------------------------------------------------
// parseIngredient
// ---------------------------------------------------------------------------

export function parseIngredient(raw: string): ParsedIngredient {
  // Strip emojis
  let s = raw
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
    .trim();

  // Extract quantity
  let recipeQty = 1;
  let unit = '';
  let hasExplicitQty = false;
  const qtyMatch = s.match(LEADING_QTY_RE);
  if (qtyMatch) {
    hasExplicitQty = true;
    if (qtyMatch[1] && qtyMatch[2]) {
      // Mixed: "1 1/2"
      const [num, den] = qtyMatch[2].split('/');
      recipeQty = parseInt(qtyMatch[1], 10) + parseInt(num, 10) / parseInt(den, 10);
    } else if (qtyMatch[3]) {
      // Fraction: "1/2"
      const [num, den] = qtyMatch[3].split('/');
      recipeQty = parseInt(num, 10) / parseInt(den, 10);
    } else if (qtyMatch[4]) {
      recipeQty = parseFloat(qtyMatch[4]);
    } else if (qtyMatch[5]) {
      recipeQty = FRACTION_MAP[qtyMatch[5]] ?? 1;
    }
    s = s.slice(qtyMatch[0].length);
  }

  // Extract unit
  const unitMatch = s.match(UNIT_RE);
  if (unitMatch) {
    unit = unitMatch[1].toLowerCase();
    s = s.slice(unitMatch[0].length);
  }

  const recipeUnit = normalizeUnit(unit);

  // Determine quantity mode
  let qtyMode: QtyMode = 'single-pack';
  if (SUB_UNITS.test(unit)) {
    // Sub-units like cloves: you buy 1 garlic bulb, not 3 cloves
    qtyMode = 'single-pack';
  } else if (recipeUnit === 'container' || CONTAINER_UNITS.test(unit)) {
    qtyMode = 'container';
  } else if (recipeUnit === 'count' || UNIT_COUNT_UNITS.test(unit) || (!unit && recipeQty > 1)) {
    qtyMode = 'unit-count';
  }

  // Split on " or " for alternatives
  const parts = s.split(/\s+or\s+/i);
  const primaryRaw = parts[0]
    .replace(/,.*$/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const alternatives = parts.slice(1).map(a =>
    a.replace(/,.*$/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
  ).filter(Boolean);

  // Build mustHaveTerms: the core noun words
  const coreWords = primaryRaw.toLowerCase().split(/\s+/).filter(Boolean);
  // The last word is typically the noun (peppers, oil, paste, brisket)
  const mustHaveTerms = coreWords.length > 0 ? [coreWords[coreWords.length - 1]] : [];

  // Build avoidTerms: dangerous prep terms NOT present in the raw string
  const rawLower = raw.toLowerCase();
  const avoidTerms = DANGEROUS_PREP_TERMS.filter(term => !rawLower.includes(term));

  return {
    raw,
    coreItem: primaryRaw,
    alternatives,
    recipeQty,
    recipeUnit,
    hasExplicitQty,
    qtyMode,
    mustHaveTerms,
    avoidTerms,
  };
}

// ---------------------------------------------------------------------------
// shoppingToParsed — structured ingredient intent -> ParsedIngredient
// ---------------------------------------------------------------------------

/**
 * Minimal shape required for structured ingredient matching.
 * Kept local so src/api copies of this file stay byte-identical.
 */
export interface StructuredIngredientIntent {
  display: string;
  item: string;
  searchTerms: string[];
  forbiddenForms?: string[];
  qty: number;
  qtyMode: QtyMode;
}

export function shoppingToParsed(si: StructuredIngredientIntent): ParsedIngredient {
  const itemWords = si.item.toLowerCase().split(/\s+/).filter(Boolean);

  // Structured quantity source of truth precedence:
  // 1) Parse leading quantity/unit from display (if explicit)
  // 2) Fallback to schema qty + qtyMode
  const fromDisplay = parseIngredient(si.display);
  const useDisplayQty = fromDisplay.hasExplicitQty;

  return {
    raw: si.display,
    coreItem: si.item,
    alternatives: si.searchTerms.slice(1),
    recipeQty: useDisplayQty ? fromDisplay.recipeQty : si.qty,
    recipeUnit: useDisplayQty ? fromDisplay.recipeUnit : (si.qtyMode === 'container' ? 'container' : undefined),
    hasExplicitQty: useDisplayQty,
    qtyMode: useDisplayQty ? fromDisplay.qtyMode : si.qtyMode,
    mustHaveTerms: itemWords,
    avoidTerms: si.forbiddenForms ?? [],
  };
}

// ---------------------------------------------------------------------------
// preFilterCandidates — hard-reject products with forbidden forms
// ---------------------------------------------------------------------------

export function preFilterCandidates(
  candidates: ProductCandidate[],
  si: StructuredIngredientIntent
): ProductCandidate[] {
  if (!si.forbiddenForms || si.forbiddenForms.length === 0) return candidates;
  return candidates.filter(c => {
    const desc = c.description.toLowerCase();
    return !si.forbiddenForms!.some(f => desc.includes(f.toLowerCase()));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampCartQty(n: number): number {
  return Math.min(Math.max(Math.ceil(n), 1), MAX_CART_QTY);
}

function normalizeUnit(raw: string): NormalizedUnit | undefined {
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, '');

  if (key === 'kg') return 'kg';
  if (key === 'g') return 'g';
  if (key === 'oz') return 'oz';
  if (key === 'lb' || key === 'lbs') return 'lb';

  if (key === 'ml') return 'ml';
  if (key === 'l' || key === 'liter' || key === 'liters' || key === 'litre' || key === 'litres') return 'l';
  if (key === 'floz' || key === 'fluidounce' || key === 'fluidounces') return 'floz';
  if (key === 'gal' || key === 'gallon' || key === 'gallons') return 'gal';
  if (key === 'cup' || key === 'cups') return 'cup';
  if (key === 'tbsp' || key === 'tablespoon' || key === 'tablespoons') return 'tbsp';
  if (key === 'tsp' || key === 'teaspoon' || key === 'teaspoons') return 'tsp';

  if (CONTAINER_UNITS.test(key)) return 'container';
  if (UNIT_COUNT_UNITS.test(key) || SUB_UNITS.test(key) || key === 'piece' || key === 'pieces' || key === 'bulb' || key === 'bulbs') return 'count';

  return undefined;
}

function toWeightGrams(amount: number, unit: NormalizedUnit): number | null {
  if (unit === 'g') return amount;
  if (unit === 'kg') return amount * 1000;
  if (unit === 'oz') return amount * 28.3495;
  if (unit === 'lb') return amount * 453.592;
  return null;
}

function toVolumeMl(amount: number, unit: NormalizedUnit): number | null {
  if (unit === 'ml') return amount;
  if (unit === 'l') return amount * 1000;
  if (unit === 'floz') return amount * 29.5735;
  if (unit === 'gal') return amount * 3785.41;
  if (unit === 'cup') return amount * 236.588;
  if (unit === 'tbsp') return amount * 14.7868;
  if (unit === 'tsp') return amount * 4.92892;
  return null;
}

function parseNumberToken(token: string): number | null {
  const t = token.trim();
  if (!t) return null;

  if (FRACTION_MAP[t] !== undefined) return FRACTION_MAP[t];

  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (den === 0) return null;
    return whole + (num / den);
  }

  const fraction = t.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const num = parseInt(fraction[1], 10);
    const den = parseInt(fraction[2], 10);
    if (den === 0) return null;
    return num / den;
  }

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normalizePackText(candidate: ProductCandidate): string {
  return [candidate.size, candidate.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unitFromPackToken(rawUnit: string): NormalizedUnit | undefined {
  const fixed = rawUnit
    .toLowerCase()
    .replace(/fluid\s*ounces?/g, 'floz')
    .replace(/fl\.?\s*oz/g, 'floz')
    .trim();
  return normalizeUnit(fixed);
}

function parsePackCapacity(candidate: ProductCandidate): Capacity {
  const text = normalizePackText(candidate);

  if (typeof candidate.countPerPack === 'number' && Number.isFinite(candidate.countPerPack) && candidate.countPerPack > 0) {
    return { basis: 'count', amount: candidate.countPerPack, countPerPack: candidate.countPerPack };
  }

  if (!text) {
    return { basis: 'unknown', amount: 0 };
  }

  // Pattern: 8 ct / 12 fl oz, 24 bottles / 16.9 fl oz
  const slashMultiRe = new RegExp(`(${NUMBER_TOKEN})\\s*(?:ct|count|bottles?|cans?|packs?)\\s*\\/\\s*(${NUMBER_TOKEN})\\s*(fl\\.?\\s*oz|oz|ml|l|kg|g|lb|lbs|gal)\\b`, 'i');
  const slashMulti = text.match(slashMultiRe);
  if (slashMulti) {
    const count = parseNumberToken(slashMulti[1]);
    const per = parseNumberToken(slashMulti[2]);
    const unit = unitFromPackToken(slashMulti[3]);
    if (count && per && unit) {
      const weight = toWeightGrams(per, unit);
      if (weight !== null) return { basis: 'weight', amount: weight * count, countPerPack: count };
      const volume = toVolumeMl(per, unit);
      if (volume !== null) return { basis: 'volume', amount: volume * count, countPerPack: count };
    }
  }

  // Pattern: 2 x 14.5 oz
  const xMultiRe = new RegExp(`(${NUMBER_TOKEN})\\s*[x×]\\s*(${NUMBER_TOKEN})\\s*(fl\\.?\\s*oz|oz|ml|l|kg|g|lb|lbs|gal|ct|count)\\b`, 'i');
  const xMulti = text.match(xMultiRe);
  if (xMulti) {
    const outer = parseNumberToken(xMulti[1]);
    const inner = parseNumberToken(xMulti[2]);
    const unit = unitFromPackToken(xMulti[3]);
    if (outer && inner && unit) {
      if (unit === 'count') {
        return { basis: 'count', amount: outer * inner, countPerPack: outer * inner };
      }
      const weight = toWeightGrams(inner, unit);
      if (weight !== null) return { basis: 'weight', amount: weight * outer, countPerPack: outer };
      const volume = toVolumeMl(inner, unit);
      if (volume !== null) return { basis: 'volume', amount: volume * outer, countPerPack: outer };
    }
  }

  // Pattern: 8 ct
  const countRe = new RegExp(`(${NUMBER_TOKEN})\\s*(ct|count)\\b`, 'i');
  const countMatch = text.match(countRe);
  if (countMatch) {
    const count = parseNumberToken(countMatch[1]);
    if (count) {
      return { basis: 'count', amount: count, countPerPack: count };
    }
  }

  // Pattern: 13.5 fl oz, 26 oz, 1/2 gal
  const singleRe = new RegExp(`(${NUMBER_TOKEN})\\s*(fl\\.?\\s*oz|oz|ml|l|kg|g|lb|lbs|gal|cup|cups|tbsp|tsp)\\b`, 'i');
  const single = text.match(singleRe);
  if (single) {
    const amount = parseNumberToken(single[1]);
    const unit = unitFromPackToken(single[2]);
    if (amount && unit) {
      const weight = toWeightGrams(amount, unit);
      if (weight !== null) return { basis: 'weight', amount: weight, countPerPack: 1 };
      const volume = toVolumeMl(amount, unit);
      if (volume !== null) return { basis: 'volume', amount: volume, countPerPack: 1 };
    }
  }

  if (/\beach\b/.test(text)) {
    return { basis: 'count', amount: 1, countPerPack: 1, derivedFromEach: true };
  }

  const soldBy = (candidate.soldBy || '').toLowerCase();
  if (soldBy.includes('each') || soldBy.includes('unit')) {
    return { basis: 'count', amount: 1, countPerPack: 1, derivedFromEach: true };
  }

  return { basis: 'unknown', amount: 0 };
}

function requirementFromParsed(parsed: ParsedIngredient): Requirement {
  // Container units: quantity directly means number of containers requested.
  if (parsed.qtyMode === 'container') {
    return { basis: 'container', amount: Math.max(Math.round(parsed.recipeQty), 1) };
  }

  if (parsed.recipeUnit) {
    const grams = toWeightGrams(parsed.recipeQty, parsed.recipeUnit);
    if (grams !== null) return { basis: 'weight', amount: Math.max(grams, 0) };

    const ml = toVolumeMl(parsed.recipeQty, parsed.recipeUnit);
    if (ml !== null) return { basis: 'volume', amount: Math.max(ml, 0) };
  }

  if (parsed.qtyMode === 'unit-count') {
    return { basis: 'count', amount: Math.max(Math.round(parsed.recipeQty), 1) };
  }

  return { basis: 'unknown', amount: 0 };
}

/** Naive singular: strip trailing 's' / 'es' for comparison */
function normalize(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('es')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Check if a word (or its singular/plural) appears in text */
function wordInText(word: string, text: string): boolean {
  const norm = normalize(word);
  return text.includes(word) || text.includes(norm);
}

/** Check if a phrase (or its normalized form) appears in text */
function phraseInText(phrase: string, text: string): boolean {
  if (text.includes(phrase)) return true;
  const normPhrase = phrase.split(/\s+/).map(normalize).join(' ');
  return text.includes(normPhrase);
}

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

export function scoreCandidate(
  candidate: ProductCandidate,
  parsed: ParsedIngredient
): ScoredCandidate {
  const desc = candidate.description.toLowerCase();
  const coreLower = parsed.coreItem.toLowerCase();
  const coreWords = coreLower.split(/\s+/);
  const penalties: string[] = [];
  let score = 0;

  // --- Positive signals: primary item ---

  // Exact full-phrase match in description (normalized for plural)
  if (phraseInText(coreLower, desc)) {
    score += 100;
  } else {
    // Partial: check how many core words appear (with normalization)
    const matched = coreWords.filter(w => wordInText(w, desc));
    score += matched.length * 30;
  }

  // Must-have term bonus (with normalization)
  for (const term of parsed.mustHaveTerms) {
    if (wordInText(term, desc)) {
      score += 20;
    } else {
      score -= 30;
      penalties.push(`missing "${term}"`);
    }
  }

  // --- Positive signals: alternatives ---
  // If the product matches a listed alternative, boost it
  for (const alt of parsed.alternatives) {
    const altLower = alt.toLowerCase();
    if (phraseInText(altLower, desc)) {
      score += 80;
    } else {
      const altWords = altLower.split(/\s+/);
      const matched = altWords.filter(w => wordInText(w, desc));
      if (matched.length > 0) {
        score += matched.length * 20;
      }
    }
  }

  // --- Negative signals ---

  // Hard safety guard: non-food household products
  if (NON_FOOD_TERMS.some(term => desc.includes(term))) {
    score -= 300;
    penalties.push('non-food item');
  }

  // Strong penalty for packaged meals/snacks unless explicitly requested
  const ingredientText = [coreLower, ...parsed.alternatives.map(a => a.toLowerCase())].join(' ');
  if (PREPARED_MEAL_TERMS.some(term => desc.includes(term)) && !PREPARED_MEAL_TERMS.some(term => ingredientText.includes(term))) {
    score -= 120;
    penalties.push('prepared meal/snack mismatch');
  }

  // Dangerous prep term present in product but NOT requested
  for (const avoid of parsed.avoidTerms) {
    if (desc.includes(avoid)) {
      score -= 80;
      penalties.push(`unwanted "${avoid}"`);
    }
  }

  // Protein category mismatch: ingredient is a protein but product is a different protein
  const allIngredientText = ingredientText;
  const ingredientIsProtein = PROTEIN_KEYWORDS.some(p => allIngredientText.includes(p));
  if (ingredientIsProtein) {
    const ingredientProteins = PROTEIN_KEYWORDS.filter(p => allIngredientText.includes(p));
    const productProteins = PROTEIN_KEYWORDS.filter(p => desc.includes(p));

    // Product has a protein keyword that isn't in the ingredient (primary or alternatives)
    const foreignProteins = productProteins.filter(p => !ingredientProteins.includes(p));
    if (foreignProteins.length > 0) {
      score -= 60;
      penalties.push(`protein mismatch: ${foreignProteins.join(', ')}`);
    }
  }

  // Determine match type from score
  let matchType: ScoredCandidate['matchType'];
  if (score >= 100) {
    matchType = 'exact';
  } else if (score >= 60) {
    matchType = 'close';
  } else if (score >= 25) {
    matchType = 'substitute';
  } else {
    matchType = 'weak';
  }

  return { ...candidate, score, matchType, penalties };
}

// ---------------------------------------------------------------------------
// rankCandidates
// ---------------------------------------------------------------------------

export function rankCandidates(
  candidates: ProductCandidate[],
  parsed: ParsedIngredient
): ScoredCandidate[] {
  return candidates
    .map(c => scoreCandidate(c, parsed))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Quantity resolver (deterministic)
// ---------------------------------------------------------------------------

export function resolveCartQuantity(
  parsed: ParsedIngredient,
  candidate?: ProductCandidate
): QuantityResolution {
  const requirement = requirementFromParsed(parsed);

  // Legacy fallback when product metadata is unavailable.
  if (!candidate) {
    if (parsed.qtyMode === 'container') {
      return {
        cartQty: clampCartQty(parsed.recipeQty),
        confidence: 'medium',
        rationale: 'container count from recipe; product pack metadata unavailable',
      };
    }
    return {
      cartQty: 1,
      confidence: 'low',
      rationale: 'product pack metadata unavailable; defaulted to 1',
    };
  }

  const cap = parsePackCapacity(candidate);

  // Fallback matrix branch: known container count from recipe.
  if (requirement.basis === 'container') {
    if (cap.countPerPack && cap.countPerPack > 0) {
      return {
        cartQty: clampCartQty(requirement.amount / cap.countPerPack),
        confidence: 'medium',
        rationale: `recipe needs ${requirement.amount} containers; product appears to include ${cap.countPerPack} per pack`,
      };
    }

    return {
      cartQty: clampCartQty(requirement.amount),
      confidence: 'medium',
      rationale: 'recipe specifies container count; assuming one container per product',
    };
  }

  // Fallback matrix branch: compatible units.
  if (requirement.basis === 'weight' || requirement.basis === 'volume') {
    if (cap.basis === requirement.basis && cap.amount > 0) {
      return {
        cartQty: clampCartQty(requirement.amount / cap.amount),
        confidence: 'high',
        rationale: `${requirement.basis} units compatible; computed with ceil(required/pack)`,
      };
    }

    // Fallback matrix branch: unknown pack size.
    if (cap.basis === 'unknown') {
      return {
        cartQty: 1,
        confidence: 'low',
        rationale: 'required amount known but product pack size unknown',
      };
    }

    // Fallback matrix branch: incompatible units.
    return {
      cartQty: 1,
      confidence: 'low',
      rationale: `unit mismatch (recipe ${requirement.basis}, product ${cap.basis})`,
    };
  }

  if (requirement.basis === 'count') {
    if (cap.basis === 'count' && cap.amount > 0) {
      return {
        cartQty: clampCartQty(requirement.amount / cap.amount),
        confidence: cap.derivedFromEach ? 'medium' : 'high',
        rationale: `count units compatible; recipe needs ${requirement.amount}, pack count ${cap.amount}`,
      };
    }

    if (cap.basis === 'unknown') {
      return {
        cartQty: 1,
        confidence: 'low',
        rationale: 'count requirement known but pack count unknown',
      };
    }

    return {
      cartQty: 1,
      confidence: 'low',
      rationale: `count requirement incompatible with product ${cap.basis} sizing`,
    };
  }

  return {
    cartQty: 1,
    confidence: 'low',
    rationale: 'insufficient recipe quantity detail; defaulted to 1',
  };
}

// Backwards compatibility helper
export function cartQuantity(parsed: ParsedIngredient): number {
  return resolveCartQuantity(parsed).cartQty;
}
