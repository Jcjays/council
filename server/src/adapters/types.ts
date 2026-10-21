export type Provider = 'claude' | 'codex' | 'gemini';
export const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini'];

export type Tier = 'easy' | 'medium' | 'hard';
export const TIER_ORDER: readonly Tier[] = ['easy', 'medium', 'hard'];

export type Purpose = 'vote' | 'work' | 'summarize';

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

/** Hard cap passed to Claude for a council vote, in USD. */
export const VOTE_MAX_BUDGET_USD = 0.05;

export interface RunOptions {
  cwd: string;
  prompt: string;
  /** null = let the CLI use its configured default model. */
  model: string | null;
  purpose: Purpose;
  resumeId?: string;
  fullAuto: boolean;
  /** Claude `--allowedTools` entries, e.g. `Bash(npm test*)`. Ignored by other CLIs. */
  allowedCommands: string[];
  signal?: AbortSignal;
  /** JSON schema the answer must match (votes). */
  jsonSchema?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}

/** A usage window the provider enforces on this account, as the CLI reported it. */
export interface QuotaWindow {
  name: string;
  /** 0..1 */
  usedPct: number;
  resetsAt?: string;
}

export type AdapterEvent =
  | { type: 'session'; id: string }
  | { type: 'quota'; windows: QuotaWindow[] }
  | { type: 'text'; text: string }
  | { type: 'tool'; id?: string; name: string; input: unknown }
  | { type: 'tool_result'; id?: string; output: string; isError?: boolean }
  | { type: 'result'; usage: Usage; costUsd?: number; exitCode: number; isError: boolean; text?: string }
  | { type: 'error'; message: string };

export type ResultEvent = Extract<AdapterEvent, { type: 'result' }>;

export type AuthSource = 'api-key' | 'login' | 'none' | 'unknown';

export interface CliHealth {
  installed: boolean;
  version?: string;
  authed: boolean;
  authSource?: AuthSource;
  error?: string;
}

/** A fully built command line: what to run, with what args, and what to feed on stdin. */
export interface CliSpec {
  cmd: string;
  args: string[];
  stdin?: string;
}

export interface Adapter {
  provider: Provider;
  check(): Promise<CliHealth>;
  run(opts: RunOptions): AsyncIterable<AdapterEvent>;
}

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Epoch seconds (or milliseconds, or an ISO string) to ISO; undefined when absent. */
export function isoFromEpoch(v: unknown): string | undefined {
  if (typeof v === 'string' && v !== '') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const ms = v > 1e12 ? v : v * 1000;
  return new Date(ms).toISOString();
}

/** Human name for a rate-limit window given its length in minutes. */
export function windowName(minutes: number): string {
  if (minutes === 60) return '1-hour';
  if (minutes === 300) return '5-hour';
  if (minutes === 1440) return '1-day';
  if (minutes === 10080) return '7-day';
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}
