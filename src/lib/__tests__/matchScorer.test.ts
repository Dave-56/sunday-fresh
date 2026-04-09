import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseIngredient,
  scoreCandidate,
  rankCandidates,
  rankCandidatesForSelection,
  cartQuantity,
  resolveCartQuantity,
  isHardQuantityFeasible,
  shoppingToParsed,
  preFilterCandidates,
  type ProductCandidate,
} from '../matchScorer';

// =========================================================================
// Source-of-truth wiring: src/api should both delegate to shared module
// =========================================================================

describe('matchScorer sync', () => {
  it('src/lib/matchScorer.ts and api/_lib/matchScorer.ts re-export from shared/matchScorer', () => {
    const srcPath = resolve(__dirname, '../../lib/matchScorer.ts');
    const apiPath = resolve(__dirname, '../../../api/_lib/matchScorer.ts');
    const src = readFileSync(srcPath, 'utf-8');
    const api = readFileSync(apiPath, 'utf-8');
    expect(src).toContain("shared/matchScorer");
    expect(api).toContain("shared/matchScorer");
  });
});

// =========================================================================
// parseIngredient
// =========================================================================

describe('parseIngredient', () => {
  it('extracts core item from a simple ingredient', () => {
    const p = parseIngredient('Tomato Paste');
    expect(p.coreItem).toBe('Tomato Paste');
    expect(p.recipeQty).toBe(1);
    expect(p.qtyMode).toBe('single-pack');
  });

  it('handles emoji + quantity + unit + prep notes', () => {
    const p = parseIngredient('🍅 2 Large Tomatoes, diced');
    expect(p.coreItem).toBe('Tomatoes');
    expect(p.recipeQty).toBe(2);
    expect(p.qtyMode).toBe('unit-count');
  });

  it('parses container units correctly', () => {
    const p = parseIngredient('2 cans Coconut Milk');
    expect(p.coreItem).toBe('Coconut Milk');
    expect(p.recipeQty).toBe(2);
    expect(p.qtyMode).toBe('container');
  });

  it('parses "or" alternatives', () => {
    const p = parseIngredient('🍅 2 Scotch Bonnet Peppers or Habanero, seeded');
    expect(p.coreItem).toBe('Scotch Bonnet Peppers');
    expect(p.alternatives).toEqual(['Habanero']);
  });

  it('parses fraction quantities', () => {
    const p = parseIngredient('1/2 Cup Vegetable Oil');
    expect(p.recipeQty).toBe(0.5);
    expect(p.qtyMode).toBe('single-pack');
  });

  it('parses mixed fractions', () => {
    const p = parseIngredient('1 1/2 lbs Beef Brisket');
    expect(p.recipeQty).toBe(1.5);
    expect(p.coreItem).toBe('Beef Brisket');
  });

  it('parses quart units as volume', () => {
    const p = parseIngredient('2 Quarts Beef Stock');
    expect(p.recipeQty).toBe(2);
    expect(p.recipeUnit).toBe('qt');
    expect(p.qtyMode).toBe('single-pack');
  });

  it('extracts per-container size from parenthetical text', () => {
    const p = parseIngredient('2 Cans (28 oz) Crushed Tomatoes');
    expect(p.qtyMode).toBe('container');
    expect(p.containerSize).toEqual({ amount: 28, unit: 'oz' });
  });

  it('marks dangerous prep terms as avoidTerms when not requested', () => {
    const p = parseIngredient('Beef Brisket');
    expect(p.avoidTerms).toContain('corned');
    expect(p.avoidTerms).toContain('smoked');
  });

  it('does NOT avoid "corned" when explicitly requested', () => {
    const p = parseIngredient('Corned Beef Brisket');
    expect(p.avoidTerms).not.toContain('corned');
  });

  it('handles sub-units (cloves) as single-pack', () => {
    const p = parseIngredient('3 cloves Garlic (minced)');
    expect(p.coreItem).toBe('Garlic');
    expect(p.qtyMode).toBe('single-pack');
    expect(p.recipeQty).toBe(3);
  });
});

