import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS, type Provider, type ProviderPlan } from '../adapters/types.js';
import type { ProviderUsage } from './budget.js';

/** What the CLIs last said about each account: how it is paid for, and its usage windows. */
export interface ProviderObservation {
  plan?: ProviderPlan;
  usage?: ProviderUsage;
}

type Observations = Partial<Record<Provider, ProviderObservation>>;

function parse(raw: unknown): Observations {
  if (!raw || typeof raw !== 'object') return {};
  const out: Observations = {};
  for (const p of PROVIDERS) {
    const o = (raw as Record<string, unknown>)[p];
    if (o && typeof o === 'object') out[p] = o as ProviderObservation;
  }
  return out;
}

/**
 * Observed plans and usage windows, kept in `usage.json` so the Plan & usage
 * panel and window-based routing survive a restart. Without a file it is
 * memory-only. Writes are serialized; `flush()` waits for them.
 */
export class UsageStore {
  private data: Observations;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file?: string,
    initial: Observations = {},
  ) {
    this.data = structuredClone(initial);
  }

  static async open(file: string): Promise<UsageStore> {
    try {
      return new UsageStore(file, parse(JSON.parse(await fs.readFile(file, 'utf8'))));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[council] ${file} could not be read (${(err as Error).message}); usage starts empty`);
      }
      return new UsageStore(file);
    }
  }

  plan(provider: Provider): ProviderPlan | undefined {
    return this.data[provider]?.plan;
  }

  usage(provider: Provider): ProviderUsage | undefined {
    return this.data[provider]?.usage;
  }

  notePlan(provider: Provider, plan: ProviderPlan): void {
    this.data[provider] = { ...this.data[provider], plan };
    this.save();
  }

  noteUsage(provider: Provider, usage: ProviderUsage): void {
    this.data[provider] = { ...this.data[provider], usage };
    this.save();
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private save(): void {
    const file = this.file;
    if (!file) return;
    const text = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writing = this.writing
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text, 'utf8');
      })
      .catch((err: unknown) => console.warn(`[council] could not save ${file}: ${(err as Error).message}`));
  }
}
