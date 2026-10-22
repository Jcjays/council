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
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'vote' | 'result' | 'error' | 'permission';
  text?: string;
  tool?: { id?: string; name: string; input: unknown; output?: string; isError?: boolean };
  data?: unknown;
}

export type PermissionStatus = 'pending' | 'allowed' | 'allowed-tab' | 'denied';

/** `data` of a `permission` transcript item: what the worker asked to do, and the answer. */
export interface PermissionItemData {
  id: string;
  toolName: string;
  input: unknown;
  /** What Allow for this tab remembers, e.g. `Bash(npm test:*)`. */
  rule: string;
  action: string;
  detail: string;
  status: PermissionStatus;
}

export type PermissionAnswer = 'allow-once' | 'allow-tab' | 'deny';
export type PermissionMode = 'ask' | 'auto';

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
  /** Auto mode: no prompts and no sandbox. */
  fullAuto: boolean;
  /** Rules allowed for this tab with Allow for this tab. */
  allowedTools?: string[];
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

export type PlanKind = 'subscription' | 'api-key' | 'unknown';

export interface ProviderPlan {
  kind: PlanKind;
  label: string;
  /** False when guessed from files or the environment rather than said by the CLI. */
  confirmed: boolean;
}

export interface BudgetState {
  usage?: ProviderUsage;
  plan?: ProviderPlan;
  /** Completes "<provider> …" when near or out, e.g. "has used up its 5-hour window". */
  reason?: string;
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
  plan?: ProviderPlan;
  error?: string;
}

export interface ModelPrice {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}
export type PriceTable = Record<string, ModelPrice>;

/** GET /api/pricing: the table in force and where it came from. */
export interface PricingStatus {
  table: PriceTable;
  overrides: PriceTable;
  fetchedAt: string | null;
  source: string;
  lastError: string | null;
}

/** One entry of GET /api/models. */
export interface ModelChoice {
  id: string;
  label: string;
  note?: string;
  price?: ModelPrice;
  /** The full name a short alias stands for. */
  resolves?: string;
}
export type ModelCatalog = Record<Provider, ModelChoice[]>;

export interface UsageRefresh {
  probed: Provider[];
  skipped: { provider: Provider; reason: string }[];
  budgets: Record<Provider, BudgetState>;
}

export interface Settings {
  /** Optional monthly cap in USD for an API-key account; 0 = none. */
  spendCaps: Record<Provider, number>;
  warnPct: number;
  resetDay: number;
  seats: Seat[];
  tierMap: Record<Tier, Seat>;
  autoStart: boolean;
  autoEscalate: boolean;
  stallMinutes: number;
  seatTimeoutMs: number;
  voteCostCeiling: number;
  permissionMode: PermissionMode;
  models: Record<Provider, string[]>;
  recentProjects: string[];
  projectOverrides: Record<string, Partial<Pick<Settings, 'permissionMode' | 'autoStart' | 'autoEscalate'>>>;
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
