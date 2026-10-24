import type { Provider, Tier } from '../adapters/types.js';
import type { BudgetState } from '../ledger/budget.js';
import { tierOf, type Rung } from './ladder.js';

export interface Worker {
  provider: Provider;
  model: string | null;
}

export interface RouteDecision {
  index: number;
  provider: Provider;
  model: string;
  tier: Tier;
  /** Set when the pick moved because its provider could not run. */
  shiftedFrom?: number;
  reason?: string;
}

/**
 * Resolves a ladder pick against what can run right now. A provider that is
 * exhausted or unavailable moves the pick to the nearest usable rung above,
 * then (unless `upOnly`) the nearest below. With nothing usable the pick is
 * kept and the reason says so; `upOnly` returns null instead.
 */
export function route(
  index: number,
  ladder: Rung[],
  budgets: Partial<Record<Provider, BudgetState>>,
  unavailable: Provider[] = [],
  opts: { upOnly?: boolean } = {},
): RouteDecision | null {
  const size = ladder.length;
  if (size === 0) return null;
  const at = Math.min(Math.max(0, index), size - 1);
  const target = ladder[at] as Rung;

  const blocked = (p: Provider) => budgets[p]?.exhausted === true || unavailable.includes(p);
  const why = (p: Provider) => (unavailable.includes(p) ? `${p} CLI is not available` : `${p} ${budgets[p]?.reason ?? 'budget is exhausted'}`);
  const decide = (r: Rung): RouteDecision => ({ index: r.index, provider: r.provider, model: r.model, tier: tierOf(r.index, size) });

  if (!blocked(target.provider)) return decide(target);

  const up = ladder.slice(at + 1);
  const down = opts.upOnly ? [] : ladder.slice(0, at).reverse();
  for (const rung of [...up, ...down]) {
    if (!blocked(rung.provider)) {
      return { ...decide(rung), shiftedFrom: at, reason: `${why(target.provider)}; moved from ${target.label} to ${rung.label}` };
    }
  }
  if (opts.upOnly) return null;
  return { ...decide(target), reason: `every provider is exhausted or unavailable; keeping ${target.label}` };
}
