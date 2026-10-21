import type { Provider, QuotaWindow } from '../adapters/types.js';
import type { ProviderSums } from './ledger.js';

/** The latest usage windows a provider's CLI reported for this account. */
export interface ProviderUsage {
  windows: QuotaWindow[];
  observedAt: string;
}

export interface TokenSums {
  input: number;
  output: number;
  cached: number;
  total: number;
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
  tokens?: TokenSums;
}

export function budgetState(provider: Provider, sums: ProviderSums, limit: number, warnPct = 0.8): BudgetState {
  const tokens: TokenSums = {
    input: sums.inputTokens ?? 0,
    output: sums.outputTokens ?? 0,
    cached: sums.cachedTokens ?? 0,
    total: sums.totalTokens ?? 0,
  };
  const base = { provider, spent: sums.spent, routingSpent: sums.routingSpent, limit, tokens };
  if (limit <= 0) return { ...base, pct: 0, warning: false, exhausted: false };
  const pct = sums.spent / limit;
  return { ...base, pct, warning: pct >= warnPct, exhausted: pct >= 1 };
}
