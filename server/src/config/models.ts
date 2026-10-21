import type { Provider } from '../adapters/types.js';
import { ALIASES } from '../ledger/priceSources.js';
import { lookupPrice, type ModelPrice, type PriceTable } from '../ledger/pricing.js';

export interface ModelInfo {
  id: string;
  label: string;
  /** What the model is good for, in a few words. */
  note: string;
}

/**
 * Each provider's current models, cheapest first. This is the ladder routing
 * climbs (escalation, a single set-up provider) and what the model picker offers.
 * Update it when a provider ships a new model.
 */
export const MODEL_LADDER: Record<Provider, ModelInfo[]> = {
  claude: [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'quick edits' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'everyday coding' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'hard problems' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'strongest' },
  ],
  codex: [
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex mini', note: 'quick edits' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', note: 'everyday coding' },
    { id: 'gpt-5.5', label: 'GPT-5.5', note: 'strongest' },
  ],
  gemini: [
    { id: 'flash-lite', label: 'Flash-Lite', note: 'cheapest' },
    { id: 'flash', label: 'Flash', note: 'everyday coding' },
    { id: 'pro', label: 'Pro', note: 'strongest' },
  ],
};

export function ladderIds(): Record<Provider, string[]> {
  return { claude: MODEL_LADDER.claude.map((m) => m.id), codex: MODEL_LADDER.codex.map((m) => m.id), gemini: MODEL_LADDER.gemini.map((m) => m.id) };
}

export interface ModelChoice extends Partial<ModelInfo> {
  id: string;
  label: string;
  /** USD per million tokens, when the price table knows the model. */
  price?: ModelPrice;
  /** The full model name a short alias stands for (`flash` → `gemini-2.5-flash`). */
  resolves?: string;
}

/** The models offered per provider, in ladder order, with labels and prices. */
export function modelCatalog(models: Record<Provider, string[]>, table: PriceTable): Record<Provider, ModelChoice[]> {
  // A provider-wide default price would put a made-up badge on an unknown model.
  const named = Object.fromEntries(Object.entries(table).filter(([k]) => !k.includes(':'))) as PriceTable;
  const entry = (provider: Provider, id: string): ModelChoice => {
    const info = MODEL_LADDER[provider].find((m) => m.id === id);
    const choice: ModelChoice = { ...info, id, label: info?.label ?? id };
    const price = lookupPrice(provider, id, named);
    if (price) choice.price = price;
    const resolves = ALIASES[id]?.[0];
    if (resolves) choice.resolves = resolves;
    return choice;
  };
  return {
    claude: (models.claude ?? []).map((id) => entry('claude', id)),
    codex: (models.codex ?? []).map((id) => entry('codex', id)),
    gemini: (models.gemini ?? []).map((id) => entry('gemini', id)),
  };
}
