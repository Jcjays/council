import { expect, test } from 'vitest';
import { budgetState } from '../src/ledger/budget.js';

test('budgetState computes pct, warns at 80% and marks exhausted at 100%', () => {
  expect(budgetState('gemini', { spent: 15, routingSpent: 1 }, 30)).toEqual({
    provider: 'gemini',
    spent: 15,
    routingSpent: 1,
    limit: 30,
    pct: 0.5,
    warning: false,
    exhausted: false,
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

const now = new Date('2026-10-22T03:00:00Z');
const subscription = { kind: 'subscription' as const, label: 'Claude subscription', confirmed: true };
const apiKey = { kind: 'api-key' as const, label: 'OpenAI API key', confirmed: true };
const usage = (usedPct: number, resetsAt = '2026-10-22T05:00:00Z') => ({
  windows: [
    { name: '5-hour', usedPct, resetsAt },
    { name: '7-day', usedPct: 0.3, resetsAt: '2026-10-25T00:00:00Z' },
  ],
  observedAt: '2026-10-22T02:59:00Z',
});

test('a subscription is judged by its usage windows, and a dollar cap does not apply to it', () => {
  const calm = budgetState('claude', { spent: 100, routingSpent: 0 }, 30, 0.8, { plan: subscription, usage: usage(0.5), now });
  expect(calm).toMatchObject({ plan: subscription, pct: 0.5, warning: false, exhausted: false, limit: 0 });
  expect(calm.usage?.windows).toHaveLength(2);
  expect(budgetState('claude', { spent: 0, routingSpent: 0 }, 0, 0.8, { plan: subscription, usage: usage(0.85), now })).toMatchObject({
    warning: true,
    exhausted: false,
    reason: 'has used 85% of its 5-hour window',
  });
  expect(budgetState('claude', { spent: 0, routingSpent: 0 }, 0, 0.8, { plan: subscription, usage: usage(1), now })).toMatchObject({
    warning: true,
    exhausted: true,
    reason: 'has used up its 5-hour window',
  });
});

test('a window whose reset time has passed no longer counts', () => {
  const s = budgetState('claude', { spent: 0, routingSpent: 0 }, 0, 0.8, { plan: subscription, usage: usage(1, '2026-10-22T02:00:00Z'), now });
  expect(s).toMatchObject({ exhausted: false, pct: 0.3 });
  expect(s.usage?.windows.map((w) => w.name)).toEqual(['7-day']);
});

test('windows without a known plan are treated as a subscription', () => {
  expect(budgetState('codex', { spent: 0, routingSpent: 0 }, 0, 0.8, { usage: usage(1), now }).exhausted).toBe(true);
});

test('an API key is judged by the optional monthly cap', () => {
  expect(budgetState('codex', { spent: 30, routingSpent: 0 }, 30, 0.8, { plan: apiKey, now })).toMatchObject({
    plan: apiKey,
    exhausted: true,
    reason: 'has reached its $30 monthly cap',
  });
  expect(budgetState('codex', { spent: 3, routingSpent: 0 }, 0, 0.8, { plan: apiKey, now })).toMatchObject({ exhausted: false, limit: 0 });
});
