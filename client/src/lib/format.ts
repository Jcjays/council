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

/** One glyph per provider, the worker's "icon" wherever a worker is named (an idea from Hydra's status bar). */
export const PROVIDER_GLYPHS: Record<Provider, string> = { gemini: '✦', codex: '֎', claude: '❋' };

/** Where a provider's cost figure comes from, for tooltips. */
export function costSource(provider: Provider | null | undefined): string {
  return provider === 'claude' ? 'reported by Claude Code' : 'estimated from the price table';
}

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
  merged: 'Merged',
  closed: 'Closed',
};

export function statusLabel(status: TabStatus): string {
  return STATUS_LABELS[status];
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Token counts as 480, 12.3K, 1.2M. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  const scaled = n < 1_000_000 ? n / 1000 : n / 1_000_000;
  const unit = n < 1_000_000 ? 'K' : 'M';
  const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
  return `${text}${unit}`;
}

/** "now", "2m ago", "3h ago", "2d ago", then a short date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A duration as "12s", "4m 12s", "1h 03m". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** `path` relative to `base` when it lies inside it (either slash style, case-insensitive on drive letters), else unchanged. */
export function shortenPath(p: string, base: string | null | undefined): string {
  if (!base) return p;
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const np = norm(p);
  const nb = norm(base);
  const same = np.toLowerCase().startsWith(`${nb.toLowerCase()}/`);
  return same ? np.slice(nb.length + 1) : p;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** Tool output without terminal colour and cursor escape sequences. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** The last path segment of a checkout, for the project picker. */
export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
