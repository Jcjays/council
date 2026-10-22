import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Adapter, AdapterEvent, CliHealth, Provider, RunOptions } from '../src/adapters/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/config/settings.js';
import { DEFAULT_PRICING } from '../src/ledger/pricing.js';
import type { Decision } from '../src/mcp/permission-tool.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { TabStore } from '../src/tasks/store.js';
import type { Tab, TranscriptItem } from '../src/tasks/types.js';
import type { TabStatus } from '../src/tasks/state.js';
import { FakeAdapter, registry, sleep } from './helpers/fakeAdapter.js';

interface Ask {
  toolName: string;
  input: unknown;
}

/** A Claude stand-in that asks Council for permission the way the MCP tool does, then reports what it was told. */
class AskingAdapter implements Adapter {
  readonly provider: Provider = 'claude';
  calls: RunOptions[] = [];
  decisions: Decision[] = [];

  constructor(
    private readonly engine: () => TaskEngine,
    private readonly asks: Ask[],
  ) {}

  async check(): Promise<CliHealth> {
    return { installed: true, authed: true };
  }

  async *run(opts: RunOptions): AsyncGenerator<AdapterEvent> {
    this.calls.push(opts);
    yield { type: 'session', id: 'claude-session' };
    for (const ask of this.asks) {
      const bridge = opts.permissions;
      if (!bridge) {
        this.decisions.push({ behavior: 'deny', message: 'no bridge' });
        continue;
      }
      let reply = this.engine().askPermission({ tabId: bridge.tabId, token: bridge.token, toolName: ask.toolName, input: ask.input });
      while (reply.status === 'pending') reply = await this.engine().waitForPermission(reply.id, bridge.token, 50);
      this.decisions.push(reply.decision);
    }
    yield { type: 'result', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0.001, exitCode: 0, isError: false, text: 'done' };
  }
}

function setup(asks: Ask[], settings: Partial<Settings> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'council-perm-'));
  let engine!: TaskEngine;
  const claude = new AskingAdapter(() => engine, asks);
  const idle = new FakeAdapter('codex', { events: [] });
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings };
  engine = new TaskEngine({
    adapters: registry(claude, idle, new FakeAdapter('gemini', { events: [] })) as Record<Provider, Adapter>,
    diffStat: async () => '',
    store: new TabStore(path.join(home, 'projects')),
    ledgerFile: path.join(home, 'ledger.jsonl'),
    settings: () => s,
    pricing: () => DEFAULT_PRICING,
    snapshot: async () => '',
    permissionUrl: () => 'http://127.0.0.1:4318',
  });
  engine.on('engine-error', () => {});
  return { engine, claude };
}

