import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Adapter, AdapterEvent, Provider, RunOptions } from '../src/adapters/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/config/settings.js';
import { DEFAULT_PRICING } from '../src/ledger/pricing.js';
import { readEntries } from '../src/ledger/ledger.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { TabStore } from '../src/tasks/store.js';
import type { Tab } from '../src/tasks/types.js';
import type { TabStatus } from '../src/tasks/state.js';
import { FakeAdapter, failEvents, registry, voteEvents, workEvents, type FakeScript } from './helpers/fakeAdapter.js';

type Scripts = Partial<Record<'vote' | 'work' | 'summarize', FakeScript>>;

function summaryEvents(text: string): AdapterEvent[] {
  return [
    { type: 'text', text },
    { type: 'result', usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20 }, costUsd: 0.0005, exitCode: 0, isError: false, text },
  ];
}

function scripted(provider: Provider, tier: string, scripts: Scripts = {}): FakeAdapter {
  return new FakeAdapter(provider, (opts: RunOptions) => {
    if (opts.purpose === 'vote') return scripts.vote ?? { events: voteEvents(tier) };
    if (opts.purpose === 'summarize') return scripts.summarize ?? { events: summaryEvents('SUMMARY TEXT') };
    return scripts.work ?? { events: workEvents(`${provider}-session`, `${provider} did it`) };
  });
}

interface Setup {
  engine: TaskEngine;
  ledgerFile: string;
  adapters: Record<Provider, FakeAdapter>;
}

function setup(opts: { settings?: Partial<Settings>; adapters?: Partial<Record<Provider, FakeAdapter>>; health?: Partial<Record<Provider, boolean>> } = {}): Setup {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'council-engine-'));
  const ledgerFile = path.join(home, 'ledger.jsonl');
  const adapters: Record<Provider, FakeAdapter> = {
    gemini: opts.adapters?.gemini ?? scripted('gemini', 'easy'),
    codex: opts.adapters?.codex ?? scripted('codex', 'easy'),
    claude: opts.adapters?.claude ?? scripted('claude', 'hard'),
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const engine = new TaskEngine({
    adapters: registry(adapters.claude, adapters.codex, adapters.gemini) as Record<Provider, Adapter>,
    diffStat: async () => ' a.txt | 1 +',
    store: new TabStore(path.join(home, 'projects')),
    ledgerFile,
    settings: () => settings,
    pricing: () => DEFAULT_PRICING,
    snapshot: async () => 'Top-level: src/',
    health: () =>
      Object.fromEntries(
        (['claude', 'codex', 'gemini'] as Provider[]).map((p) => [p, { installed: opts.health?.[p] ?? true, authed: true }]),
      ),
  });
  engine.on('engine-error', () => {});
  return { engine, ledgerFile, adapters };
}

function waitFor(engine: TaskEngine, tabId: string, statuses: TabStatus[], timeoutMs = 5000): Promise<Tab> {
  return new Promise((resolve, reject) => {
    const current = engine.getTab(tabId);
    if (current && statuses.includes(current.status)) return resolve(current);
    const timer = setTimeout(() => {
      engine.off('tab', onTab);
      reject(new Error(`timed out waiting for ${statuses.join('|')}; tab is ${engine.getTab(tabId)?.status}`));
    }, timeoutMs);
    const onTab = (tab: Tab) => {
      if (tab.id === tabId && statuses.includes(tab.status)) {
        clearTimeout(timer);
        engine.off('tab', onTab);
        resolve(tab);
      }
    };
    engine.on('tab', onTab);
  });
}

