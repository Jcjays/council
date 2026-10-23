import { expect, test } from 'vitest';
import { DEFAULT_PERMISSION, followUpSelection, fullAutoFor, selectionChangesWorker } from './composerMode';

test('a task is only full auto when the developer asked for it', () => {
  expect(fullAutoFor(DEFAULT_PERMISSION)).toBe(false);
  expect(fullAutoFor('restricted')).toBe(false);
  expect(fullAutoFor('full-auto')).toBe(true);
  expect(fullAutoFor('always')).toBe(true);
});

test('on a follow-up the selector reads as the current worker', () => {
  expect(followUpSelection({ worker: { provider: 'codex', model: 'gpt-5.5', sessionId: 's' } })).toEqual({ provider: 'codex', model: 'gpt-5.5' });
  expect(followUpSelection({ worker: { provider: 'gemini', model: null, sessionId: null } })).toEqual({ provider: 'gemini', model: null });
  expect(followUpSelection({ worker: null })).toBeNull();
});

test('a change of provider or model is a switch; the same choice is not', () => {
  const current = { provider: 'gemini' as const, model: 'flash' };
  expect(selectionChangesWorker(current, 'gemini', 'flash')).toBe(false);
  expect(selectionChangesWorker(current, 'gemini', '  flash ')).toBe(false);
  expect(selectionChangesWorker(current, 'gemini', 'pro')).toBe(true);
  expect(selectionChangesWorker(current, 'claude', 'flash')).toBe(true);
  expect(selectionChangesWorker({ provider: 'codex', model: null }, 'codex', '')).toBe(false);
  expect(selectionChangesWorker({ provider: 'codex', model: null }, 'codex', 'gpt-5.5')).toBe(true);
  expect(selectionChangesWorker(null, 'codex', '')).toBe(true);
});
