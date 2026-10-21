import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { effectiveRouting } from '../src/council/effective.js';

test('all providers available: configured seats and tier map are used as they are', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'codex', 'claude']);
  expect(r.available).toEqual(['gemini', 'codex', 'claude']);
  expect(r.seats).toEqual(DEFAULT_SETTINGS.seats);
  expect(r.tierMap).toEqual(DEFAULT_SETTINGS.tierMap);
  expect(r.notes).toEqual([]);
});

test('only Claude: the council is its cheapest model and the tiers climb its own ladder', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['claude']);
  expect(r.seats).toEqual([{ provider: 'claude', model: 'claude-haiku-5-5' }]);
  expect(r.tierMap).toEqual({
    easy: { provider: 'claude', model: 'claude-haiku-5-5' },
    medium: { provider: 'claude', model: 'claude-sonnet-5-5' },
    hard: { provider: 'claude', model: 'claude-opus-5-5' },
  });
  expect(r.notes.join(' ')).toMatch(/only claude/i);
});

test('Gemini and Claude: the missing medium tier is filled from the nearest provider and hard moves up a rung', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini', 'claude']);
  expect(r.seats).toEqual([
    { provider: 'gemini', model: 'flash' },
    { provider: 'claude', model: 'claude-haiku-5-5' },
  ]);
  expect(r.tierMap).toEqual({
    easy: { provider: 'gemini', model: 'flash' },
    medium: { provider: 'claude', model: 'claude-sonnet-5-5' },
    hard: { provider: 'claude', model: 'claude-opus-5-5' },
  });
  expect(r.notes.join(' ')).toMatch(/codex/i);
});

test('only Gemini: tiers climb its ladder until it runs out', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, ['gemini']);
  expect(r.tierMap).toEqual({
    easy: { provider: 'gemini', model: 'flash' },
    medium: { provider: 'gemini', model: 'pro' },
    hard: { provider: 'gemini', model: 'pro' },
  });
});

test('no provider: no seats, the configured map is kept, and the note says what to set up', () => {
  const r = effectiveRouting(DEFAULT_SETTINGS, []);
  expect(r.available).toEqual([]);
  expect(r.seats).toEqual([]);
  expect(r.tierMap).toEqual(DEFAULT_SETTINGS.tierMap);
  expect(r.notes.join(' ')).toMatch(/install|sign in/i);
});

test('configured seats that are all unavailable fall back to the cheapest model of an available provider', () => {
  const r = effectiveRouting({ ...DEFAULT_SETTINGS, seats: [{ provider: 'codex', model: 'gpt-5.1-codex-mini' }] }, ['gemini']);
  expect(r.seats).toEqual([{ provider: 'gemini', model: 'flash-lite' }]);
});

test('a one-rung ladder is clamped and a configured default model is left alone', () => {
  const r = effectiveRouting({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, codex: ['only-one'] } }, ['codex']);
  expect(r.tierMap).toEqual({
    easy: { provider: 'codex', model: 'only-one' },
    medium: { provider: 'codex', model: null },
    hard: { provider: 'codex', model: 'only-one' },
  });
});