function waitFor(engine: TaskEngine, tabId: string, statuses: TabStatus[], timeoutMs = 5000): Promise<Tab> {
  return new Promise((resolve, reject) => {
    const current = engine.getTab(tabId);
    if (current && statuses.includes(current.status)) return resolve(current);
    const timer = setTimeout(() => reject(new Error(`timed out; tab is ${engine.getTab(tabId)?.status}`)), timeoutMs);
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

async function pendingRequest(engine: TaskEngine, tabId: string, nth = 1): Promise<TranscriptItem> {
  for (let i = 0; i < 200; i++) {
    const items = engine.getTab(tabId)?.transcript.filter((t) => t.kind === 'permission') ?? [];
    const item = items[nth - 1];
    if (item && (item.data as { status: string }).status === 'pending') return item;
    await sleep(10);
  }
  throw new Error('no pending permission request appeared');
}

const reqId = (item: TranscriptItem) => (item.data as { id: string }).id;
const manualClaude = { kind: 'manual' as const, provider: 'claude' as const, model: 'claude-sonnet-5-5' };

test('in ask mode the worker gets a permission bridge naming its tab and run', async () => {
  const { engine, claude } = setup([]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  await waitFor(engine, tab.id, ['idle']);
  expect(claude.calls[0]?.fullAuto).toBe(false);
  expect(claude.calls[0]?.permissions).toEqual({ url: 'http://127.0.0.1:4318', tabId: tab.id, token: expect.stringMatching(/^[\w-]{16,}$/) });
});

test('auto mode, from the global default, runs with no prompts and no bridge', async () => {
  const { engine, claude } = setup([], { permissionMode: 'auto' });
  const tab = await engine.createTab('C:/proj', 't');
  expect(tab.fullAuto).toBe(true);
  await engine.submit(tab.id, 'go', manualClaude);
  await waitFor(engine, tab.id, ['idle']);
  expect(claude.calls[0]?.fullAuto).toBe(true);
  expect(claude.calls[0]?.permissions).toBeUndefined();
});

test('a request waits in the transcript for the developer; Allow once lets the worker go on and the next one asks again', async () => {
  const { engine, claude } = setup([
    { toolName: 'Bash', input: { command: 'npm test' } },
    { toolName: 'Bash', input: { command: 'npm test' } },
  ]);
  const announced: unknown[] = [];
  engine.on('permission', (e) => announced.push(e));
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);

  const first = await pendingRequest(engine, tab.id);
  expect(first.data).toMatchObject({ toolName: 'Bash', input: { command: 'npm test' }, rule: 'Bash(npm test:*)', action: 'run a command', detail: 'npm test', status: 'pending' });
  expect(announced).toEqual([{ tabId: tab.id, item: expect.objectContaining({ id: first.id }) }]);
  expect(engine.getTab(tab.id)?.status).toBe('running');
  await engine.answerPermission(reqId(first), 'allow-once');
  expect((engine.getTab(tab.id)?.transcript.find((i) => i.id === first.id)?.data as { status: string }).status).toBe('allowed');

  const second = await pendingRequest(engine, tab.id, 2);
  await engine.answerPermission(reqId(second), 'allow-once');
  await waitFor(engine, tab.id, ['idle']);
  expect(claude.decisions).toEqual([{ behavior: 'allow' }, { behavior: 'allow' }]);
});

test('Allow for this tab remembers the rule, so a matching request is allowed without asking', async () => {
  const { engine, claude } = setup([
    { toolName: 'Bash', input: { command: 'npm test' } },
    { toolName: 'Bash', input: { command: 'npm test -- src/a.test.ts' } },
  ]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  await engine.answerPermission(reqId(await pendingRequest(engine, tab.id)), 'allow-tab');
  const idle = await waitFor(engine, tab.id, ['idle']);
  expect(claude.decisions).toEqual([{ behavior: 'allow' }, { behavior: 'allow' }]);
  expect(idle.allowedTools).toEqual(['Bash(npm test:*)']);
  expect(idle.transcript.filter((i) => i.kind === 'permission')).toHaveLength(1);
  expect((idle.transcript.find((i) => i.kind === 'permission')?.data as { status: string }).status).toBe('allowed-tab');
});

test('Deny tells the worker why', async () => {
  const { engine, claude } = setup([{ toolName: 'Bash', input: { command: 'rm -rf build' } }]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  await engine.answerPermission(reqId(await pendingRequest(engine, tab.id)), 'deny');
  await waitFor(engine, tab.id, ['idle']);
  expect(claude.decisions).toEqual([{ behavior: 'deny', message: expect.stringMatching(/developer denied/i) }]);
});

test('a long-poll returns pending until the answer, then the decision', async () => {
  const { engine, claude } = setup([{ toolName: 'WebFetch', input: { url: 'https://example.com' } }]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  const item = await pendingRequest(engine, tab.id);
  const token = claude.calls[0]?.permissions?.token as string;
  expect(await engine.waitForPermission(reqId(item), token, 20)).toEqual({ id: reqId(item), status: 'pending' });
  await engine.answerPermission(reqId(item), 'allow-once');
  expect(await engine.waitForPermission(reqId(item), token, 20)).toEqual({ id: reqId(item), status: 'answered', decision: { behavior: 'allow' } });
});

test('requests with a wrong token, or for a tab with no run, are refused', async () => {
  const { engine } = setup([{ toolName: 'Bash', input: { command: 'ls' } }]);
  const tab = await engine.createTab('C:/proj', 't');
  expect(() => engine.askPermission({ tabId: tab.id, token: 'x', toolName: 'Bash', input: {} })).toThrow(/no running worker/);
  await engine.submit(tab.id, 'go', manualClaude);
  const item = await pendingRequest(engine, tab.id);
  expect(() => engine.askPermission({ tabId: tab.id, token: 'wrong', toolName: 'Bash', input: {} })).toThrow(/token/);
  await expect(engine.waitForPermission(reqId(item), 'wrong', 10)).rejects.toThrow(/token/);
  await engine.answerPermission(reqId(item), 'allow-once');
});

test('switching the tab to Auto answers the waiting request and later ones', async () => {
  const { engine, claude } = setup([
    { toolName: 'Bash', input: { command: 'make' } },
    { toolName: 'Bash', input: { command: 'make install' } },
  ]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  await pendingRequest(engine, tab.id);
  const switched = await engine.setPermissionMode(tab.id, 'auto');
  expect(switched.fullAuto).toBe(true);
  await waitFor(engine, tab.id, ['idle']);
  expect(claude.decisions).toEqual([{ behavior: 'allow' }, { behavior: 'allow' }]);
});

test('closing the tab denies whatever is still waiting', async () => {
  const { engine, claude } = setup([{ toolName: 'Bash', input: { command: 'make' } }]);
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  await pendingRequest(engine, tab.id);
  await engine.close(tab.id);
  for (let i = 0; i < 100 && claude.decisions.length === 0; i++) await sleep(10);
  expect(claude.decisions).toEqual([{ behavior: 'deny', message: expect.any(String) }]);
});

test('the stall timer does not fire while the developer is being asked', async () => {
  const { engine } = setup([{ toolName: 'Bash', input: { command: 'make' } }], { stallMinutes: 0.0005 });
  const stalls: unknown[] = [];
  engine.on('stall', (e) => stalls.push(e));
  const tab = await engine.createTab('C:/proj', 't');
  await engine.submit(tab.id, 'go', manualClaude);
  const item = await pendingRequest(engine, tab.id);
  await sleep(150);
  expect(stalls).toEqual([]);
  await engine.answerPermission(reqId(item), 'allow-once');
  await waitFor(engine, tab.id, ['idle']);
});
