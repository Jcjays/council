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
