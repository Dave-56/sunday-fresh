import { describe, it, expect } from 'vitest';
import { applyAvailability, type SelectionResult } from '../candidateSelector.js';
import type {
  RankedCandidateWithQuantity,
  StructuredIngredientIntent,
} from '../matchScorer.js';

function mkCandidate(
  overrides: Partial<RankedCandidateWithQuantity> & { upc: string }
): RankedCandidateWithQuantity {
  return {
    upc: overrides.upc,
    description: overrides.description ?? `desc-${overrides.upc}`,
    brand: overrides.brand ?? 'Brand',
    score: overrides.score ?? 120,
    matchType: overrides.matchType ?? 'exact',
    penalties: overrides.penalties ?? [],
    qtyDecision: overrides.qtyDecision ?? {
      cartQty: 1,
      confidence: 'high',
      rationale: 'test',
    },
    stockLevel: overrides.stockLevel,
    fulfillment: overrides.fulfillment,
    size: overrides.size,
    soldBy: overrides.soldBy,
    countPerPack: overrides.countPerPack,
  } as RankedCandidateWithQuantity;
}

const intent: StructuredIngredientIntent = {
  display: 'tomato paste',
  item: 'tomato paste',
  searchTerms: ['tomato paste'],
  qty: 1,
  qtyMode: 'container',
};

function mkResult(selectedUpc: string | null): SelectionResult {
  return {
    decision: selectedUpc ? 'select' : 'no_match',
    selectedUpc,
    backupUpc: null,
    availability: 'ok',
    confidence: 'high',
    reason: 'test pick',
    metadata: { decisionSource: 'deterministic', latencyMs: 5 },
  };
}

describe('applyAvailability', () => {
  it('returns unchanged when chosen is null', () => {
    const result = mkResult(null);
    const out = applyAvailability(result, null, [], undefined, intent);
    expect(out).toEqual(result);
  });

  it('leaves an ok primary untouched and picks next-best distinct backup', () => {
    const primary = mkCandidate({ upc: 'A', stockLevel: 'HIGH' });
    const alt = mkCandidate({ upc: 'B', stockLevel: 'HIGH' });
    const ranked = [primary, alt];

    const out = applyAvailability(mkResult('A'), primary, ranked, 'req1', intent);
    expect(out.selectedUpc).toBe('A');
    expect(out.availability).toBe('ok');
    expect(out.backupUpc).toBe('B');
    expect(out.reason).toBe('test pick');
  });

  it('promotes next non-out candidate when primary is out of stock', () => {
    const primary = mkCandidate({
      upc: 'A',
      stockLevel: 'TEMPORARILY_OUT_OF_STOCK',
    });
    const alt = mkCandidate({ upc: 'B', stockLevel: 'HIGH' });
    const alt2 = mkCandidate({ upc: 'C' });
    const ranked = [primary, alt, alt2];

    const out = applyAvailability(mkResult('A'), primary, ranked, 'req2', intent);
    expect(out.selectedUpc).toBe('B');
    expect(out.availability).toBe('ok');
    expect(out.backupUpc).toBe('C');
    expect(out.reason).toContain('Promoted from out-of-stock top pick');
  });

  it('clears backup when no distinct non-out candidate remains', () => {
    const primary = mkCandidate({
      upc: 'A',
      stockLevel: 'TEMPORARILY_OUT_OF_STOCK',
    });
    const alt = mkCandidate({
      upc: 'B',
      stockLevel: 'TEMPORARILY_OUT_OF_STOCK',
    });
    const ranked = [primary, alt];

    const out = applyAvailability(mkResult('A'), primary, ranked, 'req3', intent);
    // No promotion possible — primary stays, availability stays out, backup null
    expect(out.selectedUpc).toBe('A');
    expect(out.availability).toBe('out');
    expect(out.backupUpc).toBeNull();
  });

  it('propagates weak availability from primary without promotion', () => {
    const primary = mkCandidate({ upc: 'A', stockLevel: 'LOW' });
    const alt = mkCandidate({ upc: 'B', stockLevel: 'HIGH' });
    const ranked = [primary, alt];

    const out = applyAvailability(mkResult('A'), primary, ranked, 'req4', intent);
    expect(out.selectedUpc).toBe('A');
    expect(out.availability).toBe('weak');
    expect(out.backupUpc).toBe('B');
  });

  it('defaults missing fields to ok availability', () => {
    const primary = mkCandidate({ upc: 'A' });
    const alt = mkCandidate({ upc: 'B' });
    const ranked = [primary, alt];

    const out = applyAvailability(mkResult('A'), primary, ranked, 'req5', intent);
    expect(out.availability).toBe('ok');
    expect(out.backupUpc).toBe('B');
  });
});
