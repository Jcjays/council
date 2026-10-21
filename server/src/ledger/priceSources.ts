import type { ModelPrice, PriceTable } from './pricing.js';

/** Public, keyless price lists. LiteLLM's is the primary source; OpenRouter fills the gaps. */
export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

const FETCH_TIMEOUT_MS = 20_000;

/** Model names Council can route to: Claude, OpenAI (GPT, o-series, Codex) and Gemini. */
const OUR_MODELS = /^(claude-|gpt-|o\d|codex-|gemini-)/;

/** LiteLLM providers that sell the model directly (not through a cloud reseller). */
const LITELLM_DIRECT = new Set(['anthropic', 'openai', 'gemini', 'vertex_ai-language-models']);
const LITELLM_MODES = new Set(['chat', 'responses']);

/**
 * Council's short names, mapped to the model they mean today (Gemini CLI 0.15:
 * flash = gemini-2.5-flash, pro = gemini-2.5-pro). The first candidate that has
 * a price wins.
 */
export const ALIASES: Record<string, string[]> = {
  'flash-lite': ['gemini-2.5-flash-lite'],
  flash: ['gemini-2.5-flash'],
  pro: ['gemini-2.5-pro'],
  auto: ['gemini-2.5-pro'],
  'gemini:default': ['gemini-2.5-flash'],
  'codex-mini': ['gpt-5.1-codex-mini'],
  'codex:default': ['gpt-5.1-codex'],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** USD per token (number or numeric string) to USD per million tokens; undefined when unusable. */
function perMillion(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Number((n * 1_000_000).toPrecision(6));
}

function price(input: unknown, cached: unknown, output: unknown): ModelPrice | undefined {
  const inputPerM = perMillion(input);
  const outputPerM = perMillion(output);
  if (inputPerM === undefined || outputPerM === undefined || inputPerM + outputPerM === 0) return undefined;
  return { inputPerM, cachedInputPerM: perMillion(cached) ?? inputPerM, outputPerM };
}

/** `model_prices_and_context_window.json` → price table keyed by bare model name. */
export function fromLiteLLM(json: unknown): PriceTable {
  if (!isObject(json)) return {};
  const table: PriceTable = {};
  // Gemini API rows (`gemini/<model>`) are what an API key pays; they beat Vertex rows of the same name.
  const fromGeminiApi = new Set<string>();
  for (const [key, value] of Object.entries(json)) {
    if (!isObject(value)) continue;
    const provider = value.litellm_provider;
    if (typeof provider !== 'string' || !LITELLM_DIRECT.has(provider)) continue;
    if (typeof value.mode !== 'string' || !LITELLM_MODES.has(value.mode)) continue;
    const viaGeminiApi = key.startsWith('gemini/');
    const name = (viaGeminiApi ? key.slice('gemini/'.length) : key).toLowerCase();
    if (name.includes('/') || !OUR_MODELS.test(name)) continue;
    const p = price(value.input_cost_per_token, value.cache_read_input_token_cost, value.output_cost_per_token);
    if (!p) continue;
    if (fromGeminiApi.has(name) && !viaGeminiApi) continue;
    table[name] = p;
    if (viaGeminiApi) fromGeminiApi.add(name);
  }
  return table;
}

const OPENROUTER_VENDORS = new Set(['anthropic', 'openai', 'google']);

/** OpenRouter `/api/v1/models` → price table. Anthropic ids use dots (`claude-haiku-5.5`); the CLI uses dashes. */
export function fromOpenRouter(json: unknown): PriceTable {
  if (!isObject(json) || !Array.isArray(json.data)) return {};
  const table: PriceTable = {};
  for (const model of json.data) {
    if (!isObject(model) || typeof model.id !== 'string' || model.id.includes(':')) continue;
    const slash = model.id.indexOf('/');
    if (slash < 0) continue;
    const vendor = model.id.slice(0, slash);
    if (!OPENROUTER_VENDORS.has(vendor)) continue;
    let name = model.id.slice(slash + 1).toLowerCase();
    if (vendor === 'anthropic') name = name.replace(/(\d)\.(\d)/g, '$1-$2');
    if (!OUR_MODELS.test(name) || !isObject(model.pricing)) continue;
    const p = price(model.pricing.prompt, model.pricing.input_cache_read, model.pricing.completion);
    if (p) table[name] = p;
  }
  return table;
}

/** Points every alias at its model's row, where the table has one. */
export function withAliases(table: PriceTable): PriceTable {
  const out = { ...table };
  for (const [alias, candidates] of Object.entries(ALIASES)) {
    const target = candidates.find((c) => table[c] !== undefined);
    if (target) out[alias] = { ...(table[target] as ModelPrice) };
  }
  return out;
}

export interface FetchedPrices {
  table: PriceTable;
  /** Which sources answered, e.g. "LiteLLM + OpenRouter". */
  source: string;
  /** One line per source that failed. */
  errors: string[];
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches both public lists. LiteLLM wins where both price a model. Throws only
 * when neither source produced any price.
 */
export async function fetchPrices(fetchImpl: typeof fetch = fetch): Promise<FetchedPrices> {
  const sources = [
    { name: 'LiteLLM', url: LITELLM_URL, map: fromLiteLLM },
    { name: 'OpenRouter', url: OPENROUTER_URL, map: fromOpenRouter },
  ];
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        const table = s.map(await getJson(fetchImpl, s.url));
        if (Object.keys(table).length === 0) throw new Error('no prices for Claude, OpenAI or Gemini models');
        return { name: s.name, table };
      } catch (err) {
        return { name: s.name, error: `${s.name}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }),
  );
  const ok = results.filter((r): r is { name: string; table: PriceTable } => 'table' in r);
  const errors = results.flatMap((r) => ('error' in r && r.error ? [r.error] : []));
  if (ok.length === 0) throw new Error(errors.join('; '));
  const merged: PriceTable = {};
  for (const r of [...ok].reverse()) Object.assign(merged, r.table);
  return { table: withAliases(merged), source: ok.map((r) => r.name).join(' + '), errors };
}
