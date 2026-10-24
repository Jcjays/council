import { expect, test } from 'vitest';
import { extractVote, voteSchema } from '../src/council/vote.js';

const ids = ['flash', 'claude-haiku-5-5', 'claude-sonnet-5-5'];

test('the schema requires model, complexity, confidence and reason, with the ladder as the model enum', () => {
  const s = voteSchema(ids) as { required: string[]; properties: Record<string, { enum?: string[] }> };
  expect(s.required).toEqual(expect.arrayContaining(['model', 'complexity', 'confidence', 'reason']));
  expect(s.properties.model?.enum).toEqual(ids);
  expect(s.properties.complexity?.enum).toEqual(['easy', 'medium', 'hard']);
});

test('extracts a vote with a model pick', () => {
  expect(extractVote('{"model":"claude-sonnet-5-5","complexity":"medium","confidence":0.7,"reason":"two files"}', ids)).toEqual({
    model: 'claude-sonnet-5-5',
    tier: 'medium',
    confidence: 0.7,
    reason: 'two files',
  });
});

test('a model that is not on the ladder is dropped but the vote stands', () => {
  expect(extractVote('{"model":"gpt-9","complexity":"easy","confidence":0.9,"reason":"r"}', ids)).toEqual({ model: null, tier: 'easy', confidence: 0.9, reason: 'r' });
});

test('model ids match case-insensitively and by label-ish spelling', () => {
  expect(extractVote('{"model":"Claude-Haiku-5-5","complexity":"easy","confidence":0.9,"reason":"r"}', ids)?.model).toBe('claude-haiku-5-5');
});

test('the legacy tier key, fenced JSON and prose-wrapped JSON still parse', () => {
  expect(extractVote('```json\n{"tier":"hard","confidence":0.6,"reason":"architecture"}\n```', ids)).toEqual({ model: null, tier: 'hard', confidence: 0.6, reason: 'architecture' });
  expect(extractVote('Here: {"complexity":"easy","confidence":0.9,"reason":"rename"} ok', ids)?.tier).toBe('easy');
});

test('rejects an unknown complexity and empty text', () => {
  expect(extractVote('{"model":"flash","complexity":"huge","confidence":0.5,"reason":"x"}', ids)).toBeNull();
  expect(extractVote('', ids)).toBeNull();
  expect(extractVote('no json here', ids)).toBeNull();
});

test('clamps confidence into 0..1 and defaults missing fields', () => {
  expect(extractVote('{"complexity":"medium","confidence":7}', ids)).toEqual({ model: null, tier: 'medium', confidence: 1, reason: '' });
  expect(extractVote('{"complexity":"easy"}', ids)).toEqual({ model: null, tier: 'easy', confidence: 0.5, reason: '' });
});
