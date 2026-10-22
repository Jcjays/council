import { expect, test } from 'vitest';
import type { BudgetState, PricingStatus } from '../types';
import { planKindLabel, pricesLine, spendLine } from './plan';

const base: BudgetState = { provider: 'claude', spent: 12.5, routingSpent: 0.5, limit: 0, pct: 0, warning: false, exhausted: false };

test('the plan kind reads plainly, and says when it is only a guess', () => {
  expect(planKindLabel({ kind: 'subscription', label: 'Claude subscription', confirmed: true })).toBe('Subscription');
  expect(planKindLabel({ kind: 'subscription', label: 'Claude subscription', confirmed: false })).toBe('Subscription (not yet confirmed by a run)');
  expect(planKindLabel({ kind: 'api-key', label: 'OpenAI API key', confirmed: true })).toBe('API key, pay per use');
  expect(planKindLabel(undefined)).toBe('Not detected yet');
});

test('spend on a subscription is an API-equivalent figure; on an API key it is real money, with the cap if one is set', () => {
  expect(spendLine({ ...base, plan: { kind: 'subscription', label: 'x', confirmed: true } })).toBe('$12.50 API-equivalent this month (covered by the subscription)');
  expect(spendLine({ ...base, provider: 'codex', plan: { kind: 'api-key', label: 'x', confirmed: true } })).toBe('$12.50 spent this month');
  expect(spendLine({ ...base, provider: 'codex', limit: 30, plan: { kind: 'api-key', label: 'x', confirmed: true } })).toBe('$12.50 of a $30.00 monthly cap');
});

test('the prices line names the date and the source, or says the built-in table is in use', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const status: PricingStatus = { table: {}, overrides: {}, fetchedAt: '2026-10-21T08:00:00Z', source: 'LiteLLM + OpenRouter', lastError: null };
  expect(pricesLine(status, now)).toMatch(/^Prices updated .+ from LiteLLM \+ OpenRouter$/);
  expect(pricesLine({ ...status, fetchedAt: null, source: 'built-in defaults' }, now)).toBe('Using built-in prices from October 2026; they have not been fetched yet');
  expect(pricesLine({ ...status, fetchedAt: null, source: 'built-in defaults', lastError: 'LiteLLM: fetch failed' }, now)).toBe(
    'Using built-in prices from October 2026; the last fetch failed (LiteLLM: fetch failed)',
  );
});
