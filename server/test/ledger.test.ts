import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { appendEntry, currentPeriod, periodStart, readEntries, sumPeriod, type LedgerEntry } from '../src/ledger/ledger.js';

function tmpLedger(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'council-ledger-')), 'ledger.jsonl');
}

function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  return {
    ts: '2026-10-20T10:00:00.000Z',
    provider: 'gemini',
    model: 'flash',
    purpose: 'work',
    tabId: 't1',
    projectId: 'p1',
    usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
    costUsd: 0.01,
    ...partial,
  };
}

test('append then read round-trips entries in order', async () => {
  const file = tmpLedger();
  await appendEntry(file, entry({ tabId: 'a' }));
  await appendEntry(file, entry({ tabId: 'b', costUsd: 0.02 }));
  const got = await readEntries(file);
  expect(got.map((e) => e.tabId)).toEqual(['a', 'b']);
  expect(got[1]?.costUsd).toBe(0.02);
});

test('a missing ledger reads as empty', async () => {
  expect(await readEntries(path.join(os.tmpdir(), 'council-nope', 'ledger.jsonl'))).toEqual([]);
});

test('corrupt or truncated lines are skipped', async () => {
  const file = tmpLedger();
  await appendEntry(file, entry({ tabId: 'ok' }));
  fs.appendFileSync(file, 'garbage\n{"ts":"2026-10');
  const got = await readEntries(file);
  expect(got.map((e) => e.tabId)).toEqual(['ok']);
});

test('periodStart uses the reset day of the current or previous month', () => {
  expect(periodStart(new Date(2026, 9, 20), 1)).toEqual(new Date(2026, 9, 1));
  expect(periodStart(new Date(2026, 9, 5), 15)).toEqual(new Date(2026, 8, 15));
  expect(periodStart(new Date(2026, 9, 15), 15)).toEqual(new Date(2026, 9, 15));
});

test('periodStart clamps the reset day to the month length', () => {
  expect(periodStart(new Date(2026, 10, 30), 31)).toEqual(new Date(2026, 10, 30));
  expect(periodStart(new Date(2026, 1, 10), 31)).toEqual(new Date(2026, 0, 31));
});

test('currentPeriod ends on the next reset day', () => {
  expect(currentPeriod(new Date(2026, 9, 20), 1)).toEqual({ start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) });
});

test('sumPeriod totals per provider, splits routing spend, and respects the window', () => {
  const start = new Date(2026, 9, 1);
  const end = new Date(2026, 10, 1);
  const entries: LedgerEntry[] = [
    entry({ provider: 'gemini', purpose: 'work', costUsd: 1 }),
    entry({ provider: 'gemini', purpose: 'vote', costUsd: 0.25 }),
    entry({ provider: 'claude', purpose: 'summarize', costUsd: 0.5 }),
    entry({ provider: 'codex', purpose: 'work', costUsd: 2, ts: '2026-09-15T00:00:00.000Z' }),
    entry({ provider: 'codex', purpose: 'work', costUsd: 4, ts: new Date(2026, 10, 1).toISOString() }),
  ];
  expect(sumPeriod(entries, start, end)).toEqual({
    gemini: { spent: 1.25, routingSpent: 0.25, inputTokens: 20, cachedTokens: 0, outputTokens: 10, totalTokens: 30 },
    claude: { spent: 0.5, routingSpent: 0.5, inputTokens: 10, cachedTokens: 0, outputTokens: 5, totalTokens: 15 },
    codex: { spent: 0, routingSpent: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
});
