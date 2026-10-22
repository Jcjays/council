import { TIER_ORDER, type Provider, type Tier } from '../adapters/types.js';
import type { BudgetState } from '../ledger/budget.js';

export interface Worker {
  provider: Provider;
  model: string | null;
}

export type TierMap = Record<Tier, Worker>;

export interface RouteDecision {
  tier: Tier;
  provider: Provider;
  model: string | null;
  /** Set when the tier moved because the voted tier's provider was out. */
  shiftedFrom?: Tier;
  reason?: string;
}

/**
 * Picks the worker for a voted tier. An exhausted or unavailable provider shifts
 * the task to the nearest tier above, then the nearest below. With nothing left,
 * the original tier is kept and the reason says so.
 */
export function route(
  tier: Tier,
  map: TierMap,
  budgets: Partial<Record<Provider, BudgetState>>,
  unavailable: Provider[] = [],
): RouteDecision {
  const blocked = (p: Provider) => budgets[p]?.exhausted === true || unavailable.includes(p);
  const why = (p: Provider) => (unavailable.includes(p) ? `${p} CLI is not available` : `${p} ${budgets[p]?.reason ?? 'budget is exhausted'}`);

  const target = map[tier];
  if (!blocked(target.provider)) return { tier, provider: target.provider, model: target.model };

  const idx = TIER_ORDER.indexOf(tier);
  const candidates: Tier[] = [...TIER_ORDER.slice(idx + 1), ...TIER_ORDER.slice(0, idx).reverse()];
  for (const t of candidates) {
    const worker = map[t];
    if (!blocked(worker.provider)) {
      return {
        tier: t,
        provider: worker.provider,
        model: worker.model,
        shiftedFrom: tier,
        reason: `${why(target.provider)}; routed ${tier} to ${t}`,
      };
    }
  }
  return {
    tier,
    provider: target.provider,
    model: target.model,
    reason: `every provider is exhausted or unavailable; keeping ${tier} on ${target.provider}`,
  };
}
