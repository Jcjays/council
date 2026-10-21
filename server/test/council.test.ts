import { expect, test } from 'vitest';
import type { Provider, ResultEvent } from '../src/adapters/types.js';
import { runCouncil, type Seat } from '../src/council/council.js';
import { VOTE_JSON_SCHEMA } from '../src/council/vote.js';
import { costFor, DEFAULT_PRICING } from '../src/ledger/pricing.js';
import { FakeAdapter, registry, voteEvents } from './helpers/fakeAdapter.js';

const seats: Seat[] = [
  { provider: 'gemini', model: 'flash' },
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

test('three seats vote in parallel; the majority decides and every result is reported', async () => {
  const { promise, reported } = run(
    new FakeAdapter('gemini', { events: voteEvents('easy') }),
    new FakeAdapter('codex', { events: voteEvents('easy') }),
    new FakeAdapter('claude', { events: voteEvents('hard') }),
  );
  const r = await promise;
  expect(r.decision).toBe('easy');
  expect(r.tie).toBe(false);
  expect(r.counts).toEqual({ easy: 2, medium: 0, hard: 1 });
  expect(r.seats.map((s) => s.vote?.tier)).toEqual(['easy', 'easy', 'hard']);
  expect(r.seats.every((s) => s.costUsd > 0 && s.durationMs >= 0 && !s.overCeiling)).toBe(true);
  expect(reported).toHaveLength(3);
  expect(reported).toContainEqual(['gemini', 'flash', 0.001]);
});

test('seats run tool-less votes with the vote prompt and the JSON schema', async () => {
  const g = new FakeAdapter('gemini', { events: voteEvents('easy') });
  const { promise } = run(g, new FakeAdapter('codex', { events: voteEvents('easy') }), new FakeAdapter('claude', { events: voteEvents('easy') }));
  await promise;
  expect(g.calls).toHaveLength(1);
  expect(g.calls[0]).toMatchObject({ purpose: 'vote', model: 'flash', cwd: 'C:/w', fullAuto: false, allowedCommands: [], jsonSchema: VOTE_JSON_SCHEMA });
  expect(g.calls[0]?.prompt).toContain('rename x to y');
  expect(g.calls[0]?.prompt).toContain('Top-level: src/');
});

test('a seat that throws is recorded as an error and ignored by the tally', async () => {
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents('easy') }),
    new FakeAdapter('codex', { events: [], throwMessage: 'spawn ENOENT' }),
    new FakeAdapter('claude', { events: voteEvents('hard') }),
  );
  const r = await promise;
  expect(r.seats[1]).toMatchObject({ vote: null, error: expect.stringContaining('ENOENT') });
  expect(r).toMatchObject({ decision: 'hard', tie: true });
});

test('a seat that exceeds the timeout is ignored and the run still finishes quickly', async () => {
  const started = Date.now();
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents('easy') }),
    new FakeAdapter('codex', { events: voteEvents('easy') }),
    new FakeAdapter('claude', { events: voteEvents('hard'), delayMs: 2000 }),
    { timeoutMs: 50 },
  );
  const r = await promise;
  expect(Date.now() - started).toBeLessThan(1000);
  expect(r.seats[2]).toMatchObject({ vote: null, error: expect.stringMatching(/timed out/) });
  expect(r.decision).toBe('easy');
});

test('a seat whose cost exceeds the ceiling is flagged', async () => {
  const { promise } = run(
    new FakeAdapter('gemini', { events: voteEvents('easy', 0.8, 'r', 0.2) }),
    new FakeAdapter('codex', { events: voteEvents('easy') }),
    new FakeAdapter('claude', { events: voteEvents('easy') }),
  );
  const r = await promise;
  expect(r.seats[0]?.overCeiling).toBe(true);
  expect(r.seats[1]?.overCeiling).toBe(false);
});

test('cost falls back to the pricing table when the CLI reports none', async () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 };
  const text = JSON.stringify({ tier: 'medium', confidence: 0.6, reason: 'r' });
  const codex = new FakeAdapter('codex', {
    events: [{ type: 'text', text }, { type: 'result', usage, costUsd: undefined, exitCode: 0, isError: false, text }],
  });
  const { promise, reported } = run(new FakeAdapter('gemini', { events: voteEvents('easy') }), codex, new FakeAdapter('claude', { events: voteEvents('easy') }));
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
  const { promise } = run(new FakeAdapter('gemini', { events: voteEvents('easy') }), new FakeAdapter('codex', { events: voteEvents('easy') }), chatty);
  const r = await promise;
  expect(r.seats[2]).toMatchObject({ vote: null, error: expect.stringContaining('no vote'), text: 'I think this is medium.' });
});

test('a seat whose CLI fails is no vote and carries the failure text', async () => {
  const broken = new FakeAdapter('gemini', {
    events: [{ type: 'result', usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, exitCode: 1, isError: true, text: 'Code Assist login required' }],
  });
  const { promise } = run(broken, new FakeAdapter('codex', { events: voteEvents('easy') }), new FakeAdapter('claude', { events: voteEvents('easy') }));
  const r = await promise;
  expect(r.seats[0]).toMatchObject({ vote: null, error: expect.stringContaining('login required') });
  expect(r.decision).toBe('easy');
});

test('quota events from seats are reported through onQuota', async () => {
  const windows = [{ name: '5-hour', usedPct: 0.2 }];
  const gemini = new FakeAdapter('gemini', { events: [{ type: 'quota', windows }, ...voteEvents('easy')] });
  const quotas: [Provider, unknown][] = [];
  const { promise } = run(gemini, new FakeAdapter('codex', { events: voteEvents('easy') }), new FakeAdapter('claude', { events: voteEvents('easy') }), {
    onQuota: (provider, w) => {
      quotas.push([provider, w]);
    },
  });
  const r = await promise;
  expect(r.decision).toBe('easy');
  expect(quotas).toEqual([['gemini', windows]]);
});

test('no seats yields medium with an empty seat list', async () => {
  const r = await runCouncil({
    seats: [],
    adapters: registry(new FakeAdapter('claude', { events: [] }), new FakeAdapter('codex', { events: [] }), new FakeAdapter('gemini', { events: [] })),
    task: 't',
    cwd: 'C:/w',
    snapshot: '',
    onResult: async () => {},
    pricing: DEFAULT_PRICING,
  });
  expect(r).toEqual({ seats: [], decision: 'medium', tie: false, counts: { easy: 0, medium: 0, hard: 0 } });
});
