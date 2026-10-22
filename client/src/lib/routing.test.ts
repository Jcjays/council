import { expect, test } from 'vitest';
import { autoLabel, firstSetUp, isSetUp, noneSetUp, notSetUpTitle, setUpCount } from './routing';

test('unknown availability treats every provider as set up', () => {
  expect(isSetUp(null, 'codex')).toBe(true);
  expect(isSetUp(undefined, 'gemini')).toBe(true);
  expect(noneSetUp(null)).toBe(false);
  expect(setUpCount(undefined)).toBe(3);
});

test('a known list marks the missing ones', () => {
  expect(isSetUp(['claude'], 'claude')).toBe(true);
  expect(isSetUp(['claude'], 'codex')).toBe(false);
  expect(noneSetUp([])).toBe(true);
  expect(setUpCount(['claude', 'gemini'])).toBe(2);
});

test('autoLabel depends on how many providers can vote', () => {
  expect(autoLabel(['claude', 'gemini'])).toBe('Auto (council votes)');
  expect(autoLabel(['claude'])).toBe('Auto (picks the model)');
  expect(autoLabel([])).toBe('Auto');
  expect(autoLabel(null)).toBe('Auto (council votes)');
});

test('firstSetUp keeps the preference when possible', () => {
  expect(firstSetUp(['gemini', 'claude'], 'claude')).toBe('claude');
  expect(firstSetUp(['gemini'], 'claude')).toBe('gemini');
  expect(firstSetUp([], 'codex')).toBe('codex');
  expect(notSetUpTitle('codex')).toContain('Codex is not set up');
});
