import { expect, test } from 'vitest';
import type { Provider } from '../src/adapters/types.js';
import type { ModelChoice } from '../src/config/models.js';
import { buildLadder, rungFor, tierOf } from '../src/council/ladder.js';

const p = (inputPerM: number, outputPerM: number) => ({ inputPerM, cachedInputPerM: inputPerM / 10, outputPerM });

export const CATALOG: Record<Provider, ModelChoice[]> = {
  gemini: [
    { id: 'flash-lite', label: 'Flash-Lite', price: p(0.1, 0.4) },
    { id: 'flash', label: 'Flash', price: p(0.3, 2.5) },
    { id: 'pro', label: 'Pro', price: p(1.25, 10) },
  ],
  codex: [
    { id: 'mini', label: 'Mini', price: p(0.25, 2) },
    { id: 'codex', label: 'Codex', price: p(1.25, 10) },
    { id: 'gpt-5.5', label: 'GPT-5.5', price: p(5, 30) },
  ],
  claude: [
    { id: 'haiku', label: 'Haiku', price: p(0.1, 0.5) },
    { id: 'sonnet', label: 'Sonnet', price: p(2, 10) },
    { id: 'opus', label: 'Opus' },
    { id: 'fable', label: 'Fable' },
  ],
};

test('the ladder orders every set-up model cheapest first across providers, unpriced ones last', () => {
  const l = buildLadder(CATALOG, ['gemini', 'codex', 'claude']);
  expect(l.map((r) => r.model)).toEqual(['flash-lite', 'haiku', 'mini', 'flash', 'pro', 'codex', 'sonnet', 'gpt-5.5', 'opus', 'fable']);
  expect(l.every((r, i) => r.index === i)).toBe(true);
  expect(l[1]).toMatchObject({ provider: 'claude', model: 'haiku', label: 'Haiku', price: p(0.1, 0.5) });
});

test('only the set-up providers are on the ladder', () => {
  expect(buildLadder(CATALOG, ['claude']).map((r) => r.model)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  expect(buildLadder(CATALOG, [])).toEqual([]);
});

test('tierOf splits the ladder into thirds, with the cheapest rung easy and the top rung hard', () => {
  expect([0, 1, 2, 3].map((i) => tierOf(i, 4))).toEqual(['easy', 'medium', 'hard', 'hard']);
  expect([0, 2, 3, 5, 6, 9].map((i) => tierOf(i, 10))).toEqual(['easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
  expect([0, 1, 2].map((i) => tierOf(i, 3))).toEqual(['easy', 'medium', 'hard']);
  expect([0, 1].map((i) => tierOf(i, 2))).toEqual(['easy', 'hard']);
  expect(tierOf(0, 1)).toBe('medium');
});

test('rungFor finds a worker on the ladder by provider and model', () => {
  const l = buildLadder(CATALOG, ['gemini', 'codex', 'claude']);
  expect(rungFor(l, 'claude', 'sonnet')?.index).toBe(6);
  expect(rungFor(l, 'claude', 'nope')).toBeUndefined();
  expect(rungFor(l, 'claude', null)).toBeUndefined();
});
