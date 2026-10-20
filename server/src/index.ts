import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters, checkAll } from './adapters/index.js';
import type { CliHealth, Provider } from './adapters/types.js';
import { paths } from './config/paths.js';
import { SettingsStore } from './config/settings.js';
import { createServer } from './http.js';
import { PricingStore } from './ledger/pricing.js';
import { TaskEngine } from './tasks/engine.js';
import { TabStore } from './tasks/store.js';
import { WorktreeManager } from './worktrees/manager.js';

const HEALTH_TTL_MS = 60_000;

function healthCache() {
  let last: Record<Provider, CliHealth> | undefined;
  let fetchedAt = 0;
  let inflight: Promise<Record<Provider, CliHealth>> | undefined;
  return {
    last: () => last,
    get(): Promise<Record<Provider, CliHealth>> {
      if (last && Date.now() - fetchedAt < HEALTH_TTL_MS) return Promise.resolve(last);
      if (!inflight) {
        inflight = checkAll(adapters)
          .then((h) => {
            last = h;
            fetchedAt = Date.now();
            return h;
          })
          .finally(() => {
            inflight = undefined;
          });
      }
      return inflight;
    },
  };
}

async function main(): Promise<void> {
  const p = paths();
  await fs.mkdir(p.home, { recursive: true });
  const settings = await SettingsStore.open(p.settings);
  const pricing = await PricingStore.open(p.pricing);
  const store = new TabStore(p.projects);
  const health = healthCache();

  const engine = new TaskEngine({
    adapters,
    worktrees: (root) => new WorktreeManager(root),
    store,
    ledgerFile: p.ledger,
    settings: () => settings.get(),
    pricing: () => pricing.get(),
    health: () => health.last() ?? {},
  });
  engine.on('engine-error', ({ tabId, error }: { tabId: string; error: unknown }) => {
    console.error(`[council] tab ${tabId}:`, error instanceof Error ? error.message : error);
  });

  for (const root of settings.get().recentProjects) {
    try {
      await engine.loadProject(root);
    } catch (err) {
      console.warn(`[council] could not load tabs for ${root}: ${(err as Error).message}`);
    }
  }
  void health.get();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(here, '..', '..', 'client', 'dist');
  const server = createServer({ engine, settings, pricing, health: () => health.get(), clientDist });
  const port = Number(process.env.PORT ?? 4317);
  const host = process.env.HOST ?? '127.0.0.1';
  const bound = await server.listen(port, host);
  console.log(`Council is running at http://localhost:${bound}  (data in ${p.home})`);
}

main().catch((err: unknown) => {
  console.error('[council] failed to start:', err);
  process.exit(1);
});
