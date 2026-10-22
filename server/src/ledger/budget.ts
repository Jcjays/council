import type { Provider, ProviderPlan, QuotaWindow } from '../adapters/types.js';
import type { ProviderSums } from './ledger.js';

/** The latest usage windows a provider's CLI reported for this account. */
export interface ProviderUsage {
  windows: QuotaWindow[];
  observedAt: string;
}

export interface BudgetState {
  provider: Provider;
  /** How the CLI is paid for, as detected; absent until known. */
  plan?: ProviderPlan;
  /** Windows that have not reset yet; present once a run reported them. */
  usage?: ProviderUsage;
  /** Spend this period from the ledger (API-equivalent for a subscription). */
  spent: number;
  routingSpent: number;
  /** Monthly cap in USD for a metered account; 0 = no cap. Always 0 for a subscription. */
  limit: number;
  /** Fullest window for a subscription, else spent / limit (0 without a cap). */
  pct: number;
  warning: boolean;
  exhausted: boolean;
  /** Why it is near or out, completing "<provider> …", e.g. "has used up its 5-hour window". */
  reason?: string;
}

export interface BudgetContext {
  plan?: ProviderPlan;
  usage?: ProviderUsage;
  now?: Date;
}

/** Windows still running at `now`; one without a reset time is kept. */
function liveWindows(usage: ProviderUsage | undefined, now: Date): QuotaWindow[] {
  return (usage?.windows ?? []).filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now.getTime());
}

/**
 * A subscription is judged by its usage windows: amber at `warnPct` of the
 * fullest window, out at 100% until it resets. A metered (API-key) account is
 * judged by the optional monthly cap.
 */
export function budgetState(provider: Provider, sums: ProviderSums, cap: number, warnPct = 0.8, ctx: BudgetContext = {}): BudgetState {
  const now = ctx.now ?? new Date();
  const windows = liveWindows(ctx.usage, now);
  const base: BudgetState = { provider, spent: sums.spent, routingSpent: sums.routingSpent, limit: cap, pct: 0, warning: false, exhausted: false };
  if (ctx.plan) base.plan = ctx.plan;
  if (ctx.usage) base.usage = { ...ctx.usage, windows };

  const subscription = ctx.plan ? ctx.plan.kind === 'subscription' : (ctx.usage?.windows.length ?? 0) > 0;
  if (subscription) {
    base.limit = 0;
    const fullest = windows.reduce<QuotaWindow | undefined>((a, w) => (!a || w.usedPct > a.usedPct ? w : a), undefined);
    if (!fullest) return base;
    const pct = fullest.usedPct;
    const exhausted = pct >= 1;
    const warning = pct >= warnPct;
    const out: BudgetState = { ...base, pct, warning, exhausted };
    if (exhausted) out.reason = `has used up its ${fullest.name} window`;
    else if (warning) out.reason = `has used ${Math.round(pct * 100)}% of its ${fullest.name} window`;
    return out;
  }

  if (cap <= 0) return base;
  const pct = sums.spent / cap;
  const out: BudgetState = { ...base, pct, warning: pct >= warnPct, exhausted: pct >= 1 };
  if (out.exhausted) out.reason = `has reached its $${cap} monthly cap`;
  else if (out.warning) out.reason = `has spent ${Math.round(pct * 100)}% of its $${cap} monthly cap`;
  return out;
}
