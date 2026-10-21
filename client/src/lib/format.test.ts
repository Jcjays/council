import { expect, test } from 'vitest';
import { budgetTone, daysLeft, describeWindow, formatUsd, statusLabel, workerLabel } from './format';

test('describeWindow reads as a sentence with the time to reset', () => {
  expect(describeWindow({ name: '5-hour', usedPct: 0.59, resetsAt: '2026-10-21T04:30:00.000Z' }, new Date('2026-10-21T02:20:00.000Z'))).toBe(
    '5-hour window: 59% used, resets in 2h 10m',
  );
  expect(describeWindow({ name: '7-day', usedPct: 1 }, new Date())).toBe('7-day window: 100% used');
  expect(describeWindow({ name: '5-hour', usedPct: 0.5, resetsAt: '2026-10-21T02:00:00.000Z' }, new Date('2026-10-21T02:20:00.000Z'))).toBe(
    '5-hour window: 50% used, resets now',
  );
});

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
