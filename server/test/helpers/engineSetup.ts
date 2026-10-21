import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, Provider, RunOptions } from '../../src/adapters/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../../src/config/settings.js';
import { DEFAULT_PRICING } from '../../src/ledger/pricing.js';
import { TaskEngine } from '../../src/tasks/engine.js';
import { TabStore } from '../../src/tasks/store.js';
import { FakeAdapter, registry, voteEvents, workEvents } from './fakeAdapter.js';

export interface EngineFixture {
  engine: TaskEngine;
  ledgerFile: string;
  home: string;
  adapters: Record<Provider, FakeAdapter>;
  settings: Settings;
}

export function simpleAdapter(provider: Provider, tier: string): FakeAdapter {
  return new FakeAdapter(provider, (opts: RunOptions) =>
    opts.purpose === 'vote' ? { events: voteEvents(tier) } : { events: workEvents(`${provider}-session`, `${provider} did it`) },
  );
}

/** A TaskEngine wired to fake adapters, fake worktrees and a temp home. */
export function makeEngine(overrides: Partial<Settings> = {}): EngineFixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fixture-'));
  const ledgerFile = path.join(home, 'ledger.jsonl');
  const adapters: Record<Provider, FakeAdapter> = {
    gemini: simpleAdapter('gemini', 'easy'),
    codex: simpleAdapter('codex', 'easy'),
    claude: simpleAdapter('claude', 'hard'),
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const engine = new TaskEngine({
    adapters: registry(adapters.claude, adapters.codex, adapters.gemini) as Record<Provider, Adapter>,
    diffStat: async () => ' a.txt | 1 +',
    store: new TabStore(path.join(home, 'projects')),
    ledgerFile,
    settings: () => settings,
    pricing: () => DEFAULT_PRICING,
    snapshot: async () => 'Top-level: src/',
  });
  engine.on('engine-error', () => {});
  return { engine, ledgerFile, home, adapters, settings };
}
