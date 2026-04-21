import { describe, it, expect } from 'vitest';
import { classifyAvailability } from '../ingredientSignals.js';

describe('classifyAvailability', () => {
  it('returns ok for fully missing fields', () => {
    expect(classifyAvailability({})).toBe('ok');
  });

  it('returns ok for HIGH stockLevel without fulfillment', () => {
    expect(classifyAvailability({ stockLevel: 'HIGH' })).toBe('ok');
  });

  it('returns out for TEMPORARILY_OUT_OF_STOCK regardless of fulfillment', () => {
    expect(
      classifyAvailability({
        stockLevel: 'TEMPORARILY_OUT_OF_STOCK',
        fulfillment: { inStore: true, shipToHome: true, delivery: true, curbside: true },
      })
    ).toBe('out');
  });

  it('returns out when every fulfillment flag is explicitly false', () => {
    expect(
      classifyAvailability({
        fulfillment: { inStore: false, shipToHome: false, delivery: false, curbside: false },
      })
    ).toBe('out');
  });

  it('returns weak when only shipToHome is true among fully-defined flags', () => {
    expect(
      classifyAvailability({
        fulfillment: { inStore: false, shipToHome: true, delivery: false, curbside: false },
      })
    ).toBe('weak');
  });

  it('returns weak for LOW stockLevel without fulfillment', () => {
    expect(classifyAvailability({ stockLevel: 'LOW' })).toBe('weak');
  });

  it('returns ok when at least one local fulfillment flag is true', () => {
    expect(
      classifyAvailability({
        fulfillment: { inStore: true, shipToHome: false, delivery: false, curbside: false },
      })
    ).toBe('ok');
    expect(
      classifyAvailability({
        fulfillment: { inStore: false, shipToHome: false, delivery: true, curbside: false },
      })
    ).toBe('ok');
  });

  it('does not classify as out when fulfillment is only partially defined', () => {
    expect(
      classifyAvailability({
        fulfillment: { inStore: false, shipToHome: false },
      })
    ).toBe('ok');
  });
});
