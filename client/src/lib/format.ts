import type { Provider, TabStatus } from '../types';

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function budgetTone(pct: number): 'ok' | 'warn' | 'over' {
  if (pct >= 1) return 'over';
  if (pct >= 0.8) return 'warn';
  return 'ok';
}

function resetDate(year: number, monthIndex: number, resetDay: number): Date {
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, resetDay), days));
}

/** Whole days until the next budget reset. */
export function daysLeft(now: Date, resetDay: number): number {
  let next = resetDate(now.getFullYear(), now.getMonth(), resetDay);
  if (next <= now) {
    const m = now.getMonth() + 1;
    next = resetDate(now.getFullYear() + (m > 11 ? 1 : 0), m % 12, resetDay);
  }
  return Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
}

export const PROVIDER_NAMES: Record<Provider, string> = { gemini: 'Gemini', codex: 'Codex', claude: 'Claude' };

export function workerLabel(w: { provider: Provider; model: string | null } | null): string {
  if (!w) return 'No worker yet';
  return `${PROVIDER_NAMES[w.provider]} · ${w.model ?? 'default model'}`;
}

const STATUS_LABELS: Record<TabStatus, string> = {
  drafting: 'Drafting',
  voting: 'Council voting',
  'awaiting-start': 'Ready to start',
  running: 'Working',
  idle: 'Idle',
  'handing-off': 'Handing off',
  failed: 'Failed',
  closed: 'Closed',
};

export function statusLabel(status: TabStatus): string {
  return STATUS_LABELS[status];
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
