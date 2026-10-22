import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import WebSocket from 'ws';
import type { Adapter, AdapterEvent, Provider, RunOptions } from '../src/adapters/types.js';
import { SettingsStore } from '../src/config/settings.js';
import { DEFAULT_PRICING, PricingStore } from '../src/ledger/pricing.js';
import { askCouncil, toAskBody, type Decision } from '../src/mcp/permission-tool.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { TabStore } from '../src/tasks/store.js';
import { FakeAdapter, registry } from './helpers/fakeAdapter.js';
import { createServer, type CouncilServer } from '../src/http.js';
import { makeEngine, type EngineFixture } from './helpers/engineSetup.js';

let fixture: EngineFixture;
let server: CouncilServer;
let base: string;

beforeAll(async () => {
  fixture = makeEngine();
  const clientDist = path.join(fixture.home, 'dist');
  fs.mkdirSync(path.join(clientDist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><title>Council</title>');
  fs.writeFileSync(path.join(clientDist, 'assets', 'app.js'), 'console.log(1)');
  server = createServer({
    engine: fixture.engine,
    settings: new SettingsStore(path.join(fixture.home, 'settings.json'), fixture.settings),
    pricing: new PricingStore(path.join(fixture.home, 'pricing.json'), undefined, async () => ({
      table: { 'claude-haiku-5-5': { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 } },
      source: 'LiteLLM',
      errors: [],
    })),
    health: async () => ({
      claude: { installed: true, version: '2.1.302', authed: true },
      codex: { installed: false, authed: false, error: 'not found' },
      gemini: { installed: true, version: '0.15.3', authed: false },
    }),
    clientDist,
  });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

async function api(method: string, route: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

test('GET /api/health returns one entry per provider', async () => {
  const r = await api('GET', '/api/health');
  expect(r.status).toBe(200);
  expect(Object.keys(r.json).sort()).toEqual(['claude', 'codex', 'gemini']);
  expect(r.json.codex).toMatchObject({ installed: false });
});

test('GET /api/settings returns the settings and PUT merges and persists a change', async () => {
  const before = await api('GET', '/api/settings');
  expect(before.json.autoStart).toBe(false);
  const put = await api('PUT', '/api/settings', { autoStart: true, budgets: { gemini: 5 } });
  expect(put.status).toBe(200);
  expect(put.json.autoStart).toBe(true);
  expect(put.json.budgets).toEqual({ claude: 40, codex: 30, gemini: 5 });
  const after = await api('GET', '/api/settings');
  expect(after.json.autoStart).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(fixture.home, 'settings.json'), 'utf8')).autoStart).toBe(true);
  await api('PUT', '/api/settings', { autoStart: false });
});

test('GET /api/pricing reports the table with its source; PUT sets the manual overrides', async () => {
  const r = await api('GET', '/api/pricing');
  expect(r.json.table.flash).toBeDefined();
  expect(r.json).toMatchObject({ source: 'built-in defaults', fetchedAt: null, overrides: {} });
  const put = await api('PUT', '/api/pricing', { flash: { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 } });
  expect(put.status).toBe(200);
  expect(put.json.overrides).toEqual({ flash: { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 } });
  expect(put.json.table.flash).toEqual({ inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 });
  expect(put.json.table.pro).toBeDefined();
  await api('PUT', '/api/pricing', {});
});

test('POST /api/pricing/refresh fetches prices and says where they came from', async () => {
  const r = await api('POST', '/api/pricing/refresh');
  expect(r.status).toBe(200);
  expect(r.json.source).toBe('LiteLLM');
  expect(r.json.fetchedAt).toEqual(expect.any(String));
  expect(r.json.table['claude-haiku-5-5']).toEqual({ inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 });
});

test('GET /api/models lists each provider’s ladder with labels and price badges', async () => {
  const r = await api('GET', '/api/models');
  expect(r.status).toBe(200);
  expect(Object.keys(r.json).sort()).toEqual(['claude', 'codex', 'gemini']);
  expect(r.json.claude[0]).toMatchObject({ id: 'claude-haiku-5-5', label: 'Haiku 5.5', price: { inputPerM: 0.1, outputPerM: 0.5 } });
  expect(r.json.gemini.map((m: { id: string }) => m.id)).toEqual(['flash-lite', 'flash', 'pro']);
});

test('GET /api/routing describes the effective council and tier map', async () => {
  const r = await api('GET', '/api/routing');
  expect(r.status).toBe(200);
  expect(r.json.available).toBeInstanceOf(Array);
  expect(r.json.seats).toBeInstanceOf(Array);
  expect(Object.keys(r.json.tierMap).sort()).toEqual(['easy', 'hard', 'medium']);
  expect(r.json.notes).toBeInstanceOf(Array);
});

test('GET /api/budgets returns the three providers', async () => {
  const r = await api('GET', '/api/budgets');
  expect(r.status).toBe(200);
  expect(r.json.gemini).toMatchObject({ limit: 30, spent: 0 });
});

test('tabs: create, list, get, submit; the websocket streams the tab updates', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  const messages: any[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));

  const created = await api('POST', '/api/tabs', { projectRoot: 'C:/proj', title: 'Rename' });
  expect(created.status).toBe(201);
  expect(created.json.status).toBe('drafting');
  const id = created.json.id as string;

  const list = await api('GET', `/api/tabs?projectId=${created.json.projectId}`);
  expect(list.json.map((t: any) => t.id)).toContain(id);
  expect((await api('GET', `/api/tabs/${id}`)).json.title).toBe('Rename');

  const submitted = await api('POST', `/api/tabs/${id}/submit`, { text: 'rename foo', mode: { kind: 'auto' } });
  expect(submitted.status).toBe(200);
  expect(submitted.json.status).toBe('voting');

  for (let i = 0; i < 100 && !messages.some((m) => m.type === 'tab' && m.tab.id === id && m.tab.status === 'awaiting-start'); i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  expect(messages[0]?.type).toBe('hello');
  expect(messages[0].tabs).toBeInstanceOf(Array);
  expect(messages[0].budgets.gemini).toBeDefined();
  expect(messages.some((m) => m.type === 'item' && m.tabId === id && m.item.kind === 'vote')).toBe(true);
  const final = messages.filter((m) => m.type === 'tab' && m.tab.id === id).at(-1);
  expect(final.tab.status).toBe('awaiting-start');
  expect(final.tab.worker.provider).toBe('gemini');

  const started = await api('POST', `/api/tabs/${id}/start`, { provider: 'claude', model: 'claude-sonnet-5-5' });
  expect(started.json.worker).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' });
  for (let i = 0; i < 100 && fixture.engine.getTab(id)?.status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 30));
  expect(fixture.engine.getTab(id)?.status).toBe('idle');

  expect((await api('POST', `/api/tabs/${id}/merge`)).status).toBe(404);

  const closed = await api('POST', `/api/tabs/${id}/close`);
  expect(closed.json.status).toBe('closed');
  ws.close();
});

