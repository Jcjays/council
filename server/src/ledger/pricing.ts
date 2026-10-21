import fs from 'node:fs/promises';
import path from 'node:path';
import type { Provider, Usage } from '../adapters/types.js';

/** USD per one million tokens. */
export interface ModelPrice {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}

/**
 * Keys are model names (exact or prefix) or `<provider>:default`.
 * Lookup: exact key, then the longest key that prefixes the model name, then the
 * provider default, else no price (cost 0).
 */
export type PriceTable = Record<string, ModelPrice>;

const GEMINI_FLASH_LITE: ModelPrice = { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.4 };
const GEMINI_FLASH: ModelPrice = { inputPerM: 0.3, cachedInputPerM: 0.075, outputPerM: 2.5 };
const GEMINI_PRO: ModelPrice = { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 };
const CODEX_MINI: ModelPrice = { inputPerM: 0.25, cachedInputPerM: 0.03, outputPerM: 2 };
const CODEX_STANDARD: ModelPrice = { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 };
const GPT_55: ModelPrice = { inputPerM: 5, cachedInputPerM: 0.5, outputPerM: 30 };

/**
 * Seeded from public price pages in October 2026 (third-party aggregators; verify
 * against the vendors). Claude Code reports its own cost, so Anthropic models need
 * no entry unless that report is missing. Edit `~/.council/pricing.json`.
 */
export const DEFAULT_PRICING: PriceTable = {
  // Google
  'gemini-2.5-flash-lite': GEMINI_FLASH_LITE,
  'gemini-2.5-flash': GEMINI_FLASH,
  'gemini-2.5-pro': GEMINI_PRO,
  'gemini-3-flash': GEMINI_FLASH,
  'gemini-3-pro': GEMINI_PRO,
  'flash-lite': GEMINI_FLASH_LITE,
  flash: GEMINI_FLASH,
  pro: GEMINI_PRO,
  auto: GEMINI_PRO,
  'gemini:default': GEMINI_FLASH,
  // OpenAI
  'gpt-5.1-codex-mini': CODEX_MINI,
  'codex-mini': CODEX_MINI,
  'gpt-5-codex': CODEX_STANDARD,
  'gpt-5.1-codex': CODEX_STANDARD,
  'gpt-5.1': CODEX_STANDARD,
  'gpt-5.5': GPT_55,
  'codex:default': CODEX_STANDARD,
};

export function lookupPrice(provider: Provider, model: string | null, table: PriceTable): ModelPrice | undefined {
  if (model) {
    const name = model.toLowerCase();
    const exact = table[name] ?? table[model];
    if (exact) return exact;
    let best: string | undefined;
    for (const key of Object.keys(table)) {
      if (key.includes(':')) continue;
      if (name.startsWith(key.toLowerCase()) && (best === undefined || key.length > best.length)) best = key;
    }
    if (best !== undefined) return table[best];
  }
  return table[`${provider}:default`];
}

/** Editable price table backed by `pricing.json`; unknown files start from the defaults. */
export class PricingStore {
  private table: PriceTable;

  constructor(
    private readonly file: string,
    initial: PriceTable = DEFAULT_PRICING,
  ) {
    this.table = structuredClone(initial);
  }

  static async open(file: string): Promise<PricingStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as PriceTable;
      return new PricingStore(file, { ...DEFAULT_PRICING, ...parsed });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[council] ${file} could not be read (${(err as Error).message}); using default prices`);
      }
      return new PricingStore(file);
    }
  }

  get(): PriceTable {
    return this.table;
  }

  async update(partial: PriceTable): Promise<PriceTable> {
    this.table = { ...this.table, ...partial };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(this.table, null, 2)}\n`, 'utf8');
    return this.table;
  }
}

export function costFor(provider: Provider, model: string | null, usage: Usage, table: PriceTable = DEFAULT_PRICING): number {
  const price = lookupPrice(provider, model, table);
  if (!price) return 0;
  return (
    (usage.inputTokens * price.inputPerM + usage.cachedInputTokens * price.cachedInputPerM + usage.outputTokens * price.outputPerM) /
    1_000_000
  );
}
