import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { effectiveRouting } from '../src/council/effective.js';

test('all providers available: configured seats are used as they are', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'codex', 'claude']);
  expect(r.available).toEqual(['gemini', 'codex', 'claude']);
  expect(r.seats).toEqual(DEFAULT_SETTINGS.seats);
  expect(r.notes).toEqual([]);
});

test('only Claude: council climbs its model ladder and note explains', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['claude']);
  expect(r.seats.map((s) => s.model)).toEqual([
    'claude-haiku-5-5',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-fable-5-1',
  ]);
  expect(r.notes.join(' ')).toMatch(/only claude/i);
});

test('Gemini and Claude: available seats kept, notes missing Codex', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'claude']);
  expect(r.seats).toEqual([
    { provider: 'gemini', model: 'flash-lite' },
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
  expect(r.seats.map((s) => s.model)).toEqual(['flash-lite', 'flash', 'pro']);
});