test('POST /api/projects validates the path and registers it as recent', async () => {
  const missing = await api('POST', '/api/projects', { path: path.join(fixture.home, 'nope') });
  expect(missing.status).toBe(400);
  const notRepo = await api('POST', '/api/projects', { path: fixture.home });
  expect(notRepo.status).toBe(400);
  expect(String(notRepo.json.error)).toMatch(/git/i);
});

test('errors are JSON: 404 for unknown routes, 400 for bad bodies and wrong-state actions', async () => {
  expect((await api('GET', '/api/nope')).status).toBe(404);
  expect((await api('POST', '/api/tabs', '{ not json')).status).toBe(400);
  const t = await api('POST', '/api/tabs', { projectRoot: 'C:/proj', title: 'x' });
  const wrong = await api('POST', `/api/tabs/${t.json.id}/start`);
  expect(wrong.status).toBe(400);
  expect(wrong.json.error).toMatch(/drafting/);
  expect((await api('GET', '/api/tabs/does-not-exist')).status).toBe(404);
});

test('cross-origin requests cannot drive the API or the websocket', async () => {
  const evil = await fetch(`${base}/api/tabs`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
    body: JSON.stringify({ projectRoot: 'C:/proj', title: 'pwned' }),
  });
  expect(evil.status).toBe(403);
  const sameOriginOtherPort = await fetch(`${base}/api/budgets`, { headers: { origin: 'http://localhost:5173' } });
  expect(sameOriginOtherPort.status).toBe(200);
  const noJson = await fetch(`${base}/api/tabs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"projectRoot":"C:/proj"}' });
  expect(noJson.status).toBe(415);

  const rejected = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { origin: 'http://evil.example' } });
    ws.on('open', () => {
      ws.close();
      resolve(false);
    });
    ws.on('unexpected-response', () => resolve(true));
    ws.on('error', () => resolve(true));
  });
  expect(rejected).toBe(true);
});

test('serves the built client with an SPA fallback', async () => {
  const index = await fetch(`${base}/`);
  expect(index.status).toBe(200);
  expect(await index.text()).toContain('<title>Council</title>');
  const deep = await fetch(`${base}/settings/anything`);
  expect(await deep.text()).toContain('<title>Council</title>');
  const asset = await fetch(`${base}/assets/app.js`);
  expect(asset.headers.get('content-type')).toMatch(/javascript/);
  expect(await asset.text()).toBe('console.log(1)');
});

describe('permission prompts over HTTP', () => {
  let permServer: CouncilServer;
  let permBase = '';
  let engine: TaskEngine;
  const decisions: Decision[] = [];

  /** Asks exactly as the MCP permission tool does, over the real HTTP API. */
  class AskingClaude extends FakeAdapter {
    constructor() {
      super('claude', { events: [] });
    }
    override async *run(opts: RunOptions): AsyncGenerator<AdapterEvent> {
      this.calls.push(opts);
      yield { type: 'session', id: 's' };
      const bridge = opts.permissions!;
      const env = { url: bridge.url, tabId: bridge.tabId, token: bridge.token };
      decisions.push(await askCouncil(env, toAskBody({ tool_name: 'Bash', input: { command: 'npm test' }, tool_use_id: 'tu1' }, env)));
      yield { type: 'result', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0, exitCode: 0, isError: false, text: 'ok' };
    }
  }

  beforeAll(async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'council-http-perm-'));
    const settings = new SettingsStore(path.join(home, 'settings.json'));
    const claude = new AskingClaude();
    engine = new TaskEngine({
      adapters: registry(claude, new FakeAdapter('codex', { events: [] }), new FakeAdapter('gemini', { events: [] })) as Record<Provider, Adapter>,
      store: new TabStore(path.join(home, 'projects')),
      ledgerFile: path.join(home, 'ledger.jsonl'),
      settings: () => settings.get(),
      pricing: () => DEFAULT_PRICING,
      snapshot: async () => '',
      diffStat: async () => '',
      permissionUrl: () => permBase,
    });
    engine.on('engine-error', () => {});
    permServer = createServer({ engine, settings, pricing: new PricingStore(path.join(home, 'pricing.json')), health: async () => ({}) as never });
    permBase = `http://127.0.0.1:${await permServer.listen(0, '127.0.0.1')}`;
  });

  afterAll(async () => {
    await permServer.close();
  });

  const call = async (route: string, body: unknown) => {
    const res = await fetch(`${permBase}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };

  test('the tool asks, the developer answers from the page, and the worker gets the answer', async () => {
    const tab = engine.createTab('C:/proj', 't');
    const id = (await tab).id;
    await call(`/api/tabs/${id}/submit`, { text: 'go', mode: { kind: 'manual', provider: 'claude', model: null } });
    let item: any;
    for (let i = 0; i < 200 && !item; i++) {
      item = engine.getTab(id)?.transcript.find((t) => t.kind === 'permission');
      if (!item) await new Promise((r) => setTimeout(r, 10));
    }
    expect(item.data).toMatchObject({ toolName: 'Bash', detail: 'npm test', status: 'pending' });
    const answered = await call(`/api/permissions/${item.data.id}/answer`, { answer: 'allow-tab' });
    expect(answered.status).toBe(200);
    expect(answered.json.allowedTools).toEqual(['Bash(npm test:*)']);
    for (let i = 0; i < 200 && engine.getTab(id)?.status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(decisions).toEqual([{ behavior: 'allow' }]);
  });

  test('a call with a bad token or for an unknown request is refused, and a bad answer is a 400', async () => {
    const id = (await engine.createTab('C:/proj', 't2')).id;
    expect((await call('/api/permissions/ask', { tabId: id, token: 'nope', toolName: 'Bash', input: {} })).status).toBe(403);
    expect((await call('/api/permissions/unknown/wait', { token: 'nope' })).status).toBe(403);
    expect((await call('/api/permissions/unknown/answer', { answer: 'maybe' })).status).toBe(400);
  });

  test('POST /api/tabs/:id/permissions switches the tab between Ask me and Auto', async () => {
    const id = (await engine.createTab('C:/proj', 't3')).id;
    const r = await call(`/api/tabs/${id}/permissions`, { mode: 'auto' });
    expect(r.status).toBe(200);
    expect(r.json.fullAuto).toBe(true);
    expect((await call(`/api/tabs/${id}/permissions`, { mode: 'sometimes' })).status).toBe(400);
  });
});
