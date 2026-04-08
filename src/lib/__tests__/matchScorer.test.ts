import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseIngredient,
  scoreCandidate,
  rankCandidates,
  cartQuantity,
  resolveCartQuantity,
  shoppingToParsed,
  preFilterCandidates,
  type ProductCandidate,
} from '../matchScorer';

// =========================================================================
// Drift detection: src and api copies must stay in sync
// =========================================================================

describe('matchScorer sync', () => {
  it('src/lib/matchScorer.ts and api/_lib/matchScorer.ts are identical', () => {
    const srcPath = resolve(__dirname, '../../lib/matchScorer.ts');
    const apiPath = resolve(__dirname, '../../../api/_lib/matchScorer.ts');
    const src = readFileSync(srcPath, 'utf-8');
    const api = readFileSync(apiPath, 'utf-8');
    expect(src).toBe(api);
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

describe('cartQuantity legacy wrapper', () => {
  it('keeps container-only fallback behavior when no product metadata is passed', () => {
    const parsed = parseIngredient('2 cans Coconut Milk');
    expect(cartQuantity(parsed)).toBe(2);
  });
});