// =========================================================================
// structured intent helpers
// =========================================================================

describe('shoppingToParsed', () => {
  it('maps structured ingredient intent deterministically', () => {
    const parsed = shoppingToParsed({
      display: '🥥 2 cans Coconut Milk',
      item: 'Coconut Milk',
      searchTerms: ['Coconut Milk', 'Unsweetened Coconut Milk'],
      forbiddenForms: ['drink'],
      qty: 2,
      qtyMode: 'container',
    });

    expect(parsed.raw).toBe('🥥 2 cans Coconut Milk');
    expect(parsed.coreItem).toBe('Coconut Milk');
    expect(parsed.alternatives).toEqual(['Unsweetened Coconut Milk']);
    expect(parsed.recipeQty).toBe(2);
    expect(parsed.qtyMode).toBe('container');
    expect(parsed.mustHaveTerms).toEqual(['coconut', 'milk']);
    expect(parsed.avoidTerms).toEqual(['drink']);
  });

  it('prefers explicit quantity from display over schema fallback', () => {
    const parsed = shoppingToParsed({
      display: '🥥 6 cans Coconut Milk',
      item: 'Coconut Milk',
      searchTerms: ['Coconut Milk'],
      qty: 2,
      qtyMode: 'single-pack',
    });

    expect(parsed.recipeQty).toBe(6);
    expect(parsed.qtyMode).toBe('container');
    expect(parsed.recipeUnit).toBe('container');
  });
});

describe('preFilterCandidates', () => {
  it('drops candidates containing forbidden forms', () => {
    const candidates: ProductCandidate[] = [
      { upc: '1', description: 'Coconut Milk Drink', brand: 'A' },
      { upc: '2', description: 'Unsweetened Coconut Milk', brand: 'B' },
      { upc: '3', description: 'Coconut Milk Powder', brand: 'C' },
    ];

    const filtered = preFilterCandidates(candidates, {
      display: '🥥 Coconut Milk',
      item: 'Coconut Milk',
      searchTerms: ['Coconut Milk'],
      forbiddenForms: ['drink', 'powder'],
      qty: 1,
      qtyMode: 'single-pack',
    });

    expect(filtered.map((c) => c.upc)).toEqual(['2']);
  });

  it('returns all candidates when forbiddenForms is empty', () => {
    const candidates: ProductCandidate[] = [
      { upc: '1', description: 'Fresh Ginger Root', brand: 'A' },
      { upc: '2', description: 'Ground Ginger', brand: 'B' },
    ];

    const filtered = preFilterCandidates(candidates, {
      display: '🫚 Fresh Ginger',
      item: 'Fresh Ginger',
      searchTerms: ['Fresh Ginger'],
      qty: 1,
      qtyMode: 'single-pack',
    });

    expect(filtered).toEqual(candidates);
  });
});

// =========================================================================
// scoreCandidate — known failure scenarios
// =========================================================================

