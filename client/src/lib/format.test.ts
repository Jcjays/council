import { expect, test } from 'vitest';
import { basename, budgetTone, costSource, daysLeft, describeWindow, elapsed, formatTokens, formatUsd, relativeTime, shortenPath, statusLabel, stripAnsi, workerLabel } from './format';

test('describeWindow reads as a sentence with the time to reset', () => {
  expect(describeWindow({ name: '5-hour', usedPct: 0.59, resetsAt: '2026-10-21T04:30:00.000Z' }, new Date('2026-10-21T02:20:00.000Z'))).toBe('5-hour window: 59% used, resets in 2h 10m');
  expect(describeWindow({ name: '7-day', usedPct: 1 }, new Date())).toBe('7-day window: 100% used');
  expect(describeWindow({ name: '5-hour', usedPct: 0.5, resetsAt: '2026-10-21T02:00:00.000Z' }, new Date('2026-10-21T02:20:00.000Z'))).toBe('5-hour window: 50% used, resets now');
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

test('formatTokens scales to K and M', () => {
  expect(formatTokens(480)).toBe('480');
  expect(formatTokens(12_345)).toBe('12K');
  expect(formatTokens(1_234)).toBe('1.2K');
  expect(formatTokens(1_000)).toBe('1K');
  expect(formatTokens(2_500_000)).toBe('2.5M');
  expect(formatTokens(-5)).toBe('0');
});

test('relativeTime rounds to the nearest unit', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  expect(relativeTime('2026-10-21T11:59:40Z', now)).toBe('now');
  expect(relativeTime('2026-10-21T11:58:00Z', now)).toBe('2m ago');
  expect(relativeTime('2026-10-21T09:00:00Z', now)).toBe('3h ago');
  expect(relativeTime('2026-10-19T12:00:00Z', now)).toBe('2d ago');
  expect(relativeTime('not a date', now)).toBe('');
  expect(relativeTime('2026-09-01T12:00:00Z', now)).not.toContain('ago');
});

test('elapsed formats seconds, minutes and hours', () => {
  expect(elapsed(12_000)).toBe('12s');
  expect(elapsed(252_000)).toBe('4m 12s');
  expect(elapsed(3_780_000)).toBe('1h 03m');
  expect(elapsed(-1)).toBe('0s');
});

test('costSource tells reported from estimated costs apart', () => {
  expect(costSource('claude')).toBe('reported by Claude Code');
  expect(costSource('codex')).toBe('estimated from the price table');
  expect(costSource(null)).toBe('estimated from the price table');
});

test('shortenPath strips the worktree prefix in either slash style', () => {
  expect(shortenPath('C:\\w\\.worktrees\\t1\\src\\a.ts', 'C:/w/.worktrees/t1')).toBe('src/a.ts');
  expect(shortenPath('c:/w/.worktrees/t1/README.md', 'C:\\w\\.worktrees\\t1\\')).toBe('README.md');
  expect(shortenPath('src/a.ts', 'C:/w')).toBe('src/a.ts');
  expect(shortenPath('C:/other/a.ts', 'C:/w')).toBe('C:/other/a.ts');
  expect(shortenPath('npm test', null)).toBe('npm test');
});

test('stripAnsi removes colour and cursor sequences', () => {
  expect(stripAnsi('\u001b[33m5\u001b[39m')).toBe('5');
  expect(stripAnsi('ok \u001b[1;32mpassed\u001b[0m\n\u001b[2K\u001b[1Gdone')).toBe('ok passed\ndone');
  expect(stripAnsi('plain')).toBe('plain');
});

test('basename takes the last segment of either slash style', () => {
  expect(basename('C:\\Users\\Chris\\Desktop\\council')).toBe('council');
  expect(basename('/home/chris/council/')).toBe('council');
  expect(basename('council')).toBe('council');
});
