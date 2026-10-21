import fs from 'node:fs/promises';
import path from 'node:path';
import type { Provider, Usage } from '../adapters/types.js';
import { fetchPrices, withAliases, type FetchedPrices } from './priceSources.js';

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
const GEMINI_FLASH: ModelPrice = { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 };
const GEMINI_PRO: ModelPrice = { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 };
const CODEX_MINI: ModelPrice = { inputPerM: 0.25, cachedInputPerM: 0.025, outputPerM: 2 };
const CODEX_STANDARD: ModelPrice = { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 };
const GPT_55: ModelPrice = { inputPerM: 5, cachedInputPerM: 0.5, outputPerM: 30 };

/**
 * Offline fallback, taken from LiteLLM's public price list in October 2026. The
 * live table is fetched automatically (see priceSources.ts). Claude Code reports
 * its own cost, so the Anthropic rows only price the model picker.
 */
export const DEFAULT_PRICING: PriceTable = {
  // Anthropic
  'claude-haiku-5-5': { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 },
  'claude-sonnet-5-5': { inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 },
  'claude-opus-5-5': { inputPerM: 4, cachedInputPerM: 0.2, outputPerM: 20 },
  'claude-fable-5-1': { inputPerM: 10, cachedInputPerM: 0.25, outputPerM: 50 },
  // Google
  'gemini-2.5-flash-lite': GEMINI_FLASH_LITE,
  'gemini-2.5-flash': GEMINI_FLASH,
  'gemini-2.5-pro': GEMINI_PRO,
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

/** Refetch prices once the cached copy is older than this. */
export const PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What `pricing.json` holds. */
export interface PricingFile {
  fetchedAt?: string;
  source?: string;
  /** The last successfully fetched table, aliases included. */
  fetched: PriceTable;
  /** Rows the developer set by hand; they beat everything else. */
  overrides: PriceTable;
  lastError?: string;
}

export interface PricingStatus {
  /** The table in force: defaults, then fetched prices, then overrides. */
  table: PriceTable;
  overrides: PriceTable;
  fetchedAt: string | null;
  source: string;
  lastError: string | null;
}

export type PriceFetcher = () => Promise<FetchedPrices>;

function isPrice(v: unknown): v is ModelPrice {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return ['inputPerM', 'cachedInputPerM', 'outputPerM'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) >= 0);
}

function samePrice(a: ModelPrice | undefined, b: ModelPrice): boolean {
  return a !== undefined && a.inputPerM === b.inputPerM && a.cachedInputPerM === b.cachedInputPerM && a.outputPerM === b.outputPerM;
}

/** The valid price rows of an object; anything else is dropped. */
export function priceRows(v: unknown): PriceTable {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, p]) => isPrice(p))) as PriceTable;
}

/** Reads the current file shape, or the flat table older versions wrote (kept as overrides where it differs from the defaults). */
function parseFile(raw: unknown): PricingFile {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && ('fetched' in raw || 'overrides' in raw)) {
    const f = raw as Record<string, unknown>;
    return {
      fetchedAt: typeof f.fetchedAt === 'string' ? f.fetchedAt : undefined,
      source: typeof f.source === 'string' ? f.source : undefined,
      fetched: priceRows(f.fetched),
      overrides: priceRows(f.overrides),
      lastError: typeof f.lastError === 'string' ? f.lastError : undefined,
    };
  }
  const legacy = priceRows(raw);
  const overrides = Object.fromEntries(Object.entries(legacy).filter(([k, p]) => !samePrice(DEFAULT_PRICING[k], p)));
  return { fetched: {}, overrides };
}

/**
 * Prices backed by `pricing.json`: fetched automatically from public lists and
 * cached with the time and source, the seeded defaults underneath for offline
 * use, and the developer's overrides on top.
 */
export class PricingStore {
  private state: PricingFile;
  private table: PriceTable;
  private inflight: Promise<PricingStatus> | undefined;

  constructor(
    private readonly file: string,
    initial: PricingFile = { fetched: {}, overrides: {} },
    private readonly fetcher: PriceFetcher = () => fetchPrices(),
  ) {
    this.state = structuredClone(initial);
    this.table = this.compute();
  }

  static async open(file: string, fetcher?: PriceFetcher): Promise<PricingStore> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      return new PricingStore(file, parseFile(raw), fetcher);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[council] ${file} could not be read (${(err as Error).message}); using default prices`);
      }
      return new PricingStore(file, undefined, fetcher);
    }
  }

  private compute(): PriceTable {
    return { ...withAliases({ ...DEFAULT_PRICING, ...this.state.fetched }), ...this.state.overrides };
  }

  get(): PriceTable {
    return this.table;
  }

  status(): PricingStatus {
    return {
      table: this.table,
      overrides: { ...this.state.overrides },
      fetchedAt: this.state.fetchedAt ?? null,
      source: this.state.fetchedAt ? (this.state.source ?? 'unknown') : 'built-in defaults',
      lastError: this.state.lastError ?? null,
    };
  }

  isStale(now: Date, maxAgeMs: number = PRICE_MAX_AGE_MS): boolean {
    const at = this.state.fetchedAt ? Date.parse(this.state.fetchedAt) : NaN;
    return Number.isNaN(at) || now.getTime() - at > maxAgeMs;
  }

  /** Fetches fresh prices. A failure keeps the current table and is reported in `lastError`. */
  refresh(now: Date = new Date()): Promise<PricingStatus> {
    this.inflight ??= (async () => {
      try {
        const r = await this.fetcher();
        this.state = {
          ...this.state,
          fetched: r.table,
          fetchedAt: now.toISOString(),
          source: r.source,
          lastError: r.errors.length > 0 ? r.errors.join('; ') : undefined,
        };
      } catch (err) {
        this.state = { ...this.state, lastError: err instanceof Error ? err.message : String(err) };
      }
      this.table = this.compute();
      await this.save();
      return this.status();
    })().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  async refreshIfStale(now: Date = new Date()): Promise<PricingStatus | null> {
    return this.isStale(now) ? this.refresh(now) : null;
  }

  /** Replaces the hand-set rows. */
  async setOverrides(overrides: PriceTable): Promise<PricingStatus> {
    this.state = { ...this.state, overrides: priceRows(overrides) };
    this.table = this.compute();
    await this.save();
    return this.status();
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
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
