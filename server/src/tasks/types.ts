import type { Provider, Tier } from '../adapters/types.js';
import type { CouncilResult } from '../council/council.js';
import type { TabStatus } from './state.js';

export type TranscriptKind = 'user' | 'assistant' | 'tool' | 'system' | 'vote' | 'result' | 'error' | 'permission';

export type PermissionStatus = 'pending' | 'allowed' | 'allowed-tab' | 'denied';

/** `data` of a `permission` transcript item: what a worker asked to do, and the answer. */
export interface PermissionItemData {
  id: string;
  toolName: string;
  input: unknown;
  /** What Allow for this tab would remember, e.g. `Bash(npm test:*)`. */
  rule: string;
  action: string;
  detail: string;
  status: PermissionStatus;
}

export interface TranscriptItem {
  id: string;
  ts: string;
  kind: TranscriptKind;
  text?: string;
  tool?: { id?: string; name: string; input: unknown; output?: string; isError?: boolean };
  data?: unknown;
}

export interface TabWorker {
  provider: Provider;
  model: string | null;
  sessionId: string | null;
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
  /** Auto mode: the worker runs without asking. Otherwise Claude asks the developer and Codex/Gemini stay in their sandboxes. */
  fullAuto: boolean;
  /** Rules the developer allowed for this tab (Allow for this tab). Missing in tab files written before permissions existed. */
  allowedTools?: string[];
  escalations: number;
  stalled: boolean;
  createdAt: string;
  updatedAt: string;
}
