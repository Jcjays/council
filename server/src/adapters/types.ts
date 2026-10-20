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

export type AdapterEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id?: string; name: string; input: unknown }
  | { type: 'tool_result'; id?: string; output: string; isError?: boolean }
  | { type: 'result'; usage: Usage; costUsd?: number; exitCode: number; isError: boolean; text?: string }
  | { type: 'error'; message: string };

export type ResultEvent = Extract<AdapterEvent, { type: 'result' }>;

export interface CliHealth {
  installed: boolean;
  version?: string;
  authed: boolean;
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
