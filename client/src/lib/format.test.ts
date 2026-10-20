import { expect, test } from 'vitest';
import { budgetTone, daysLeft, formatUsd, statusLabel, workerLabel } from './format';

test('formatUsd shows four decimals under a cent and two otherwise', () => {
  expect(formatUsd(0.0012)).toBe('$0.0012');
  expect(formatUsd(0.5)).toBe('$0.50');
  expect(formatUsd(12.345)).toBe('$12.35');
  expect(formatUsd(0)).toBe('$0.00');
  expect(formatUsd(Number.NaN)).toBe('$0.00');
});

test('budgetTone follows the 80% and 100% thresholds', () => {
  expect(budgetTone(0.2)).toBe('ok');
  expect(budgetTone(0.8)).toBe('warn');
  expect(budgetTone(1)).toBe('over');
});

test('daysLeft counts to the next reset day', () => {
  expect(daysLeft(new Date(2026, 9, 20), 1)).toBe(12);
  expect(daysLeft(new Date(2026, 9, 20, 12), 1)).toBe(12);
  expect(daysLeft(new Date(2026, 9, 5), 15)).toBe(10);
  expect(daysLeft(new Date(2026, 9, 15), 15)).toBe(31);
});

test('workerLabel names provider and model', () => {
  expect(workerLabel({ provider: 'gemini', model: 'flash' })).toBe('Gemini · flash');
  expect(workerLabel({ provider: 'codex', model: null })).toBe('Codex · default model');
  expect(workerLabel(null)).toBe('No worker yet');
});

test('statusLabel is human readable', () => {
  expect(statusLabel('awaiting-start')).toBe('Ready to start');
  expect(statusLabel('handing-off')).toBe('Handing off');
  expect(statusLabel('running')).toBe('Working');
});
