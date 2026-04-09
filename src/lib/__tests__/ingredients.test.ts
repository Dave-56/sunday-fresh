import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getSearchTerms } from '../ingredients';

describe('ingredients sync', () => {
  it('keeps getSearchTerms logic identical between src/lib and api/_lib', () => {
    const srcPath = resolve(__dirname, '../../lib/ingredients.ts');
    const apiPath = resolve(__dirname, '../../../api/_lib/ingredients.ts');
    const src = readFileSync(srcPath, 'utf-8');
    const api = readFileSync(apiPath, 'utf-8');
    const startToken = 'export function getSearchTerms';
    const endToken = 'export function extractQuantity';
    const srcSlice = src.slice(src.indexOf(startToken), src.indexOf(endToken)).trim();
    const apiSlice = api.slice(api.indexOf(startToken), api.indexOf(endToken)).trim();
    expect(srcSlice).toBe(apiSlice);
  });
});

describe('getSearchTerms', () => {
  it('prepends Fresh for Fruits & Veg essentials', () => {
    expect(getSearchTerms('Bananas', 'Fruits & Veg')).toEqual(['Fresh Bananas', 'Bananas']);
  });

  it('does not duplicate Fresh prefix when term already starts with Fresh', () => {
    const terms = getSearchTerms('Fresh Spinach', 'Fruits & Veg');
    expect(terms[0]).toBe('Fresh Spinach');
    expect(terms).not.toContain('Fresh Fresh Spinach');
  });

  it('adds single-word fallback for two-word essentials', () => {
    const terms = getSearchTerms('Greek Yogurt');
    expect(terms).toContain('Yogurt');
  });

  it('keeps backward compatibility when no category is provided', () => {
    expect(getSearchTerms('Bananas')).toEqual(['Bananas']);
  });
});