test('auto submit: council votes, tab waits for start, then the worker streams to idle and everything is ledgered', async () => {
  const { engine, ledgerFile, adapters } = setup();
  const tab = await engine.createTab('C:/proj', 'Rename foo');
  await engine.submit(tab.id, 'Rename foo to bar in src/a.ts', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.tier).toBe('easy');
  expect(voted.vote?.seats).toHaveLength(3);
  expect(voted.worker).toEqual({ provider: 'gemini', model: 'flash', sessionId: null });
  expect(voted.transcript.map((i) => i.kind)).toEqual(['user', 'vote']);
  const votes = await readEntries(ledgerFile);
  expect(votes).toHaveLength(3);
  expect(votes.every((e) => e.purpose === 'vote' && e.tabId === tab.id && e.projectId === tab.projectId)).toBe(true);

  await engine.start(tab.id);
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(idle.worker?.sessionId).toBe('gemini-session');
  const kinds = idle.transcript.map((i) => i.kind);
  expect(kinds).toEqual(['user', 'vote', 'assistant', 'tool', 'result']);
  const toolItem = idle.transcript.find((i) => i.kind === 'tool');
  expect(toolItem?.tool).toMatchObject({ name: 'Write', output: 'ok' });
  const all = await readEntries(ledgerFile);
  expect(all.filter((e) => e.purpose === 'work')).toHaveLength(1);
  expect(idle.costUsd).toBeCloseTo(0.001 * 3 + 0.01, 6);
  const workCall = adapters.gemini.calls.find((c) => c.purpose === 'work');
  expect(workCall).toMatchObject({ cwd: 'C:/proj', model: 'flash', prompt: 'Rename foo to bar in src/a.ts', fullAuto: false });
  expect(workCall?.resumeId).toBeUndefined();
  expect(workCall?.allowedCommands).toEqual(DEFAULT_SETTINGS.allowedCommands);
});

test('autoStart skips the pause and runs straight after the vote', async () => {
  const { engine } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'do it', { kind: 'auto' });
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(idle.worker?.provider).toBe('gemini');
  expect(idle.transcript.some((i) => i.kind === 'result')).toBe(true);
});

test('manual submit skips the council and derives the tier from the chosen provider', async () => {
  const { engine, ledgerFile } = setup();
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'do it', { kind: 'manual', provider: 'claude', model: 'claude-sonnet-5-5' }, { fullAuto: true });
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(idle.vote).toBeNull();
  expect(idle.tier).toBe('hard');
  expect(idle.worker).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5', sessionId: 'claude-session' });
  expect(idle.fullAuto).toBe(true);
  const entries = await readEntries(ledgerFile);
  expect(entries.map((e) => e.purpose)).toEqual(['work']);
});

test('a follow-up message resumes the worker session', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'first', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  await engine.send(tab.id, 'and also this');
  await waitFor(engine, tab.id, ['running']);
  const idle = await waitFor(engine, tab.id, ['idle']);
  const calls = adapters.gemini.calls.filter((c) => c.purpose === 'work');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ prompt: 'and also this', resumeId: 'gemini-session', model: 'flash' });
  expect(idle.transcript.filter((i) => i.kind === 'user').map((i) => i.text)).toEqual(['first', 'and also this']);
});

test('a worker failure auto-escalates once with a summary hand-off, and a second failure stops', async () => {
  const gemini = scripted('gemini', 'easy', { work: { events: failEvents('g-sess', 'gemini exploded') } });
  const codex = scripted('codex', 'easy', { work: { events: failEvents('c-sess', 'codex exploded') } });
  const { engine, ledgerFile } = setup({ settings: { autoStart: true }, adapters: { gemini, codex } });
  const tab = await engine.createTab('C:/proj', 'Hard thing');
  await engine.submit(tab.id, 'Hard thing please', { kind: 'auto' });
  const failed = await waitFor(engine, tab.id, ['failed'], 8000);
  expect(failed.worker?.provider).toBe('codex');
  expect(failed.tier).toBe('medium');
  expect(failed.escalations).toBe(1);
  expect(failed.previousWorkers).toEqual([{ provider: 'gemini', model: 'flash', sessionId: 'g-sess' }]);
  const handoff = codex.calls.find((c) => c.purpose === 'work');
  expect(handoff?.prompt).toContain('SUMMARY TEXT');
  expect(handoff?.prompt).toContain(' a.txt | 1 +');
  expect(handoff?.prompt).toContain('Hard thing please');
  expect(handoff?.resumeId).toBeUndefined();
  const purposes = (await readEntries(ledgerFile)).map((e) => e.purpose);
  expect(purposes.filter((p) => p === 'summarize')).toHaveLength(1);
  expect(purposes.filter((p) => p === 'work')).toHaveLength(2);
  expect(failed.transcript.filter((i) => i.kind === 'system').length).toBeGreaterThan(0);
});

