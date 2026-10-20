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
import { FakeWorktrees } from './helpers/fakeWorktrees.js';

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
  worktrees: FakeWorktrees;
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
  const worktrees = new FakeWorktrees('C:/proj');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const engine = new TaskEngine({
    adapters: registry(adapters.claude, adapters.codex, adapters.gemini) as Record<Provider, Adapter>,
    worktrees: () => worktrees,
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
  return { engine, worktrees, ledgerFile, adapters };
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
  const { engine, worktrees, ledgerFile, adapters } = setup();
  const tab = await engine.createTab('C:/proj', 'Rename foo');
  await engine.submit(tab.id, 'Rename foo to bar in src/a.ts', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.tier).toBe('easy');
  expect(voted.vote?.seats).toHaveLength(3);
  expect(voted.worker).toEqual({ provider: 'gemini', model: 'flash', sessionId: null });
  expect(voted.worktree?.branch).toMatch(/^council\/rename-foo-/);
  expect(worktrees.created[0]).toEqual({ tabId: tab.id, title: 'Rename foo' });
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
  expect(workCall).toMatchObject({ cwd: `C:/proj/.worktrees/${tab.id}`, model: 'flash', prompt: 'Rename foo to bar in src/a.ts', fullAuto: false });
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

test('closing a running tab aborts the worker and applies no further events', async () => {
  const slow = new FakeAdapter('gemini', (opts: RunOptions) =>
    opts.purpose === 'vote' ? { events: voteEvents('easy') } : { events: workEvents(), delayMs: 150 },
  );
  const { engine, worktrees } = setup({ settings: { autoStart: true }, adapters: { gemini: slow } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', { kind: 'auto' });
  await waitFor(engine, tab.id, ['running']);
  for (let i = 0; i < 50 && !slow.calls.some((c) => c.purpose === 'work'); i++) await new Promise((r) => setTimeout(r, 20));
  const closed = await engine.close(tab.id, { deleteWorktree: true });
  expect(closed.status).toBe('closed');
  const workCall = slow.calls.find((c) => c.purpose === 'work');
  expect(workCall?.signal?.aborted).toBe(true);
  const count = closed.transcript.length;
  await new Promise((r) => setTimeout(r, 500));
  expect(engine.getTab(tab.id)?.transcript.length).toBe(count);
  expect(engine.getTab(tab.id)?.status).toBe('closed');
  expect(worktrees.removed).toEqual([{ path: `C:/proj/.worktrees/${tab.id}`, keepBranch: true }]);
});

test('merge commits the worktree and marks the tab merged; a conflict leaves it idle with the result', async () => {
  const { engine, worktrees } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 'Add thing');
  await engine.submit(tab.id, 'add', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  const { tab: merged, result } = await engine.merge(tab.id);
  expect(result.kind).toBe('merged');
  expect(merged.status).toBe('merged');
  expect(worktrees.commits).toEqual([`council(${tab.id}): Add thing`]);

  const { engine: e2, worktrees: w2 } = setup({ settings: { autoStart: true } });
  w2.mergeResult = { kind: 'conflict', files: ['README.md'] };
  const t2 = await e2.createTab('C:/proj', 'x');
  await e2.submit(t2.id, 'x', { kind: 'auto' });
  await waitFor(e2, t2.id, ['idle']);
  const second = await e2.merge(t2.id);
  expect(second.result).toEqual({ kind: 'conflict', files: ['README.md'] });
  expect(second.tab.status).toBe('idle');
  expect(second.tab.lastMerge).toEqual({ kind: 'conflict', files: ['README.md'] });
});

test('askRebase sends the rebase prompt to the current worker', async () => {
  const { engine, adapters } = setup({ settings: { autoStart: true } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'x', { kind: 'auto' });
  await waitFor(engine, tab.id, ['idle']);
  await engine.askRebase(tab.id);
  await waitFor(engine, tab.id, ['running']);
  await waitFor(engine, tab.id, ['idle']);
  const calls = adapters.gemini.calls.filter((c) => c.purpose === 'work');
  expect(calls[1]?.prompt).toContain('git rebase main');
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

test('an unavailable provider is routed around', async () => {
  const { engine } = setup({ health: { gemini: false } });
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'tiny change', { kind: 'auto' });
  const voted = await waitFor(engine, tab.id, ['awaiting-start']);
  expect(voted.vote?.decision).toBe('easy');
  expect(voted.tier).toBe('medium');
  expect(voted.worker?.provider).toBe('codex');
  expect(voted.routing).toMatchObject({ shiftedFrom: 'easy', reason: expect.stringContaining('gemini') });
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
