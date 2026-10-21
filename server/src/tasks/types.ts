import type { Provider, Tier } from '../adapters/types.js';
import type { CouncilResult } from '../council/council.js';
import type { TabStatus } from './state.js';

export type TranscriptKind = 'user' | 'assistant' | 'tool' | 'system' | 'vote' | 'result' | 'error';

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
  routing: { shiftedFrom?: Tier; reason?: string } | null;
  transcript: TranscriptItem[];
  costUsd: number;
  fullAuto: boolean;
  escalations: number;
  stalled: boolean;
  createdAt: string;
  updatedAt: string;
}
