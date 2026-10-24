import { TIER_ORDER, type Tier } from '../adapters/types.js';
import { firstRungOf, type Rung } from './ladder.js';
import type { Vote } from './vote.js';

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

export interface RungPick {
  index: number;
  /** How the rung was chosen, in plain words. */
  reason: string;
  /** True when unsure seats moved the pick one rung up. */
  lowConfidence: boolean;
}

/** Below this average confidence the pick moves one rung up. */
export const MIN_CONFIDENCE = 0.6;

/**
 * The rung the council settles on: the model most seats named (a tie goes to the
 * stronger one); when no seat named a model, the first rung of the complexity
 * band they agreed on. Unsure seats push the pick one rung up.
 */
export function pickRung(votes: Vote[], ladder: Rung[], minConfidence = MIN_CONFIDENCE): RungPick | null {
  if (votes.length === 0 || ladder.length === 0) return null;
  const size = ladder.length;
  const label = (i: number) => ladder[i]?.label ?? `rung ${i}`;

  const named = votes.map((v) => (v.model ? ladder.findIndex((r) => r.model === v.model) : -1)).filter((i) => i >= 0);
  let index: number;
  let reason: string;
  if (named.length > 0) {
    const counts = new Map<number, number>();
    for (const i of named) counts.set(i, (counts.get(i) ?? 0) + 1);
    const max = Math.max(...counts.values());
    index = Math.max(...[...counts.entries()].filter(([, n]) => n === max).map(([i]) => i));
    reason = `${max} of ${votes.length} seat${votes.length === 1 ? '' : 's'} chose ${label(index)}`;
    if ([...counts.values()].filter((n) => n === max).length > 1) reason += ' (tie, strongest wins)';
  } else {
    const verdict = tally(votes.map((v) => v.tier)).decision;
    index = firstRungOf(verdict, size);
    reason = `no seat named a model; ${verdict} tasks start at ${label(index)}`;
  }

  const mean = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
  let lowConfidence = false;
  if (mean < minConfidence && index < size - 1) {
    index += 1;
    lowConfidence = true;
    reason += `; the seats were unsure (average confidence ${Math.round(mean * 100)}%), so one rung up to ${label(index)}`;
  }
  return { index, reason, lowConfidence };
}
