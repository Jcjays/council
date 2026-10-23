import { PROVIDERS, type CliHealth, type Provider } from '../adapters/types.js';
import type { Settings } from './settings.js';

export type DetectedHealth = Partial<Record<Provider, CliHealth>>;

/**
 * The settings update that follows from what the CLIs reported: the model lists
 * they offer, with any seat model that is no longer on offer cleared back
 * to the CLI default. Providers that reported nothing keep their configured list.
 */
export function detectedModels(current: Settings, health: DetectedHealth): Pick<Settings, 'models' | 'seats'> {
  const models: Record<Provider, string[]> = { ...current.models };
  for (const p of PROVIDERS) {
    const detected = health[p]?.models;
    if (detected && detected.length > 0) models[p] = detected;
  }
  const offers = (provider: Provider, model: string | null) => model === null || (models[provider] ?? []).includes(model);

  const seats = current.seats.map((seat) => (offers(seat.provider, seat.model) ? seat : { ...seat, model: null }));
  return { models, seats };
}

/** The monthly limits suggested by each provider's detected plan; others keep theirs. */
export function detectedBudgets(current: Settings, health: DetectedHealth): Pick<Settings, 'budgets'> {
  const budgets: Record<Provider, number> = { ...current.budgets };
  for (const p of PROVIDERS) {
    const recommended = health[p]?.recommendedBudget;
    if (recommended !== undefined) budgets[p] = recommended;
  }
  return { budgets };
}