test('autoEscalate off leaves the tab failed on the first worker', async () => {
  const gemini = scripted('gemini', 'easy', { work: { events: failEvents() } });
  const { engine } = setup({ settings: { autoStart: true, autoEscalate: false }, adapters: { gemini } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  const failed = await waitFor(engine, tab.id, ['failed']);
  expect(failed.worker?.provider).toBe('gemini');
  expect(failed.escalations).toBe(0);
});

test('switching provider hands off with a summary and keeps the old session for switching back', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'start', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);

  await engine.switchWorker(tab.id, 'claude', 'claude-sonnet-5-5');
  const onClaude = await waitFor(engine, tab.id, ['idle']);
  expect(onClaude.worker).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5', sessionId: 'claude-session' });
  expect(onClaude.previousWorkers).toEqual([{ provider: 'gemini', model: 'flash', sessionId: 'gemini-session' }]);
  expect(onClaude.escalations).toBe(0);
  const claudeCall = adapters.claude.calls.find((c) => c.purpose === 'work');
  expect(claudeCall?.prompt).toContain('SUMMARY TEXT');
  expect(claudeCall?.resumeId).toBeUndefined();

  await engine.switchWorker(tab.id, 'gemini', 'flash');
  await waitFor(engine, tab.id, ['running']);
  const back = await waitFor(engine, tab.id, ['idle']);
  const geminiWork = adapters.gemini.calls.filter((c) => c.purpose === 'work');
  expect(geminiWork[1]?.resumeId).toBe('gemini-session');
  expect(back.worker?.provider).toBe('gemini');
});

test('changing only the model keeps the session and takes effect on the next message', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'start', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  const changed = await engine.switchWorker(tab.id, 'gemini', 'pro');
  expect(changed.status).toBe('idle');
  expect(changed.worker).toEqual({ provider: 'gemini', model: 'pro', sessionId: 'gemini-session' });
  expect(changed.previousWorkers).toEqual([]);
  await engine.send(tab.id, 'next');
  await waitFor(engine, tab.id, ['running']);
  await waitFor(engine, tab.id, ['idle']);
  const calls = adapters.gemini.calls.filter((c) => c.purpose === 'work');
  expect(calls[1]).toMatchObject({ model: 'pro', resumeId: 'gemini-session' });
});

test('clearContext resets worker session and resets chat transcript to a single system notice', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'start', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  expect(tab.transcript.length).toBeGreaterThan(1);
  expect(tab.worker?.sessionId).toBe('gemini-session');
  expect(tab.vote).not.toBeNull();

  const cleared = await engine.clearContext(tab.id);
  expect(cleared.status).toBe('drafting');
  expect(cleared.worker).toBeNull();
  expect(cleared.tier).toBeNull();
  expect(cleared.transcript.length).toBe(1);
  expect(cleared.transcript[0]?.kind).toBe('system');
  expect(cleared.transcript[0]?.text).toContain('Context cleared');
  expect(cleared.vote).toBeNull();
  expect(cleared.routing).toBeNull();

  // Next message in auto mode triggers council vote again
  await engine.submit(tab.id, 'brand new task', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  expect(tab.vote).not.toBeNull();
  const voteCalls = adapters.gemini.calls.filter((c) => c.purpose === 'vote');
  expect(voteCalls.length).toBe(2);
});

