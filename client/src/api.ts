import type { BudgetState, CliHealth, EffectiveRouting, PriceTable, ProjectInfo, Provider, Settings, SubmitMode, Tab } from './types';

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* keep the status text */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => call<Record<Provider, CliHealth>>('GET', '/api/health'),
  settings: () => call<Settings>('GET', '/api/settings'),
  saveSettings: (partial: Partial<Settings>) => call<Settings>('PUT', '/api/settings', partial),
  pricing: () => call<PriceTable>('GET', '/api/pricing'),
  savePricing: (table: PriceTable) => call<PriceTable>('PUT', '/api/pricing', table),
  budgets: () => call<Record<Provider, BudgetState>>('GET', '/api/budgets'),
  routing: (projectId?: string) => call<EffectiveRouting>('GET', projectId ? `/api/routing?projectId=${encodeURIComponent(projectId)}` : '/api/routing'),
  projects: () => call<ProjectInfo[]>('GET', '/api/projects'),
  openProject: (path: string) => call<ProjectInfo & { tabs: Tab[] }>('POST', '/api/projects', { path }),
  tabs: (projectId?: string) => call<Tab[]>('GET', projectId ? `/api/tabs?projectId=${encodeURIComponent(projectId)}` : '/api/tabs'),
  createTab: (projectRoot: string, title: string) => call<Tab>('POST', '/api/tabs', { projectRoot, title }),
  submit: (id: string, text: string, mode: SubmitMode, fullAuto: boolean) => call<Tab>('POST', `/api/tabs/${id}/submit`, { text, mode, fullAuto }),
  start: (id: string, pick?: { provider: Provider; model: string | null }) => call<Tab>('POST', `/api/tabs/${id}/start`, pick ?? {}),
  send: (id: string, text: string) => call<Tab>('POST', `/api/tabs/${id}/send`, { text }),
  escalate: (id: string) => call<Tab>('POST', `/api/tabs/${id}/escalate`),
  switchWorker: (id: string, provider: Provider, model: string | null) => call<Tab>('POST', `/api/tabs/${id}/switch`, { provider, model }),
  close: (id: string) => call<Tab>('POST', `/api/tabs/${id}/close`, {}),
};
