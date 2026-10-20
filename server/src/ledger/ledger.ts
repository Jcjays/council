import fs from 'node:fs/promises';
import path from 'node:path';
import { parseObjectLine } from '../adapters/jsonl.js';
import { PROVIDERS, type Provider, type Purpose, type Usage } from '../adapters/types.js';

export interface LedgerEntry {
  ts: string;
  provider: Provider;
  model: string | null;
  purpose: Purpose;
  tabId: string;
  projectId: string;
  usage: Usage;
  costUsd: number;
}

export interface ProviderSums {
  spent: number;
  /** Spend whose purpose was not `work` (votes and hand-off summaries). */
  routingSpent: number;
}

export async function appendEntry(file: string, entry: LedgerEntry): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function isEntry(o: unknown): o is LedgerEntry {
  if (!o || typeof o !== 'object') return false;
  const e = o as Record<string, unknown>;
  return typeof e.ts === 'string' && typeof e.provider === 'string' && typeof e.costUsd === 'number';
}

/** Missing file reads as empty; corrupt or truncated lines are skipped. */
export async function readEntries(file: string): Promise<LedgerEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return text.split('\n').flatMap((line) => {
    const obj = parseObjectLine(line);
    return isEntry(obj) ? [obj] : [];
  });
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function resetDate(year: number, monthIndex: number, resetDay: number): Date {
  const day = Math.min(Math.max(1, Math.floor(resetDay)), daysInMonth(year, monthIndex));
  return new Date(year, monthIndex, day);
}

/** Local-time start of the budget period containing `now`. */
export function periodStart(now: Date, resetDay: number): Date {
  let year = now.getFullYear();
  let month = now.getMonth();
  let start = resetDate(year, month, resetDay);
  if (now < start) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = resetDate(year, month, resetDay);
  }
  return start;
}

export function currentPeriod(now: Date, resetDay: number): { start: Date; end: Date } {
  const start = periodStart(now, resetDay);
  let year = start.getFullYear();
  let month = start.getMonth() + 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }
  return { start, end: resetDate(year, month, resetDay) };
}

/** Sums `[start, end)` per provider. */
export function sumPeriod(entries: LedgerEntry[], start: Date, end: Date): Record<Provider, ProviderSums> {
  const sums = Object.fromEntries(PROVIDERS.map((p) => [p, { spent: 0, routingSpent: 0 }])) as Record<Provider, ProviderSums>;
  for (const e of entries) {
    const t = new Date(e.ts);
    if (Number.isNaN(t.getTime()) || t < start || t >= end) continue;
    const bucket = sums[e.provider];
    if (!bucket) continue;
    bucket.spent += e.costUsd;
    if (e.purpose !== 'work') bucket.routingSpent += e.costUsd;
  }
  return sums;
}