test('closing a running tab aborts the worker and applies no further events', async () => {
  const slow = new FakeAdapter('gemini', (opts: RunOptions) =>
    opts.purpose === 'vote' ? { events: voteEvents('easy') } : { events: workEvents(), delayMs: 150 },
  );
  const { engine } = setup({ settings: { autoStart: true }, adapters: { gemini: slow } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', { kind: 'auto' });
  await waitFor(engine, tab.id, ['running']);
  for (let i = 0; i < 50 && !slow.calls.some((c) => c.purpose === 'work'); i++) await new Promise((r) => setTimeout(r, 20));
  const closed = await engine.close(tab.id);
  expect(closed.status).toBe('closed');
  const workCall = slow.calls.find((c) => c.purpose === 'work');
  expect(workCall?.signal?.aborted).toBe(true);
  const count = closed.transcript.length;
  await new Promise((r) => setTimeout(r, 500));
  expect(engine.getTab(tab.id)?.transcript.length).toBe(count);
  expect(engine.getTab(tab.id)?.status).toBe('closed');
});

test('closing a tab mid-vote stops the seats instead of letting them finish and bill', async () => {
  const slowVote = (provider: 'claude' | 'codex' | 'gemini') =>
    new FakeAdapter(provider, (opts: RunOptions) =>
      opts.purpose === 'vote' ? { events: voteEvents('easy'), delayMs: 2_000 } : { events: workEvents() },
    );
  const seats = { gemini: slowVote('gemini'), codex: slowVote('codex'), claude: slowVote('claude') };
  const { engine, ledgerFile } = setup({ adapters: seats });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', { kind: 'auto' });
  await waitFor(engine, tab.id, ['voting']);
  for (let i = 0; i < 50 && !seats.gemini.calls.some((c) => c.purpose === 'vote'); i++) await new Promise((r) => setTimeout(r, 20));

  const started = Date.now();
  const closed = await engine.close(tab.id);
  expect(closed.status).toBe('closed');
  expect(Date.now() - started).toBeLessThan(1_500);
  for (const seat of Object.values(seats)) {
    expect(seat.calls.find((c) => c.purpose === 'vote')?.signal?.aborted).toBe(true);
  }
  expect(await readEntries(ledgerFile)).toEqual([]);
});

test('workers run in the project checkout itself; tabs carry no worktree', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 'Add thing');
  await engine.submit(tab.id, 'add', { kind: 'auto' });
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect('worktree' in idle).toBe(false);
  expect(adapters.gemini.calls.every((c) => c.cwd === 'C:/proj')).toBe(true);
});

test('a silent worker trips the stall flag once, and output clears it', async () => {
  const slow = new FakeAdapter('gemini', (opts: RunOptions) =>
    opts.purpose === 'vote' ? { events: voteEvents('easy') } : { events: workEvents(), delayMs: 120 },
  );
  const { engine } = setup({ settings: { autoStart: true, stallMinutes: 0.001 }, adapters: { gemini: slow } });
  const stalls: string[] = [];
  engine.on('stall', ({ tabId }: { tabId: string }) => stalls.push(tabId));
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(stalls.length).toBeGreaterThanOrEqual(1);
  expect(idle.stalled).toBe(false);
});

test('an unavailable provider drops out of the council and its tier is served by the nearest one', async () => {
  const { engine } = setup({ health: { gemini: false }, adapters: { claude: scripted('claude', 'easy') } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'tiny change', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.vote?.seats.map((s) => s.seat.provider)).toEqual(['codex', 'claude']);
  expect(voted.vote?.decision).toBe('easy');
  expect(voted.tier).toBe('easy');
  expect(voted.worker).toMatchObject({ provider: 'codex', model: 'gpt-5.1-codex-mini' });
  expect(voted.routing?.shiftedFrom).toBeUndefined();
  expect(voted.routing?.notes?.join(' ')).toMatch(/gemini/i);
});

test('an exhausted budget still shifts the tier even when every CLI is set up', async () => {
  const { engine } = setup({ settings: { budgets: { claude: 40, codex: 30, gemini: 0.0001 } } });
  const first = await engine.createTab('C:/proj', 'warm-up');
  await engine.submit(first.id, 'x', { kind: 'auto' });
  await waitFor(engine, first.id, ['awaiting-start']);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'tiny change', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.vote?.decision).toBe('easy');
  expect(voted.tier).toBe('medium');
  expect(voted.routing).toMatchObject({ shiftedFrom: 'easy', reason: expect.stringContaining('gemini') });
});

