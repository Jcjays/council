import { expect, test } from 'vitest';
import { extractVote, VOTE_JSON_SCHEMA } from '../src/council/vote.js';

test('schema requires tier, confidence and reason with the three tiers', () => {
  expect(VOTE_JSON_SCHEMA).toMatchObject({ type: 'object', required: expect.arrayContaining(['tier', 'confidence', 'reason']) });
  const props = VOTE_JSON_SCHEMA.properties as Record<string, { enum?: string[] }>;
  expect(props.tier?.enum).toEqual(['easy', 'medium', 'hard']);
});

test('extracts a raw JSON vote', () => {
  expect(extractVote('{"tier":"easy","confidence":0.9,"reason":"rename only"}')).toEqual({ tier: 'easy', confidence: 0.9, reason: 'rename only' });
});

test('extracts a fenced JSON vote', () => {
  expect(extractVote('```json\n{"tier":"medium","confidence":0.7,"reason":"two files"}\n```')).toEqual({
    tier: 'medium',
    confidence: 0.7,
    reason: 'two files',
  });
});

test('extracts JSON embedded in prose', () => {
  expect(extractVote('Here you go: {"tier":"hard","confidence":0.6,"reason":"architecture"} hope that helps')).toEqual({
    tier: 'hard',
    confidence: 0.6,
    reason: 'architecture',
  });
});

test('rejects an unknown tier and empty text', () => {
  expect(extractVote('{"tier":"huge","confidence":0.5,"reason":"x"}')).toBeNull();
  expect(extractVote('')).toBeNull();
  expect(extractVote('no json here')).toBeNull();
});

test('clamps confidence into 0..1 and defaults missing fields', () => {
  expect(extractVote('{"tier":"medium","confidence":7}')).toEqual({ tier: 'medium', confidence: 1, reason: '' });
  expect(extractVote('{"tier":"easy"}')).toEqual({ tier: 'easy', confidence: 0.5, reason: '' });
});
