import { expect, test } from 'vitest';
import type { Provider } from '../src/adapters/types.js';
import type { Rung } from '../src/council/ladder.js';
import { route } from '../src/council/routing.js';
import type { BudgetState } from '../src/ledger/budget.js';

const rung = (index: number, provider: Provider, model: string): Rung => ({ index, provider, model, label: model });
const ladder: Rung[] = [rung(0, 'gemini', 'flash'), rung(1, 'codex', 'mini'), rung(2, 'claude', 'sonnet'), rung(3, 'claude', 'opus')];

const ok = (provider: Provider): BudgetState => ({ provider, spent: 0, routingSpent: 0, limit: 30, pct: 0, warning: false, exhausted: false });
const out = (provider: Provider): BudgetState => ({ ...ok(provider), spent: 30, pct: 1, warning: true, exhausted: true });
const budgets = { gemini: ok('gemini'), codex: ok('codex'), claude: ok('claude') };

test('routes to the picked rung when its provider can run', () => {
  expect(route(0, ladder, budgets)).toEqual({ index: 0, provider: 'gemini', model: 'flash', tier: 'easy' });
});

test('a blocked provider moves the pick to the next rung up', () => {
  expect(route(0, ladder, { ...budgets, gemini: out('gemini') })).toEqual({
    index: 1,
    provider: 'codex',
    model: 'mini',
    tier: 'medium',
    shiftedFrom: 0,
    reason: expect.stringContaining('gemini'),
  });
});

test('when nothing above is usable, it falls back downward', () => {
  expect(route(3, ladder, { ...budgets, claude: out('claude') })).toMatchObject({ index: 1, provider: 'codex', shiftedFrom: 3 });
});

test('upOnly refuses to go down', () => {
  expect(route(3, ladder, { ...budgets, claude: out('claude') }, [], { upOnly: true })).toBeNull();
  expect(route(1, ladder, { ...budgets, claude: out('claude') }, [], { upOnly: true })).toMatchObject({ index: 1 });
});

test('unavailable CLIs are skipped like exhausted budgets', () => {
  expect(route(1, ladder, budgets, ['codex'])).toMatchObject({ index: 2, provider: 'claude', shiftedFrom: 1, reason: expect.stringContaining('codex') });
});

test('with every provider blocked the pick is kept and the reason says so', () => {
  const r = route(0, ladder, { gemini: out('gemini'), codex: out('codex'), claude: out('claude') });
  expect(r).toMatchObject({ index: 0, provider: 'gemini', model: 'flash', reason: expect.stringContaining('exhausted') });
  expect(r?.shiftedFrom).toBeUndefined();
});

test('the reason uses the budget reason when there is one', () => {
  const windowOut: BudgetState = { ...out('gemini'), limit: 0, reason: 'has used up its 5-hour window' };
  expect(route(0, ladder, { ...budgets, gemini: windowOut })?.reason).toContain('gemini has used up its 5-hour window');
});

test('an empty ladder routes nowhere', () => {
  expect(route(0, [], budgets)).toBeNull();
});
