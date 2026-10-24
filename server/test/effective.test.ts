import { expect, test } from 'vitest';
import { modelCatalog } from '../src/config/models.js';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { effectiveRouting } from '../src/council/effective.js';
import { DEFAULT_PRICING } from '../src/ledger/pricing.js';

const catalog = modelCatalog(DEFAULT_SETTINGS.models, DEFAULT_PRICING);

test('all providers set up: the configured seats vote and the ladder holds every model', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'codex', 'claude'], catalog);
  expect(r.available).toEqual(['gemini', 'codex', 'claude']);
  expect(r.seats).toEqual(DEFAULT_SETTINGS.seats);
  const ids = r.ladder.map((m) => m.model);
  expect(ids).toHaveLength(DEFAULT_SETTINGS.models.gemini.length + DEFAULT_SETTINGS.models.codex.length + DEFAULT_SETTINGS.models.claude.length);
  expect(ids.indexOf('claude-haiku-5-5')).toBeLessThan(ids.indexOf('claude-sonnet-5-5'));
  expect(ids.indexOf('flash')).toBeLessThan(ids.indexOf('pro'));
  expect(r.ladder.every((m, i) => m.index === i)).toBe(true);
  expect(r.notes).toEqual([]);
});

test('only Claude: Haiku votes alone and the ladder is Claude models cheapest first', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['claude'], catalog);
  expect(r.seats).toEqual([{ provider: 'claude', model: 'claude-haiku-5-5' }]);
  expect(r.ladder.map((m) => m.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
  expect(r.notes.join(' ')).toMatch(/only claude/i);
  expect(r.notes.join(' ')).toMatch(/haiku/i);
});

test('no provider: no seats, an empty ladder, and the note says what to set up', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, [], catalog);
  expect(r).toMatchObject({ available: [], seats: [], ladder: [] });
  expect(r.notes.join(' ')).toMatch(/install|sign in/i);
});

test('configured seats that are all unavailable fall back to the cheapest model of an available provider', () => {
  const r = effectiveRouting({ ...DEFAULT_SETTINGS, seats: [{ provider: 'codex', model: 'gpt-5.1-codex-mini' }] }, ['gemini'], catalog);
  expect(r.seats).toEqual([{ provider: 'gemini', model: r.ladder[0]?.model }]);
});

test('a missing provider is named in the notes', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'claude'], catalog);
  expect(r.notes.join(' ')).toMatch(/codex/i);
  expect(r.ladder.every((m) => m.provider !== 'codex')).toBe(true);
});
