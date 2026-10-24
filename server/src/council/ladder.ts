import type { Provider, Tier } from '../adapters/types.js';
import type { ModelChoice } from '../config/models.js';
import type { ModelPrice } from '../ledger/pricing.js';

/** Providers from cheapest to dearest; breaks ties between equally priced models. */
export const CHEAP_FIRST: Provider[] = ['gemini', 'codex', 'claude'];

/** One model on the ladder the council chooses from: every set-up provider's models, cheapest first. */
export interface Rung {
  index: number;
  provider: Provider;
  model: string;
  label: string;
  note?: string;
  price?: ModelPrice;
}

/** A single number to sort by: output tokens dominate a coding run. */
function score(price?: ModelPrice): number | null {
  return price ? price.inputPerM + 3 * price.outputPerM : null;
}

/**
 * The models of the providers that are set up, as one list cheapest first.
 * Models without a known price keep their place within their provider and sort
 * after every priced model.
 */
export function buildLadder(catalog: Record<Provider, ModelChoice[]>, available: Provider[]): Rung[] {
  const entries: { provider: Provider; choice: ModelChoice; order: number }[] = [];
  CHEAP_FIRST.filter((p) => available.includes(p)).forEach((provider, pi) => {
    (catalog[provider] ?? []).forEach((choice, ci) => entries.push({ provider, choice, order: pi * 100 + ci }));
  });
  entries.sort((a, b) => {
    const sa = score(a.choice.price);
    const sb = score(b.choice.price);
    if (sa !== null && sb !== null && sa !== sb) return sa - sb;
    if (sa === null && sb !== null) return 1;
    if (sa !== null && sb === null) return -1;
    return a.order - b.order;
  });
  return entries.map((e, index) => {
    const rung: Rung = { index, provider: e.provider, model: e.choice.id, label: e.choice.label };
    if (e.choice.note) rung.note = e.choice.note;
    if (e.choice.price) rung.price = e.choice.price;
    return rung;
  });
}

/** Which third of the ladder a rung sits in: the bottom third is easy, the top third hard. */
export function tierOf(index: number, size: number): Tier {
  if (size <= 1) return 'medium';
  const easyCount = Math.max(1, Math.floor(size / 3));
  const hardStart = size - Math.ceil(size / 3);
  if (index < easyCount) return 'easy';
  if (index >= hardStart) return 'hard';
  return 'medium';
}

export function rungFor(ladder: Rung[], provider: Provider, model: string | null): Rung | undefined {
  if (!model) return undefined;
  return ladder.find((r) => r.provider === provider && r.model === model);
}

/** The first rung of a complexity band; where a vote without a model pick lands. */
export function firstRungOf(tier: Tier, size: number): number {
  if (size <= 0) return 0;
  for (let i = 0; i < size; i++) if (tierOf(i, size) === tier) return i;
  return tier === 'hard' ? size - 1 : 0;
}
