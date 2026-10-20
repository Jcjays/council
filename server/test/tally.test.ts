import { expect, test } from 'vitest';
import { tally } from '../src/council/tally.js';

test('majority wins', () => {
  expect(tally(['easy', 'easy', 'hard'])).toEqual({ decision: 'easy', counts: { easy: 2, medium: 0, hard: 1 }, tie: false });
});

test('a three-way split goes to medium', () => {
  expect(tally(['easy', 'medium', 'hard'])).toEqual({ decision: 'medium', counts: { easy: 1, medium: 1, hard: 1 }, tie: true });
});

test('a two-way tie goes to the higher tier', () => {
  expect(tally(['easy', 'hard'])).toMatchObject({ decision: 'hard', tie: true });
  expect(tally(['medium', 'medium', 'hard', 'hard'])).toMatchObject({ decision: 'hard', tie: true });
  expect(tally(['easy', 'easy', 'medium', 'medium'])).toMatchObject({ decision: 'medium', tie: true });
});

test('an empty council defaults to medium without a tie', () => {
  expect(tally([])).toEqual({ decision: 'medium', counts: { easy: 0, medium: 0, hard: 0 }, tie: false });
});

test('a single vote is the decision', () => {
  expect(tally(['hard'])).toMatchObject({ decision: 'hard', tie: false });
});
