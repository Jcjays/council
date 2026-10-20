import { TIER_ORDER, type Tier } from '../adapters/types.js';

export interface Tally {
  decision: Tier;
  counts: Record<Tier, number>;
  tie: boolean;
}

/**
 * Majority wins. A three-way split lands on medium. A two-way tie goes to the
 * higher tier (over-serving slightly beats under-serving). No votes → medium.
 */
export function tally(tiers: Tier[]): Tally {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 };
  for (const t of tiers) counts[t] += 1;
  if (tiers.length === 0) return { decision: 'medium', counts, tie: false };

  const max = Math.max(counts.easy, counts.medium, counts.hard);
  const top = TIER_ORDER.filter((t) => counts[t] === max);
  if (top.length === 1) return { decision: top[0] as Tier, counts, tie: false };
  if (top.length === 3) return { decision: 'medium', counts, tie: true };
  return { decision: top[top.length - 1] as Tier, counts, tie: true };
}
