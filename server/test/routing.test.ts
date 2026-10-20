import { expect, test } from 'vitest';
import type { Provider } from '../src/adapters/types.js';
import { route, type TierMap } from '../src/council/routing.js';
import type { BudgetState } from '../src/ledger/budget.js';

const map: TierMap = {
  easy: { provider: 'gemini', model: 'flash' },
  medium: { provider: 'codex', model: null },
  hard: { provider: 'claude', model: 'claude-sonnet-5-5' },
};

const ok = (provider: Provider): BudgetState => ({ provider, spent: 0, routingSpent: 0, limit: 30, pct: 0, warning: false, exhausted: false });
const out = (provider: Provider): BudgetState => ({ ...ok(provider), spent: 30, pct: 1, warning: true, exhausted: true });
const budgets = { gemini: ok('gemini'), codex: ok('codex'), claude: ok('claude') };

test('routes to the tier worker when its provider has budget', () => {
  expect(route('easy', map, budgets)).toEqual({ tier: 'easy', provider: 'gemini', model: 'flash' });
});

test('shifts up one tier when the provider is exhausted', () => {
  expect(route('easy', map, { ...budgets, gemini: out('gemini') })).toEqual({
    tier: 'medium',
    provider: 'codex',
    model: null,
    shiftedFrom: 'easy',
    reason: expect.stringContaining('gemini'),
  });
});

test('shifts down when the top tier is exhausted', () => {
  expect(route('hard', map, { ...budgets, claude: out('claude') })).toMatchObject({ tier: 'medium', provider: 'codex', shiftedFrom: 'hard' });
});

test('skips several exhausted tiers', () => {
  expect(route('easy', map, { ...budgets, gemini: out('gemini'), codex: out('codex') })).toMatchObject({ tier: 'hard', provider: 'claude', shiftedFrom: 'easy' });
});

test('treats unavailable providers (CLI missing) like exhausted ones', () => {
  expect(route('medium', map, budgets, ['codex'])).toMatchObject({ tier: 'hard', provider: 'claude', shiftedFrom: 'medium', reason: expect.stringContaining('codex') });
});

test('keeps the original tier with a reason when every provider is out', () => {
  const r = route('easy', map, { gemini: out('gemini'), codex: out('codex'), claude: out('claude') });
  expect(r).toMatchObject({ tier: 'easy', provider: 'gemini', model: 'flash', reason: expect.stringContaining('exhausted') });
  expect(r.shiftedFrom).toBeUndefined();
});
