import { describe, it, expect } from 'vitest';
import { estimateCostUsd, PRICE_TABLE } from '../src/pricing.js';
import type { Usage } from '@ollive/shared';

describe('estimateCostUsd', () => {
  it('gemini-2.5-flash: 1M prompt + 1M completion → ≈ 2.80', () => {
    const usage: Usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = estimateCostUsd('gemini-2.5-flash', usage);
    // 0.30 + 2.50 = 2.80
    expect(cost).toBeCloseTo(2.80, 5);
  });

  it('gpt-4o-mini: 2M prompt + 1M completion → ≈ 0.90', () => {
    const usage: Usage = { promptTokens: 2_000_000, completionTokens: 1_000_000, totalTokens: 3_000_000 };
    const cost = estimateCostUsd('gpt-4o-mini', usage);
    // 0.15*2 + 0.60 = 0.90
    expect(cost).toBeCloseTo(0.90, 5);
  });

  it('unknown model → 0', () => {
    const usage: Usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    expect(estimateCostUsd('unknown-model-xyz', usage)).toBe(0);
  });

  it('null usage → 0', () => {
    expect(estimateCostUsd('gemini-2.5-flash', null)).toBe(0);
  });

  it('undefined usage → 0', () => {
    expect(estimateCostUsd('gemini-2.5-flash', undefined)).toBe(0);
  });

  it('zero tokens → 0', () => {
    const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    expect(estimateCostUsd('gemini-2.5-flash', usage)).toBe(0);
  });

  it('PRICE_TABLE includes gemini-2.5-flash', () => {
    expect(PRICE_TABLE['gemini-2.5-flash']).toBeDefined();
    expect(PRICE_TABLE['gemini-2.5-flash'].inputPerMillion).toBe(0.30);
  });

  it('PRICE_TABLE includes gpt-4o-mini', () => {
    expect(PRICE_TABLE['gpt-4o-mini']).toBeDefined();
    expect(PRICE_TABLE['gpt-4o-mini'].outputPerMillion).toBe(0.60);
  });
});
