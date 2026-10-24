import { expect, test } from 'vitest';
import type { Rung } from '../src/council/ladder.js';
import { pickRung, tally } from '../src/council/tally.js';
import type { Vote } from '../src/council/vote.js';

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

const rung = (index: number, model: string): Rung => ({ index, provider: 'claude', model, label: model });
const ladder: Rung[] = [rung(0, 'haiku'), rung(1, 'sonnet'), rung(2, 'opus'), rung(3, 'fable')];
const v = (model: string | null, confidence: number, tier: Vote['tier'] = 'medium'): Vote => ({ model, tier, confidence, reason: 'r' });

test('pickRung: the model most seats chose wins', () => {
  expect(pickRung([v('sonnet', 0.8), v('sonnet', 0.9), v('opus', 0.7)], ladder)).toMatchObject({ index: 1, lowConfidence: false });
});

test('pickRung: a tie goes to the stronger model', () => {
  expect(pickRung([v('haiku', 0.9), v('sonnet', 0.9)], ladder)?.index).toBe(1);
});

test('pickRung: unsure seats move the pick one rung up and say so', () => {
  const r = pickRung([v('haiku', 0.5), v('haiku', 0.4)], ladder);
  expect(r).toMatchObject({ index: 1, lowConfidence: true });
  expect(r?.reason).toMatch(/unsure|confidence/i);
});

test('pickRung: without model picks, the complexity verdict chooses the first rung of its band', () => {
  expect(pickRung([v(null, 0.9, 'easy'), v(null, 0.9, 'easy')], ladder)?.index).toBe(0);
  expect(pickRung([v(null, 0.9, 'medium')], ladder)?.index).toBe(1);
  expect(pickRung([v(null, 0.9, 'hard')], ladder)?.index).toBe(2);
});

test('pickRung: the top of the ladder is the ceiling, and no votes means no pick', () => {
  expect(pickRung([v('fable', 0.3)], ladder)?.index).toBe(3);
  expect(pickRung([], ladder)).toBeNull();
  expect(pickRung([v('haiku', 0.9)], [])).toBeNull();
});
