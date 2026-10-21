import type { Provider, QuotaWindow } from '../adapters/types.js';
import type { ProviderSums } from './ledger.js';

/** The latest usage windows a provider's CLI reported for this account. */
export interface ProviderUsage {
  windows: QuotaWindow[];
  observedAt: string;
}

export interface BudgetState {
  /** Present once a CLI run has reported its plan usage; absent for plain API keys. */
  usage?: ProviderUsage;
  provider: Provider;
  spent: number;
  routingSpent: number;
  limit: number;
  /** spent / limit; 0 when the limit is 0 (tracking disabled). */
  pct: number;
  warning: boolean;
  exhausted: boolean;
}

export function budgetState(provider: Provider, sums: ProviderSums, limit: number, warnPct = 0.8): BudgetState {
  const base = { provider, spent: sums.spent, routingSpent: sums.routingSpent, limit };
  if (limit <= 0) return { ...base, pct: 0, warning: false, exhausted: false };
  const pct = sums.spent / limit;
  return { ...base, pct, warning: pct >= warnPct, exhausted: pct >= 1 };
}
