import fs from 'node:fs/promises';
import path from 'node:path';
import type { Provider } from '../adapters/types.js';
import type { Seat } from '../council/council.js';
import type { TierMap } from '../council/routing.js';

export type ProjectOverride = Partial<Pick<Settings, 'allowedCommands' | 'autoStart' | 'autoEscalate'>>;

export interface Settings {
  /** Monthly USD credit per provider; 0 disables tracking for that provider. */
  budgets: Record<Provider, number>;
  warnPct: number;
  resetDay: number;
  seats: Seat[];
  tierMap: TierMap;
  autoStart: boolean;
  autoEscalate: boolean;
  stallMinutes: number;
  seatTimeoutMs: number;
  voteCostCeiling: number;
  /** Claude `--allowedTools` entries for workers that are not in Full auto. */
  allowedCommands: string[];
  /** Model choices offered in the UI per provider. */
  models: Record<Provider, string[]>;
  recentProjects: string[];
  projectOverrides: Record<string, ProjectOverride>;
}

export const DEFAULT_SETTINGS: Settings = {
  budgets: { claude: 40, codex: 30, gemini: 30 },
  warnPct: 0.8,
  resetDay: 1,
  seats: [
    { provider: 'gemini', model: 'flash' },
    { provider: 'codex', model: 'gpt-5.1-codex-mini' },
    { provider: 'claude', model: 'claude-haiku-5-5' },
  ],
  tierMap: {
    easy: { provider: 'gemini', model: 'flash' },
    medium: { provider: 'codex', model: null },
    hard: { provider: 'claude', model: 'claude-sonnet-5-5' },
  },
  autoStart: false,
  autoEscalate: true,
  stallMinutes: 10,
  seatTimeoutMs: 60_000,
  voteCostCeiling: 0.05,
  allowedCommands: [
    'Bash(npm test*)',
    'Bash(npm run *)',
    'Bash(npx *)',
    'Bash(pnpm *)',
    'Bash(yarn *)',
    'Bash(node *)',
    'Bash(git status*)',
    'Bash(git diff*)',
    'Bash(git log*)',
    'Bash(git add*)',
    'Bash(git commit*)',
    'Bash(ls*)',
    'Bash(cat *)',
    'Bash(./gradlew *)',
    'Bash(gradle *)',
    'Bash(mvn *)',
    'Bash(cargo *)',
    'Bash(go *)',
    'Bash(python *)',
    'Bash(pytest*)',
    'Bash(dotnet *)',
  ],
  models: {
    claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
    codex: ['gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.5'],
    gemini: ['flash-lite', 'flash', 'pro'],
  },
  recentProjects: [],
  projectOverrides: {},
};

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Defaults overlaid with the file: record-valued keys merge one level deep, arrays and scalars replace. */
export function mergeSettings(base: Settings, partial: unknown): Settings {
  if (!isObject(partial)) return structuredClone(base);
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    if (!(key in out)) continue;
    const current = out[key];
    if (isObject(current) && isObject(value) && !Array.isArray(current)) {
      out[key] = { ...current, ...value };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as unknown as Settings;
}

export async function loadSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_SETTINGS);
    throw err;
  }
  try {
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(text));
  } catch (err) {
    console.warn(`[council] ${file} is not valid JSON (${(err as Error).message}); using defaults`);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(file: string, settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function effectiveSettings(settings: Settings, projectId: string): Settings {
  const override = settings.projectOverrides[projectId];
  return override ? { ...settings, ...override } : settings;
}

/** Live settings backed by a JSON file. `get()` always returns the current value. */
export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly file: string,
    initial?: Settings,
  ) {
    this.current = initial ?? structuredClone(DEFAULT_SETTINGS);
  }

  static async open(file: string): Promise<SettingsStore> {
    return new SettingsStore(file, await loadSettings(file));
  }

  get(): Settings {
    return this.current;
  }

  async update(partial: unknown): Promise<Settings> {
    this.current = mergeSettings(this.current, partial);
    await saveSettings(this.file, this.current);
    return this.current;
  }

  async addRecentProject(root: string): Promise<void> {
    const recent = [root, ...this.current.recentProjects.filter((r) => r !== root)].slice(0, 20);
    await this.update({ recentProjects: recent });
  }
}
