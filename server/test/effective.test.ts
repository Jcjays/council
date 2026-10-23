import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { effectiveRouting } from '../src/council/effective.js';

test('all providers available: configured seats are used as they are', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'codex', 'claude']);
  expect(r.available).toEqual(['gemini', 'codex', 'claude']);
  expect(r.seats).toEqual(DEFAULT_SETTINGS.seats);
  expect(r.notes).toEqual([]);
});

test('only Claude: configured Claude seat is kept and note explains', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['claude']);
  expect(r.seats).toEqual([{ provider: 'claude', model: 'claude-haiku-5-5' }]);
  expect(r.notes.join(' ')).toMatch(/only claude/i);
});

test('Gemini and Claude: available seats kept, notes missing Codex', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'claude']);
  expect(r.seats).toEqual([
    { provider: 'gemini', model: 'flash' },
    { provider: 'claude', model: 'claude-haiku-5-5' },
  ]);
  expect(r.notes.join(' ')).toMatch(/codex/i);
});

test('no provider: no seats, and the note says what to set up', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, []);
  expect(r.available).toEqual([]);
  expect(r.seats).toEqual([]);
  expect(r.notes.join(' ')).toMatch(/install|sign in/i);
});

test('configured seats that are all unavailable fall back to the cheapest model of an available provider', () => {
  const r = effectiveRouting({ ...DEFAULT_SETTINGS, seats: [{ provider: 'codex', model: 'gpt-5.1-codex-mini' }] }, ['gemini']);
  expect(r.seats).toEqual([{ provider: 'gemini', model: 'flash-lite' }]);
});
