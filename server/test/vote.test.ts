import { expect, test } from 'vitest';
import { extractVote, VOTE_JSON_SCHEMA } from '../src/council/vote.js';

test('schema requires confidence, complexity, and reason', () => {
  expect(VOTE_JSON_SCHEMA).toMatchObject({
    type: 'object',
    required: expect.arrayContaining(['confidence', 'complexity', 'reason']),
  });
  const props = VOTE_JSON_SCHEMA.properties as Record<string, { type?: string; minimum?: number; maximum?: number }>;
  expect(props.confidence?.type).toBe('number');
  expect(props.confidence?.minimum).toBe(0);
  expect(props.confidence?.maximum).toBe(1);
  expect(props.complexity?.type).toBe('integer');
  expect(props.complexity?.minimum).toBe(1);
  expect(props.complexity?.maximum).toBe(5);
  expect(props.reason?.type).toBe('string');
});

test('extracts valid vote from json', () => {
  const input = '{"confidence":0.95,"complexity":2,"reason":"simple test"}';
  expect(extractVote(input)).toEqual({ confidence: 0.95, complexity: 2, reason: 'simple test' });
});

test('extracts a fenced JSON vote', () => {
  expect(extractVote('```json\n{"confidence":0.7,"complexity":3,"reason":"two files"}\n```')).toEqual({
    confidence: 0.7,
    complexity: 3,
    reason: 'two files',
  });
});

test('extracts JSON embedded in prose', () => {
  expect(extractVote('Here you go: {"confidence":0.6,"complexity":4,"reason":"architecture"} hope that helps')).toEqual({
    confidence: 0.6,
    complexity: 4,
    reason: 'architecture',
  });
});

test('clamps confidence 0..1 and complexity 1..5', () => {
  const input = '{"confidence":1.5,"complexity":8,"reason":"big"}';
  expect(extractVote(input)).toEqual({ confidence: 1, complexity: 5, reason: 'big' });
  const inputLow = '{"confidence":-0.5,"complexity":0,"reason":"small"}';
  expect(extractVote(inputLow)).toEqual({ confidence: 0, complexity: 1, reason: 'small' });
});

test('rejects empty text, non-json, or json missing required metrics', () => {
  expect(extractVote('')).toBeNull();
  expect(extractVote('no json here')).toBeNull();
  expect(extractVote('{"foo":"bar"}')).toBeNull();
  expect(extractVote('{"confidence":"high","complexity":2}')).toBeNull();
  expect(extractVote('{"confidence":0.8,"complexity":"easy"}')).toBeNull();
});

test('defaults missing reason to empty string', () => {
  expect(extractVote('{"confidence":0.8,"complexity":2}')).toEqual({
    confidence: 0.8,
    complexity: 2,
    reason: '',
  });
});
