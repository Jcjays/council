import type { Provider, Tab } from '../types';

export interface WorkerPick {
  provider: Provider;
  model: string | null;
}

/** On a follow-up the composer's selector shows the worker the tab already has. */
export function followUpSelection(tab: Pick<Tab, 'worker'>): WorkerPick | null {
  return tab.worker ? { provider: tab.worker.provider, model: tab.worker.model } : null;
}

/** Whether a selection differs from the current worker; an empty model means the CLI default. */
export function selectionChangesWorker(current: WorkerPick | null, provider: Provider, model: string): boolean {
  if (!current) return true;
  return current.provider !== provider || (model.trim() || null) !== current.model;
}

/**
 * What the composer's command-permission buttons mean.
 * `restricted` is the default: edits are auto-approved, shell commands are held to
 * the allow-list, and Codex keeps its sandbox. `full-auto` and `always` drop all of
 * that for the tab (`--dangerously-skip-permissions` and friends), so only an
 * explicit choice may select them.
 */
export type PermissionChoice = 'restricted' | 'full-auto' | 'always';

export const DEFAULT_PERMISSION: PermissionChoice = 'restricted';

export function fullAutoFor(permission: PermissionChoice): boolean {
  return permission === 'full-auto' || permission === 'always';
}
