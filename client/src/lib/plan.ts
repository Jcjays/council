import type { BudgetState, PricingStatus, ProviderPlan } from '../types';
import { formatUsd } from './format';

export function planKindLabel(plan: ProviderPlan | undefined): string {
  if (!plan) return 'Not detected yet';
  const kind = plan.kind === 'subscription' ? 'Subscription' : plan.kind === 'api-key' ? 'API key, pay per use' : 'Unknown';
  return plan.confirmed ? kind : `${kind} (not yet confirmed by a run)`;
}

/** This period's spend, worded for how the provider is paid for. */
export function spendLine(b: BudgetState): string {
  if (b.plan?.kind === 'subscription') return `${formatUsd(b.spent)} API-equivalent this month (covered by the subscription)`;
  if (b.limit > 0) return `${formatUsd(b.spent)} of a ${formatUsd(b.limit)} monthly cap`;
  return `${formatUsd(b.spent)} spent this month`;
}

/** "Prices updated 21 Oct from LiteLLM + OpenRouter", or why the built-in table is in use. */
export function pricesLine(s: PricingStatus, now: Date = new Date()): string {
  if (!s.fetchedAt) {
    return `Using built-in prices from October 2026; ${s.lastError ? `the last fetch failed (${s.lastError})` : 'they have not been fetched yet'}`;
  }
  const at = new Date(s.fetchedAt);
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = at.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `Prices updated ${date} from ${s.source}`;
}
