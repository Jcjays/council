import { expect, test } from 'vitest';
import { budgetState } from '../src/ledger/budget.js';

test('budgetState computes pct, warns at 80% and marks exhausted at 100%', () => {
  expect(budgetState('gemini', { spent: 15, routingSpent: 1, inputTokens: 100, cachedTokens: 0, outputTokens: 50, totalTokens: 150 }, 30)).toEqual({
    provider: 'gemini',
    spent: 15,
    routingSpent: 1,
    limit: 30,
    pct: 0.5,
    warning: false,
    exhausted: false,
    tokens: { input: 100, cached: 0, output: 50, total: 150 },
  });
  expect(budgetState('gemini', { spent: 24, routingSpent: 0 }, 30).warning).toBe(true);
  expect(budgetState('gemini', { spent: 30, routingSpent: 0 }, 30)).toMatchObject({ exhausted: true, warning: true, pct: 1 });
  expect(budgetState('gemini', { spent: 45, routingSpent: 0 }, 30).pct).toBe(1.5);
});

test('a zero limit disables tracking: never warns or exhausts', () => {
  expect(budgetState('claude', { spent: 5, routingSpent: 0 }, 0)).toMatchObject({ pct: 0, warning: false, exhausted: false });
});

test('the warning threshold is configurable', () => {
  expect(budgetState('gemini', { spent: 15, routingSpent: 0 }, 30, 0.5).warning).toBe(true);
});