test('a worker that exits 0 but reports failure in-band still fails the tab and is ledgered', async () => {
  const text = JSON.stringify({ tier: 'easy', confidence: 0.9, reason: 'r' });
  const inBand = new FakeAdapter('gemini', (opts: RunOptions) =>
    opts.purpose === 'vote'
      ? { events: voteEvents('easy') }
      : {
          events: [
            { type: 'session', id: 's' },
            { type: 'result', usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0.002, exitCode: 0, isError: true, text: 'quota exceeded' },
          ],
        },
  );
  void text;
  const { engine, ledgerFile } = setup({ settings: { autoStart: true, autoEscalate: false }, adapters: { gemini: inBand } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  const failed = await waitFor(engine, tab.id, ['failed']);
  expect(failed.status).toBe('failed');
  const work = (await readEntries(ledgerFile)).filter((e) => e.purpose === 'work');
  expect(work).toHaveLength(1);
  expect(work[0]?.costUsd).toBe(0.002);
});

test('streaming many events emits few full-tab updates and clips oversized tool output', async () => {
  const events: AdapterEvent[] = [{ type: 'session', id: 's' }];
  for (let i = 0; i < 40; i++) events.push({ type: 'text', text: `chunk ${i}` });
  events.push({ type: 'tool', id: 't1', name: 'Read', input: { file_path: 'big.txt' } });
  events.push({ type: 'tool_result', id: 't1', output: 'x'.repeat(100_000) });
  events.push({ type: 'result', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0.001, exitCode: 0, isError: false, text: 'done' });
  const chatty = new FakeAdapter('gemini', (opts: RunOptions) => (opts.purpose === 'vote' ? { events: voteEvents('easy') } : { events }));
  const { engine } = setup({ settings: { autoStart: true }, adapters: { gemini: chatty } });
  let tabEmits = 0;
  let itemEmits = 0;
  engine.on('tab', () => tabEmits++);
  engine.on('item', () => itemEmits++);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(itemEmits).toBeGreaterThanOrEqual(43);
  expect(tabEmits).toBeLessThan(12);
  const toolItem = idle.transcript.find((i) => i.kind === 'tool');
  expect((toolItem?.tool?.output ?? '').length).toBeLessThan(25_000);
  expect(idle.transcript.filter((i) => i.kind === 'assistant')).toHaveLength(40);
});

test('usage windows reported by a CLI are kept per provider and exposed with the budgets', async () => {
  const windows = [{ name: '5-hour', usedPct: 0.59, resetsAt: '2026-10-21T04:30:00.000Z' }];
  const events: AdapterEvent[] = [{ type: 'session', id: 's' }, { type: 'quota', windows }, ...workEvents().slice(1)];
  const claude = new FakeAdapter('claude', (opts: RunOptions) => (opts.purpose === 'vote' ? { events: voteEvents('hard') } : { events }));
  const { engine } = setup({ settings: { autoStart: true }, adapters: { claude } });
  const seen: string[] = [];
  engine.on('quota', ({ provider }: { provider: Provider }) => seen.push(provider));
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'manual', provider: 'claude', model: null });
  await waitFor(engine, tab.id, ['idle']);
  expect(seen).toEqual(['claude']);
  expect(engine.usage().claude).toMatchObject({ windows, observedAt: expect.any(String) });
  const b = await engine.budgets();
  expect(b.claude.usage?.windows).toEqual(windows);
  expect(b.gemini.usage).toBeUndefined();
});

test('with only Claude set up, the council is Haiku alone and escalation climbs Claude models', async () => {
  const claude = scripted('claude', 'easy');
  const { engine } = setup({ health: { gemini: false, codex: false }, adapters: { claude } });
  expect(engine.routing()).toMatchObject({ available: ['claude'], seats: [{ provider: 'claude', model: 'claude-haiku-5-5' }] });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'small thing', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.vote?.seats.map((s) => s.seat)).toEqual([{ provider: 'claude', model: 'claude-haiku-5-5' }]);
  expect(voted.worker).toMatchObject({ provider: 'claude', model: 'claude-haiku-5-5' });
  expect(voted.tier).toBe('easy');
  expect(voted.routing?.notes?.join(' ')).toMatch(/only claude/i);
  await engine.start(tab.id);
  await waitFor(engine, tab.id, ['idle']);
  await engine.escalate(tab.id);
  const escalated = await waitFor(engine, tab.id, ['idle']);
  expect(escalated.tier).toBe('medium');
  expect(escalated.worker).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' });
  const calls = claude.calls.filter((c) => c.purpose === 'work');
  expect(calls.map((c) => c.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
});

test('budgets reflect the ledger against the configured limits', async () => {
  const { engine } = setup({ settings: { autoStart: true, budgets: { claude: 40, codex: 30, gemini: 0.01 } } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  const b = await engine.budgets();
  expect(b.gemini.spent).toBeCloseTo(0.011, 6);
  expect(b.gemini.routingSpent).toBeCloseTo(0.001, 6);
  expect(b.gemini.exhausted).toBe(true);
  expect(b.claude.spent).toBeCloseTo(0.001, 6);
});
