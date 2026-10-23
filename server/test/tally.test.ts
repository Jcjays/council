import { expect, test } from 'vitest';
import { consensusComplexity } from '../src/council/tally.js';
import type { Vote } from '../src/council/vote.js';

test('calculates consensus complexity as average of votes', () => {
  const votes: Vote[] = [
    { confidence: 0.9, complexity: 1, reason: 'r1' },
    { confidence: 0.8, complexity: 2, reason: 'r2' },
    { confidence: 0.7, complexity: 3, reason: 'r3' },
  ];
  expect(consensusComplexity(votes)).toBe(2);
});

test('clamps consensus complexity between 1 and 5', () => {
  const low: Vote[] = [{ confidence: 0.9, complexity: 1, reason: 'r' }];
  expect(consensusComplexity(low)).toBe(1);

  const high: Vote[] = [{ confidence: 0.5, complexity: 5, reason: 'r' }];
  expect(consensusComplexity(high)).toBe(5);
});

test('defaults to 3 when no votes are present', () => {
  expect(consensusComplexity([])).toBe(3);
});
