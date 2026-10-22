import type { PermissionItemData, PermissionStatus, Provider, Tab } from '../types';

/** The request the worker is waiting on, if any. */
export function pendingPermission(tab: Pick<Tab, 'transcript'>): PermissionItemData | null {
  for (let i = tab.transcript.length - 1; i >= 0; i--) {
    const item = tab.transcript[i];
    if (item?.kind !== 'permission') continue;
    const data = item.data as PermissionItemData | undefined;
    if (data?.status === 'pending') return data;
  }
  return null;
}

/** What "Allow for this tab" covers: `Bash(npm test:*)` → "npm test …". */
export function ruleLabel(rule: string): string {
  const m = /^\w+\((.*)\)$/.exec(rule);
  if (!m || m[1] === undefined) return rule;
  return m[1].endsWith(':*') ? `${m[1].slice(0, -2)} …` : 'this exact command';
}

const VERBS: Record<PermissionStatus, string> = {
  pending: 'Waiting for you',
  allowed: 'Allowed once',
  'allowed-tab': 'Allowed for this tab',
  denied: 'Denied',
};

export function permissionVerb(status: PermissionStatus): string {
  return VERBS[status];
}

/** What "Ask me" means for each CLI; only Claude Code can ask in headless mode. */
export function askModeNote(provider: Provider): string {
  switch (provider) {
    case 'claude':
      return 'Claude edits files freely and asks you before running a command or using another tool.';
    case 'codex':
      return 'Codex cannot ask when headless: it edits freely and runs commands inside its workspace-write sandbox (no network).';
    case 'gemini':
      return 'Gemini cannot ask when headless: it applies edits and skips anything else that would need approval, such as shell commands.';
  }
}

export const AUTO_NOTE = 'No prompts and no sandbox: the worker runs any command it decides to (Claude --dangerously-skip-permissions, Codex without its sandbox, Gemini yolo).';
