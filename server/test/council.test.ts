import { expect, test } from 'vitest';
import type { Provider, ResultEvent } from '../src/adapters/types.js';
import { runCouncil, type Seat } from '../src/council/council.js';
import { VOTE_JSON_SCHEMA } from '../src/council/vote.js';
import { costFor, DEFAULT_PRICING } from '../src/ledger/pricing.js';
import { FakeAdapter, registry, voteEvents } from './helpers/fakeAdapter.js';

const seats: Seat[] = [
  { provider: 'gemini', model: 'flash-lite' },
  { provider: 'codex', model: 'gpt-5.1-codex-mini' },
  { provider: 'claude', model: 'claude-haiku-5-5' },
];

type Reported = [Provider, string | null, number | undefined];

function run(g: FakeAdapter, c: FakeAdapter, k: FakeAdapter, extra: Partial<Parameters<typeof runCouncil>[0]> = {}) {
  const reported: Reported[] = [];
  const promise = runCouncil({
    seats,
    adapters: registry(k, c, g),
    task: 'rename x to y',
    cwd: 'C:/w',
    snapshot: 'Top-level: src/',
    onResult: async (provider, model, ev: ResultEvent) => {
      reported.push([provider, model, ev.costUsd]);
    },
    pricing: DEFAULT_PRICING,
    ...extra,
  });
  return { promise, reported };
}

test('three seats vote in parallel; lowest-cost confident seat is selected', async () => {
  const { promise, reported } = run(
    new FakeAdapter('gemini', { events: voteEvents(0.9, 2, 'gemini confident') }),
    new FakeAdapter('codex', { events: voteEvents(0.85, 2, 'codex confident') }),
    new FakeAdapter('claude', { events: voteEvents(0.95, 2, 'claude confident') }),
  );
  const r = await promise;
  expect(r.selectedSeat.provider).toBe('gemini');
  expect(r.isFallback).toBe(false);
  expect(r.seats.map((s) => s.vote?.confidence)).toEqual([0.9, 0.85, 0.95]);
  expect(r.seats.every((s) => s.costUsd > 0 && s.durationMs >= 0 && !s.overCeiling)).toBe(true);
  expect(reported).toHaveLength(3);
  expect(reported).toContainEqual(['gemini', 'flash-lite', 0.001]);
});

test('seats run tool-less votes with the vote prompt and the JSON schema', async () => {
  const g = new FakeAdapter('gemini', { events: voteEvents(0.9, 1) });
  const { promise } = run(g, new FakeAdapter('codex', { events: voteEvents(0.9, 1) }), new FakeAdapter('claude', { events: voteEvents(0.9, 1) }));
  await promise;
  expect(g.calls).toHaveLength(1);
  expect(g.calls[0]).toMatchObject({ purpose: 'vote', model: 'flash-lite', cwd: 'C:/w', fullAuto: false, allowedCommands: [], jsonSchema: VOTE_JSON_SCHEMA });
  expect(g.calls[0]?.prompt).toContain('rename x to y');
  expect(g.calls[0]?.prompt).toContain('Top-level: src/');
});

test('seats report quota windows', async () => {
  let quotaReported = false;
  await run(
    new FakeAdapter('gemini', { events: [...voteEvents(0.9, 1), { type: 'quota', windows: [{ name: 'day', fraction: 0.5 }] }] }),
    new FakeAdapter('codex', { events: voteEvents(0.9, 1) }),
    new FakeAdapter('claude', { events: voteEvents(0.9, 1) }),
    { onQuota: () => { quotaReported = true; } },
  ).promise;
  expect(quotaReported).toBe(true);
});

test('a seat that throws is recorded as an error and ignored by selection', async () => {
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents(0.9, 2) }),
    new FakeAdapter('codex', { events: [], throwMessage: 'spawn ENOENT' }),
    new FakeAdapter('claude', { events: voteEvents(0.7, 4) }),
  );
  const r = await promise;
  expect(r.seats[1]).toMatchObject({ vote: null, error: expect.stringContaining('ENOENT') });
  expect(r.selectedSeat.provider).toBe('gemini');
});

test('a seat that exceeds the timeout is ignored and the run still finishes quickly', async () => {
  const started = Date.now();
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents(0.9, 2) }),
    new FakeAdapter('codex', { events: voteEvents(0.85, 2) }),
    new FakeAdapter('claude', { events: voteEvents(0.95, 2), delayMs: 2000 }),
    { timeoutMs: 50 },
  );
  const r = await promise;
  expect(Date.now() - started).toBeLessThan(1000);
  expect(r.seats[2]).toMatchObject({ vote: null, error: expect.stringMatching(/timed out/) });
  expect(r.selectedSeat.provider).toBe('gemini');
});

test('a seat whose cost exceeds the ceiling is flagged', async () => {
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents(0.8, 2, 'r', 0.2) }),
    new FakeAdapter('codex', { events: voteEvents(0.8, 2) }),
    new FakeAdapter('claude', { events: voteEvents(0.8, 2) }),
  );
  const r = await promise;
  expect(r.seats[0]?.overCeiling).toBe(true);
  expect(r.seats[1]?.overCeiling).toBe(false);
});

test('cost falls back to the pricing table when the CLI reports none', async () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 };
  const text = JSON.stringify({ confidence: 0.6, complexity: 3, reason: 'r' });
  const codex = new FakeAdapter('codex', {
    events: [{ type: 'text', text }, { type: 'result', usage, costUsd: undefined, exitCode: 0, isError: false, text }],
  });
  const { promise, reported } = run(new FakeAdapter('gemini', { events: voteEvents(0.8, 2) }), codex, new FakeAdapter('claude', { events: voteEvents(0.8, 2) }));
  const r = await promise;
  const expected = costFor('codex', 'gpt-5.1-codex-mini', usage, DEFAULT_PRICING);
  expect(expected).toBeGreaterThan(0);
  expect(r.seats[1]?.costUsd).toBeCloseTo(expected);
  expect(reported.find(([p]) => p === 'codex')?.[2]).toBeCloseTo(expected);
});

test('a seat whose output has no JSON counts as no vote, with its text kept for the UI', async () => {
  const chatty = new FakeAdapter('claude', {
    events: [
      { type: 'text', text: 'I think this is medium.' },
      { type: 'result', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0.001, exitCode: 0, isError: false, text: 'I think this is medium.' },
    ],
  });
  const { promise } = run(new FakeAdapter('gemini', { events: voteEvents(0.8, 2) }), new FakeAdapter('codex', { events: voteEvents(0.8, 2) }), chatty);
  const r = await promise;
  expect(r.seats[2]).toMatchObject({ vote: null, error: expect.stringContaining('no vote'), text: 'I think this is medium.' });
});

test('empty council seats handled safely without throwing', async () => {
  const promise = runCouncil({
    seats: [],
    adapters: registry(new FakeAdapter('claude'), new FakeAdapter('codex'), new FakeAdapter('gemini')),
    task: 'x',
    cwd: 'C:/w',
    snapshot: '',
    onResult: async () => {},
    pricing: DEFAULT_PRICING,
  });
  const r = await promise;
  expect(r.seats).toHaveLength(0);
  expect(r.isFallback).toBe(true);
});
