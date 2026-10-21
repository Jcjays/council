// Client-side mirror of the server's wire types. Kept independent so the client
// build does not compile server sources.

export type Provider = 'claude' | 'codex' | 'gemini';
export const PROVIDERS: Provider[] = ['gemini', 'codex', 'claude'];
export type Tier = 'easy' | 'medium' | 'hard';
export const TIERS: Tier[] = ['easy', 'medium', 'hard'];

export type TabStatus = 'drafting' | 'voting' | 'awaiting-start' | 'running' | 'idle' | 'handing-off' | 'failed' | 'closed';

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface TranscriptItem {
  id: string;
  ts: string;
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'vote' | 'result' | 'error';
  text?: string;
  tool?: { id?: string; name: string; input: unknown; output?: string; isError?: boolean };
  data?: unknown;
}

export interface TabWorker {
  provider: Provider;
  model: string | null;
  sessionId: string | null;
}

export interface Seat {
  provider: Provider;
  model: string | null;
}

export interface SeatResult {
  seat: Seat;
  vote: { tier: Tier; confidence: number; reason: string } | null;
  costUsd: number;
  durationMs: number;
  error?: string;
  overCeiling: boolean;
  text?: string;
}

export interface CouncilResult {
  seats: SeatResult[];
  decision: Tier;
  tie: boolean;
  counts: Record<Tier, number>;
}

export interface Tab {
  id: string;
  projectId: string;
  projectRoot: string;
  title: string;
  status: TabStatus;
  tier: Tier | null;
  worker: TabWorker | null;
  previousWorkers: TabWorker[];
  vote: CouncilResult | null;
  routing: { shiftedFrom?: Tier; reason?: string; notes?: string[] } | null;
  transcript: TranscriptItem[];
  costUsd: number;
  fullAuto: boolean;
  escalations: number;
  stalled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaWindow {
  name: string;
  usedPct: number;
  resetsAt?: string;
}

export interface ProviderUsage {
  windows: QuotaWindow[];
  observedAt: string;
}

export interface BudgetState {
  usage?: ProviderUsage;
  provider: Provider;
  spent: number;
  routingSpent: number;
  limit: number;
  pct: number;
  warning: boolean;
  exhausted: boolean;
}

export interface CliHealth {
  installed: boolean;
  version?: string;
  authed: boolean;
  authSource?: 'api-key' | 'login' | 'none' | 'unknown';
  error?: string;
}

export interface ModelPrice {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}
export type PriceTable = Record<string, ModelPrice>;

export interface Settings {
  budgets: Record<Provider, number>;
  warnPct: number;
  resetDay: number;
  seats: Seat[];
  tierMap: Record<Tier, Seat>;
  autoStart: boolean;
  autoEscalate: boolean;
  stallMinutes: number;
  seatTimeoutMs: number;
  voteCostCeiling: number;
  allowedCommands: string[];
  models: Record<Provider, string[]>;
  recentProjects: string[];
  projectOverrides: Record<string, Partial<Pick<Settings, 'allowedCommands' | 'autoStart' | 'autoEscalate'>>>;
}

/** The council and tier map in force given which CLIs are installed and signed in. */
export interface EffectiveRouting {
  available: Provider[];
  seats: Seat[];
  tierMap: Record<Tier, Seat>;
  notes: string[];
}

export interface ProjectInfo {
  root: string;
  projectId: string;
  defaultBranch?: string | null;
}

export type SubmitMode = { kind: 'auto' } | { kind: 'manual'; provider: Provider; model: string | null };
