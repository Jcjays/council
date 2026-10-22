import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { askCouncil, createHandler, envFromProcess, toAskBody, toClaudeAnswer, TOOL_NAME, type Decision } from '../src/mcp/permission-tool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** What Claude Code 2.1.302 sent the permission tool for `node -e "console.log(6*7)"`. */
const session = fs
  .readFileSync(path.join(here, 'fixtures', 'claude-permission-mcp.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { method: string; id?: string | number; params?: { arguments?: unknown } });
const byMethod = (m: string) => session.find((s) => s.method === m)!;
const env = { url: 'http://127.0.0.1:4318', tabId: 'tab-1', token: 'secret' };

test('answers the MCP handshake and lists one tool', async () => {
  const handle = createHandler(async () => ({ behavior: 'allow' }));
  const discover = await handle(byMethod('server/discover'));
  expect(discover).toMatchObject({ jsonrpc: '2.0', id: 'server-discover-probe-1', error: { code: -32601 } });
  const init = await handle(byMethod('initialize'));
  expect(init).toMatchObject({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'council' } } });
  expect(await handle(byMethod('notifications/initialized'))).toBeUndefined();
  const list = (await handle(byMethod('tools/list'))) as { result: { tools: { name: string; inputSchema: { required: string[] } }[] } };
  expect(list.result.tools.map((t) => t.name)).toEqual([TOOL_NAME]);
  expect(list.result.tools[0]?.inputSchema.required).toEqual(['tool_name', 'input']);
});

test("a tools/call becomes a question to Council and the answer comes back in Claude Code's shape", async () => {
  const asked: unknown[] = [];
  const handle = createHandler(async (args) => {
    asked.push(args);
    return { behavior: 'allow' };
  });
  const call = byMethod('tools/call');
  const res = (await handle(call)) as { id: number; result: { content: { type: string; text: string }[] } };
  expect(res.id).toBe(2);
  expect(asked).toEqual([call.params?.arguments]);
  expect(JSON.parse(res.result.content[0]!.text)).toEqual({
    behavior: 'allow',
    updatedInput: { command: 'node -e "console.log(6*7)"', description: 'Run node one-liner printing 6*7' },
  });
});

test('a denial carries the message, and an unreachable Council denies rather than allows', async () => {
  expect(toClaudeAnswer({ behavior: 'deny', message: 'Not now' }, {})).toEqual({ behavior: 'deny', message: 'Not now' });
  const handle = createHandler(async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const res = (await handle(byMethod('tools/call'))) as { result: { content: { text: string }[] } };
  expect(JSON.parse(res.result.content[0]!.text)).toEqual({ behavior: 'deny', message: expect.stringMatching(/Council could not be reached.*ECONNREFUSED/) });
});

test('the question names the tab and run token from the environment Council set', () => {
  expect(envFromProcess({ COUNCIL_URL: env.url, COUNCIL_TAB_ID: env.tabId, COUNCIL_PERMISSION_TOKEN: env.token })).toEqual(env);
  expect(() => envFromProcess({})).toThrow(/COUNCIL_URL/);
  expect(toAskBody(byMethod('tools/call').params?.arguments, env)).toEqual({
    tabId: 'tab-1',
    token: 'secret',
    toolName: 'Bash',
    input: { command: 'node -e "console.log(6*7)"', description: 'Run node one-liner printing 6*7' },
    toolUseId: 'toolu_012sw4NBnhTUKtQtQDsjm1g4',
  });
});

test('askCouncil asks once, then long-polls until the developer answers', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const replies = [{ id: 'p1', status: 'pending' }, { id: 'p1', status: 'pending' }, { id: 'p1', status: 'answered', decision: { behavior: 'deny', message: 'no' } }];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const body = toAskBody(byMethod('tools/call').params?.arguments, env);
  const decision: Decision = await askCouncil(env, body, fetchImpl);
  expect(decision).toEqual({ behavior: 'deny', message: 'no' });
  expect(calls.map((c) => c.url)).toEqual([
    'http://127.0.0.1:4318/api/permissions/ask',
    'http://127.0.0.1:4318/api/permissions/p1/wait',
    'http://127.0.0.1:4318/api/permissions/p1/wait',
  ]);
  expect(calls[0]?.body).toEqual(body);
  expect(calls[1]?.body).toEqual({ token: 'secret' });
});

test('askCouncil fails on an HTTP error so the handler can deny', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: 'unknown run' }), { status: 403 })) as unknown as typeof fetch;
  await expect(askCouncil(env, toAskBody({ tool_name: 'Bash', input: {} }, env), fetchImpl)).rejects.toThrow(/403.*unknown run/);
});
