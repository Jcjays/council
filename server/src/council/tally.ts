import type { Vote } from './vote.js';

/**
 * Calculates consensus complexity as the rounded average of valid seat votes,
 * clamped to 1..5. Defaults to 3 if no votes are provided.
 */
export function consensusComplexity(votes: Vote[]): number {
  if (votes.length === 0) return 3;
  const avg = votes.reduce((sum, v) => sum + v.complexity, 0) / votes.length;
  return Math.min(5, Math.max(1, Math.round(avg)));
}