describe('scoreCandidate', () => {
  // ------------------------------------------------------------------
  // FIXTURE 1: "Beef Brisket" must NOT match "Corned Beef"
  // ------------------------------------------------------------------
  describe('brisket vs corned beef', () => {
    const parsed = parseIngredient('1.5 lbs Beef Brisket or Chuck Roast');

    const realBrisket: ProductCandidate = {
      upc: '001', description: 'Beef Brisket Flat Cut', brand: 'Store',
    };
    const cornedBeef: ProductCandidate = {
      upc: '002', description: 'Corned Beef Brisket Point Cut', brand: 'Store',
    };
    const chuckRoast: ProductCandidate = {
      upc: '003', description: 'Beef Chuck Roast Boneless', brand: 'Store',
    };

    it('scores real brisket higher than corned beef', () => {
      const scores = rankCandidates([cornedBeef, realBrisket, chuckRoast], parsed);
      expect(scores[0].upc).toBe('001'); // real brisket wins
      expect(scores[0].matchType).toBe('exact');
    });

    it('penalizes corned beef when not requested', () => {
      const scored = scoreCandidate(cornedBeef, parsed);
      expect(scored.penalties.some(p => p.includes('corned'))).toBe(true);
      expect(scored.score).toBeLessThan(
        scoreCandidate(realBrisket, parsed).score
      );
    });

    it('ranks chuck roast as a viable alternative', () => {
      const scored = scoreCandidate(chuckRoast, parsed);
      expect(scored.score).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // FIXTURE 2: "3 Bell Peppers" must not collapse to wrong product
  // ------------------------------------------------------------------
  describe('bell peppers quantity and matching', () => {
    const parsed = parseIngredient('3 Bell Peppers');

    const bellPepper: ProductCandidate = {
      upc: '010', description: 'Green Bell Pepper', brand: 'Fresh',
    };
    const peppercorn: ProductCandidate = {
      upc: '011', description: 'Black Pepper Ground', brand: 'McCormick',
    };
    const hotPepper: ProductCandidate = {
      upc: '012', description: 'Hot Banana Peppers Jar', brand: 'Store',
    };

    it('prefers "bell pepper" over ground pepper', () => {
      const scores = rankCandidates([peppercorn, bellPepper, hotPepper], parsed);
      expect(scores[0].upc).toBe('010');
    });

    it('penalizes ground pepper (completely wrong item)', () => {
      const scored = scoreCandidate(peppercorn, parsed);
      expect(scored.score).toBeLessThan(
        scoreCandidate(bellPepper, parsed).score
      );
    });

    it('preserves recipe quantity as unit-count', () => {
      expect(parsed.recipeQty).toBe(3);
      expect(parsed.qtyMode).toBe('unit-count');
    });

    it('cart quantity is 1 for unit-count items', () => {
      expect(cartQuantity(parsed)).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // FIXTURE 3: Tomato paste duplicates
  // ------------------------------------------------------------------
  describe('tomato paste — avoid duplicates via scoring', () => {
    const parsed = parseIngredient('2 tbsp Tomato Paste');

    const tomatoPaste: ProductCandidate = {
      upc: '020', description: 'Tomato Paste 6 oz', brand: 'Hunt\'s',
    };
    const tomatoSauce: ProductCandidate = {
      upc: '021', description: 'Tomato Sauce 15 oz', brand: 'Hunt\'s',
    };
    const pastaSource: ProductCandidate = {
      upc: '022', description: 'Prego Pasta Sauce Tomato Basil', brand: 'Prego',
    };

    it('scores tomato paste highest', () => {
      const scores = rankCandidates([tomatoSauce, pastaSource, tomatoPaste], parsed);
      expect(scores[0].upc).toBe('020');
      expect(scores[0].matchType).toBe('exact');
    });

    it('scores tomato sauce lower (close but not exact)', () => {
      const pasteScore = scoreCandidate(tomatoPaste, parsed).score;
      const sauceScore = scoreCandidate(tomatoSauce, parsed).score;
      expect(pasteScore).toBeGreaterThan(sauceScore);
    });

    it('cart quantity is 1 for tbsp measurement', () => {
      expect(parsed.qtyMode).toBe('single-pack');
      expect(cartQuantity(parsed)).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // FIXTURE 4: Scotch bonnet with habanero fallback
  // ------------------------------------------------------------------
  describe('scotch bonnet → habanero fallback', () => {
    const parsed = parseIngredient('🌶️ 2 Scotch Bonnet Peppers or Habanero, seeded');

    const habanero: ProductCandidate = {
      upc: '030', description: 'Habanero Pepper', brand: 'Fresh',
    };
    const jalapenoChips: ProductCandidate = {
      upc: '031', description: 'Jalapeno Kettle Chips', brand: 'Lays',
    };

    it('habanero is a viable match (alternative listed)', () => {
      const scored = scoreCandidate(habanero, parsed);
      expect(scored.score).toBeGreaterThan(0);
    });

    it('jalapeno chips are penalized (wrong item entirely)', () => {
      const habScore = scoreCandidate(habanero, parsed).score;
      const chipScore = scoreCandidate(jalapenoChips, parsed).score;
      expect(habScore).toBeGreaterThan(chipScore);
    });
  });

  // ------------------------------------------------------------------
  // FIXTURE 5: Reject non-food / packaged meal false positives
  // ------------------------------------------------------------------
  describe('reject obvious non-food and meal-product mismatches', () => {
    it('rejects disinfectant wipes for lemongrass ingredient', () => {
      const parsed = parseIngredient('🌿 2 Stalks Lemongrass, white parts only, bruised');
      const wipes: ProductCandidate = {
        upc: '040', description: 'Seventh Generation Lemongrass Citrus Disinfectant Wipes', brand: 'Seventh Generation',
      };
      const scored = scoreCandidate(wipes, parsed);
      expect(scored.matchType).toBe('weak');
      expect(scored.penalties).toContain('non-food item');
    });

    it('rejects soup bowl products for spice ingredient', () => {
      const parsed = parseIngredient('⭐ 2 Star Anise');
      const soupBowl: ProductCandidate = {
        upc: '041', description: 'Star Anise Vietnamese Pho Noodle Savory Peanut Soup Bowl', brand: 'Star Anise Foods',
      };
      const scored = scoreCandidate(soupBowl, parsed);
      expect(scored.matchType).toBe('weak');
      expect(scored.penalties).toContain('prepared meal/snack mismatch');
    });
  });

  // ------------------------------------------------------------------
  // FIXTURE 6: Product-type modifier — ingredient as flavor not product
  // ------------------------------------------------------------------
  describe('product-type modifier rejection', () => {
    it('rejects garlic toast when searching for garlic', () => {
      const parsed = parseIngredient('🧄 3 Bulbs Garlic');
      const garlicToast: ProductCandidate = {
        upc: '050', description: 'Kroger® Garlic Texas Toast', brand: 'Kroger',
      };
      const freshGarlic: ProductCandidate = {
        upc: '051', description: 'Fresh Garlic', brand: 'Produce',
      };
      const toastScore = scoreCandidate(garlicToast, parsed);
      const garlicScore = scoreCandidate(freshGarlic, parsed);
      expect(toastScore.matchType).toBe('weak');
      expect(toastScore.penalties.some(p => p.includes('product-type mismatch'))).toBe(true);
      expect(garlicScore.score).toBeGreaterThan(toastScore.score);
    });

    it('rejects ginger dipping sauce when searching for fresh ginger', () => {
      const parsed = parseIngredient('🫚 100g Fresh Ginger');
      const gingerSauce: ProductCandidate = {
        upc: '052', description: "Bachan's Sesame Ginger Japanese Dipping Sauce", brand: "Bachan's",
      };
      const freshGinger: ProductCandidate = {
        upc: '053', description: 'Fresh Ginger Root', brand: 'Produce',
      };
      const sauceScore = scoreCandidate(gingerSauce, parsed);
      const gingerScore = scoreCandidate(freshGinger, parsed);
      expect(sauceScore.matchType).toBe('weak');
      expect(gingerScore.score).toBeGreaterThan(sauceScore.score);
    });

    it('rejects banana squash when searching for bananas', () => {
      const parsed = parseIngredient('Bananas');
      const bananaSquash: ProductCandidate = {
        upc: '054', description: 'Banana Squash', brand: '',
      };
      const realBanana: ProductCandidate = {
        upc: '055', description: 'Fresh Bananas', brand: 'Produce',
      };
      const squashScore = scoreCandidate(bananaSquash, parsed);
      const bananaScore = scoreCandidate(realBanana, parsed);
      expect(squashScore.penalties.some(p => p.includes('product-type mismatch'))).toBe(true);
      expect(bananaScore.score).toBeGreaterThan(squashScore.score);
    });

    it('does NOT penalize when product type matches ingredient request', () => {
      const parsed = parseIngredient('1 jar Salsa Verde');
      const salsa: ProductCandidate = {
        upc: '056', description: 'Herdez Salsa Verde', brand: 'Herdez',
      };
      const scored = scoreCandidate(salsa, parsed);
      expect(scored.penalties.some(p => p.includes('product-type mismatch'))).toBe(false);
    });
  });

  describe('coconut milk fat-content scoring', () => {
    it('prefers full-fat candidates when recipe requests full-fat', () => {
      const parsed = parseIngredient('2 cans Full-Fat Coconut Milk');
      const fullFat: ProductCandidate = {
        upc: 'cf-1',
        description: 'Organic Coconut Milk',
        brand: 'Thai Kitchen',
      };
      const light: ProductCandidate = {
        upc: 'cf-2',
        description: 'Organic Light Coconut Milk',
        brand: 'Thai Kitchen',
      };

      const fullScore = scoreCandidate(fullFat, parsed);
      const lightScore = scoreCandidate(light, parsed);
      expect(fullScore.score).toBeGreaterThan(lightScore.score);
      expect(lightScore.penalties).toContain('fat-content mismatch');
    });

    it('penalizes lite spelling for full-fat requests', () => {
      const parsed = parseIngredient('Full Fat Coconut Milk');
      const lite: ProductCandidate = {
        upc: 'cf-3',
        description: 'Coconut Milk Lite',
        brand: 'Store',
      };
      const scored = scoreCandidate(lite, parsed);
      expect(scored.penalties).toContain('fat-content mismatch');
    });

    it('penalizes reduced-fat wording for full-fat requests', () => {
      const parsed = parseIngredient('Full-Fat Coconut Milk');
      const reduced: ProductCandidate = {
        upc: 'cf-4',
        description: 'Coconut Milk Reduced-Fat',
        brand: 'Store',
      };
      const scored = scoreCandidate(reduced, parsed);
      expect(scored.penalties).toContain('fat-content mismatch');
    });

    it('does not penalize light variants when recipe does not request full-fat', () => {
      const parsed = parseIngredient('Coconut Milk');
      const light: ProductCandidate = {
        upc: 'cf-5',
        description: 'Coconut Milk Light',
        brand: 'Store',
      };
      const scored = scoreCandidate(light, parsed);
      expect(scored.penalties).not.toContain('fat-content mismatch');
    });

    it('does not false-trigger on "lightly" wording', () => {
      const parsed = parseIngredient('Full-Fat Coconut Milk');
      const lightlySweetened: ProductCandidate = {
        upc: 'cf-6',
        description: 'Full-Fat Coconut Milk, Lightly Sweetened',
        brand: 'Store',
      };
      const scored = scoreCandidate(lightlySweetened, parsed);
      expect(scored.penalties).not.toContain('fat-content mismatch');
    });
  });

  describe('coconut milk beverage-format penalty', () => {
    const parsed = parseIngredient('4 cans Full-Fat Coconut Milk');

    const cannedCoconut: ProductCandidate = {
      upc: 'cm-can-1', description: 'Goya Coconut Milk', brand: 'Goya',
    };
    const halfGallon: ProductCandidate = {
      upc: 'cm-bev-1', description: 'Simple Truth Dairy Free Original Coconut Milk Half Gallon', brand: 'Simple Truth',
    };
    const carton: ProductCandidate = {
      upc: 'cm-bev-2', description: 'Silk Coconut Milk Refrigerated Carton', brand: 'Silk',
    };

    it('ranks canned coconut milk above half-gallon beverage format', () => {
      const scores = rankCandidates([halfGallon, cannedCoconut], parsed);
      expect(scores[0].upc).toBe('cm-can-1');
    });

    it('penalizes half-gallon dairy-free coconut milk', () => {
      const scored = scoreCandidate(halfGallon, parsed);
      expect(scored.penalties).toContain('beverage-format coconut milk vs canned');
    });

    it('penalizes refrigerated carton coconut milk', () => {
      const scored = scoreCandidate(carton, parsed);
      expect(scored.penalties).toContain('beverage-format coconut milk vs canned');
    });

    it('does not penalize when recipe does not use container qtyMode', () => {
      const singleParsed = parseIngredient('1 cup Coconut Milk');
      const scored = scoreCandidate(halfGallon, singleParsed);
      expect(scored.penalties).not.toContain('beverage-format coconut milk vs canned');
    });
  });

});

// =========================================================================
// resolveCartQuantity — deterministic quantity engine
// =========================================================================

describe('resolveCartQuantity', () => {
  it('computes kg -> oz pack math for beef', () => {
    const parsed = parseIngredient('🥩 3.5 kg Beef Chuck Roast');
    const result = resolveCartQuantity(parsed, {
      upc: 'beef-1',
      description: 'Tyson Premium Beef Chuck Roast',
      brand: 'Tyson',
      size: '26 OZ',
    });

    expect(result.cartQty).toBe(5);
    expect(result.confidence).toBe('high');
  });

  it('computes multipack x-size volume correctly', () => {
    const parsed = parseIngredient('96 fl oz Sparkling Water');
    const result = resolveCartQuantity(parsed, {
      upc: 'water-1',
      description: 'Sparkling Water',
      brand: 'Store',
      size: '8 ct / 12 fl oz',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('high');
  });

  it('computes lb -> multipack oz correctly', () => {
    const parsed = parseIngredient('2 lb Chicken');
    const result = resolveCartQuantity(parsed, {
      upc: 'chx-1',
      description: 'Chicken Breast Pack',
      brand: 'Store',
      size: '2 x 16 oz',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('high');
  });

  it('computes quart stock requirement against 32 oz cartons', () => {
    const parsed = parseIngredient('2 Quarts Beef or Lamb Stock');
    const result = resolveCartQuantity(parsed, {
      upc: 'stock-1',
      description: 'Swanson 100% Natural Beef Stock Carton',
      brand: 'Swanson',
      size: '32 oz',
    });

    expect(result.cartQty).toBe(2);
    expect(result.confidence).toBe('high');
  });

  it('enforces per-container size for canned goods', () => {
    const parsed = parseIngredient('2 Cans (28 oz) Crushed Tomatoes');
    const result = resolveCartQuantity(parsed, {
      upc: 'tomato-1',
      description: 'Kroger Crushed Peeled Tomatoes in Tomato Puree',
      brand: 'Kroger',
      size: '15 oz',
    });

    expect(result.cartQty).toBe(4);
    expect(result.confidence).toBe('high');
  });

  it('uses count sizing for each produce', () => {
    const parsed = parseIngredient('20 Small Shallots');
    const result = resolveCartQuantity(parsed, {
      upc: 'shallot-1',
      description: 'Fresh Shallots each',
      brand: 'Produce',
      size: 'each',
    });

    expect(result.cartQty).toBe(20);
    expect(result.confidence).toBe('medium');
  });

  it('returns low confidence for incompatible count vs weight sizing', () => {
    const parsed = parseIngredient('20 Small Shallots');
    const result = resolveCartQuantity(parsed, {
      upc: 'shallot-2',
      description: 'Shallots',
      brand: 'Produce',
      size: '6 oz',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('uses produce-each override when metadata says weight but listing is sold by each', () => {
    const parsed = parseIngredient('8 Onions');
    const result = resolveCartQuantity(parsed, {
      upc: 'onion-1',
      description: 'Yellow Onion',
      brand: 'Produce',
      size: '2 oz',
      soldBy: 'each',
    });

    expect(result.cartQty).toBe(8);
    expect(result.confidence).toBe('medium');
  });

  it('does not apply produce-each override to non-produce ingredients', () => {
    const parsed = parseIngredient('4 Chicken Breasts');
    const result = resolveCartQuantity(parsed, {
      upc: 'chicken-1',
      description: 'Chicken Breast',
      brand: 'Store',
      size: '2 oz',
      soldBy: 'each',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('uses produce-each override when "each" appears in description without soldBy', () => {
    const parsed = parseIngredient('6 Onions');
    const result = resolveCartQuantity(parsed, {
      upc: 'onion-2',
      description: 'Fresh Onion each',
      brand: 'Produce',
      size: '2 oz',
    });

    expect(result.cartQty).toBe(6);
    expect(result.confidence).toBe('medium');
  });

  it('uses produce-each override for Kroger loose produce with soldBy WEIGHT and 1 lb size', () => {
    const parsed = parseIngredient('6 Red Onions');
    const result = resolveCartQuantity(parsed, {
      upc: 'onion-3',
      description: 'Jumbo Red Onions',
      brand: 'Fresh Onions',
      size: '1 lb',
      soldBy: 'WEIGHT',
    });

    expect(result.cartQty).toBe(6);
    expect(result.confidence).toBe('medium');
  });

  it('uses produce-each override for peppers with soldBy WEIGHT and 1 lb size', () => {
    const parsed = parseIngredient('10 Serrano Peppers');
    const result = resolveCartQuantity(parsed, {
      upc: 'pepper-1',
      description: 'Fresh Green Serrano Peppers',
      brand: '',
      size: '1 lb',
      soldBy: 'WEIGHT',
    });

    expect(result.cartQty).toBe(10);
    expect(result.confidence).toBe('medium');
  });

  it('does not apply WEIGHT/1lb override to non-produce items', () => {
    const parsed = parseIngredient('4 Chicken Breasts');
    const result = resolveCartQuantity(parsed, {
      upc: 'chx-3',
      description: 'Chicken Breast',
      brand: 'Store',
      size: '1 lb',
      soldBy: 'WEIGHT',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('returns medium confidence for single-pack qty=1 spice with unknown pack metadata', () => {
    const parsed = parseIngredient('Kashmiri Chili Powder');
    const result = resolveCartQuantity(parsed, {
      upc: 'spice-1',
      description: 'Kashmiri Chili Powder',
      brand: 'Spice Co',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('medium');
  });

  it('returns medium confidence for single-pack qty=1 oil with unknown pack metadata', () => {
    const parsed = parseIngredient('Vegetable Oil');
    const result = resolveCartQuantity(parsed, {
      upc: 'oil-1',
      description: 'Vegetable Oil',
      brand: 'Store',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('medium');
  });

  it('keeps low confidence for single-pack sub-unit ingredients with qty > 1', () => {
    const parsed = parseIngredient('3 cloves Garlic');
    const result = resolveCartQuantity(parsed, {
      upc: 'garlic-1',
      description: 'Fresh Garlic',
      brand: 'Produce',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('returns low confidence when pack size is unknown', () => {
    const parsed = parseIngredient('1 lb Beef Chuck Roast');
    const result = resolveCartQuantity(parsed, {
      upc: 'beef-2',
      description: 'Beef Chuck Roast',
      brand: 'Store',
    });

    expect(result.cartQty).toBe(1);
    expect(result.confidence).toBe('low');
  });
});

describe('quantity-aware selection phases', () => {
  it('hard-feasibility rejects container candidates with incompatible sizing basis', () => {
    const parsed = parseIngredient('2 Cans (28 oz) Crushed Tomatoes');
    const feasible = isHardQuantityFeasible(parsed, {
      upc: 'bad-1',
      description: 'Tomato Soup',
      brand: 'Store',
      size: '15 fl oz',
    });

    expect(feasible).toBe(false);
  });

  it('prefers feasible candidates with better quantity fit during ranking', () => {
    const parsed = parseIngredient('2 Cans (28 oz) Crushed Tomatoes');
    const ranked = rankCandidatesForSelection([
      { upc: 'a', description: 'Crushed Tomatoes', brand: 'Kroger', size: '15 oz' },
      { upc: 'b', description: 'Crushed Tomatoes', brand: 'Kroger', size: '28 oz' },
    ], parsed);

    expect(ranked[0].upc).toBe('b');
    expect(ranked[0].qtyDecision.cartQty).toBe(2);
    expect(ranked[1].qtyDecision.cartQty).toBe(4);
  });
});

describe('cartQuantity legacy wrapper', () => {
  it('keeps container-only fallback behavior when no product metadata is passed', () => {
    const parsed = parseIngredient('2 cans Coconut Milk');
    expect(cartQuantity(parsed)).toBe(2);
  });
});
