import type { Tier } from '../adapters/types.js';

export const TAB_STATUSES = ['drafting', 'voting', 'awaiting-start', 'running', 'idle', 'handing-off', 'failed', 'closed'] as const;
export type TabStatus = (typeof TAB_STATUSES)[number];

export type TabEvent =
  | 'submit-auto'
  | 'submit-manual'
  | 'vote-done'
  | 'vote-done-autostart'
  | 'start'
  | 'worker-done'
  | 'worker-failed'
  | 'message'
  | 'escalate'
  | 'switch'
  | 'handoff-ready'
  | 'close';

export class InvalidTransition extends Error {
  constructor(
    public readonly from: TabStatus,
    public readonly event: TabEvent,
  ) {
    super(`a tab in state "${from}" cannot take the event "${event}"`);
    this.name = 'InvalidTransition';
  }
}

const TABLE: Record<TabStatus, Partial<Record<TabEvent, TabStatus>>> = {
  drafting: { 'submit-auto': 'voting', 'submit-manual': 'running' },
  voting: { 'vote-done': 'awaiting-start', 'vote-done-autostart': 'running' },
  'awaiting-start': { start: 'running' },
  running: { 'worker-done': 'idle', 'worker-failed': 'failed' },
  idle: { message: 'running', escalate: 'handing-off', switch: 'handing-off' },
  failed: { message: 'running', escalate: 'handing-off', switch: 'handing-off' },
  'handing-off': { 'handoff-ready': 'running' },
  closed: {},
};

/** Pure transition; `close` is allowed from every state. */
export function transition(from: TabStatus, event: TabEvent): TabStatus {
  if (event === 'close') return 'closed';
  const next = TABLE[from][event];
  if (!next) throw new InvalidTransition(from, event);
  return next;
}

export function canEscalate(tier: Tier): boolean {
  return tier !== 'hard';
}
