import { expect, test } from 'vitest';
import { costFor, DEFAULT_PRICING, type PriceTable } from '../src/ledger/pricing.js';

const table: PriceTable = {
  'gemini-2.5-flash': { inputPerM: 0.3, cachedInputPerM: 0.075, outputPerM: 2.5 },
  'gemini-2.5-pro': { inputPerM: 1.25, cachedInputPerM: 0.31, outputPerM: 10 },
  'codex:default': { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 },
};

const M = 1_000_000;

test('exact model key prices each token class', () => {
  expect(costFor('gemini', 'gemini-2.5-flash', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(0.3);
  expect(costFor('gemini', 'gemini-2.5-flash', { inputTokens: M, cachedInputTokens: M, outputTokens: M }, table)).toBeCloseTo(2.875);
});

test('longest matching prefix wins for dated or suffixed model names', () => {
  expect(costFor('gemini', 'gemini-2.5-flash-preview-05-20', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(0.3);
  expect(costFor('gemini', 'gemini-2.5-pro-exp', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(1.25);
});

test('falls back to the provider default, then to zero', () => {
  expect(costFor('codex', 'gpt-something-new', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(1.25);
  expect(costFor('codex', null, { inputTokens: 0, cachedInputTokens: 0, outputTokens: M }, table)).toBeCloseTo(10);
  expect(costFor('claude', 'claude-sonnet-5-5', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBe(0);
});

test('default table prices the Gemini aliases and the Codex default', () => {
  const usage = { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 };
  expect(costFor('gemini', 'flash', usage, DEFAULT_PRICING)).toBeGreaterThan(0);
  expect(costFor('gemini', 'pro', usage, DEFAULT_PRICING)).toBeGreaterThan(costFor('gemini', 'flash', usage, DEFAULT_PRICING));
  expect(costFor('codex', null, usage, DEFAULT_PRICING)).toBeGreaterThan(0);
});
