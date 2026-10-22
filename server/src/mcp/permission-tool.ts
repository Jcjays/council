/**
 * Stdio MCP server that Claude Code calls (via `--permission-prompt-tool`) when
 * a worker wants to do something that needs the developer's OK. It forwards the
 * request to the Council server, long-polls for the developer's answer and
 * returns it in the shape Claude Code expects.
 *
 * Self-contained on purpose (only `node:` imports, erasable TypeScript): Node 24
 * runs it straight from `src/` in development and from `dist/` once built.
 * Environment, set by Council for each run: COUNCIL_URL, COUNCIL_TAB_ID,
 * COUNCIL_PERMISSION_TOKEN.
 */
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

export const SERVER_NAME = 'council';
export const TOOL_NAME = 'approve';

export interface ToolEnv {
  url: string;
  tabId: string;
  token: string;
}

export interface AskBody {
  tabId: string;
  token: string;
  toolName: string;
  input: unknown;
  toolUseId?: string;
}

export type Decision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

type ClaudeAnswer = { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string };

type Json = Record<string, unknown>;

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    tool_name: { type: 'string', description: 'The tool Claude wants to use' },
    input: { type: 'object', description: 'The input it wants to pass' },
    tool_use_id: { type: 'string' },
  },
  required: ['tool_name', 'input'],
};

export function envFromProcess(env: NodeJS.ProcessEnv): ToolEnv {
  const url = env.COUNCIL_URL;
  const tabId = env.COUNCIL_TAB_ID;
  const token = env.COUNCIL_PERMISSION_TOKEN;
  if (!url || !tabId || !token) throw new Error('COUNCIL_URL, COUNCIL_TAB_ID and COUNCIL_PERMISSION_TOKEN must be set');
  return { url: url.replace(/\/+$/, ''), tabId, token };
}

export function toAskBody(args: unknown, env: ToolEnv): AskBody {
  const a = args && typeof args === 'object' ? (args as Json) : {};
  const body: AskBody = {
    tabId: env.tabId,
    token: env.token,
    toolName: typeof a.tool_name === 'string' ? a.tool_name : 'unknown',
    input: a.input ?? {},
  };
  if (typeof a.tool_use_id === 'string') body.toolUseId = a.tool_use_id;
  return body;
}

export function toClaudeAnswer(decision: Decision, input: unknown): ClaudeAnswer {
  return decision.behavior === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: decision.message };
}

async function post(fetchImpl: typeof fetch, url: string, body: unknown): Promise<Json> {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Council answered ${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

function decisionOf(reply: Json): Decision | undefined {
  if (reply.status !== 'answered' || !reply.decision || typeof reply.decision !== 'object') return undefined;
  const d = reply.decision as Json;
  if (d.behavior === 'allow') return { behavior: 'allow' };
  return { behavior: 'deny', message: typeof d.message === 'string' ? d.message : 'Denied in Council' };
}

/** Asks Council, then waits (in short long-polls) for as long as the developer takes. */
export async function askCouncil(env: ToolEnv, body: AskBody, fetchImpl: typeof fetch = fetch): Promise<Decision> {
  let reply = await post(fetchImpl, `${env.url}/api/permissions/ask`, body);
  for (;;) {
    const decision = decisionOf(reply);
    if (decision) return decision;
    if (typeof reply.id !== 'string') throw new Error('Council did not return a request id');
    reply = await post(fetchImpl, `${env.url}/api/permissions/${encodeURIComponent(reply.id)}/wait`, { token: env.token });
  }
}

/** JSON-RPC message handler; returns the response, or undefined for notifications. */
export function createHandler(ask: (args: unknown) => Promise<Decision>): (msg: unknown) => Promise<Json | undefined> {
  return async (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    const msg = raw as Json;
    const id = msg.id;
    if (id === undefined || id === null) return undefined;
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });

    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: '1.0.0' },
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({
          tools: [{ name: TOOL_NAME, description: 'Ask the developer in Council whether this tool use may go ahead.', inputSchema: INPUT_SCHEMA }],
        });
      case 'tools/call': {
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
        let decision: Decision;
        try {
          decision = await ask(args);
        } catch (err) {
          decision = { behavior: 'deny', message: `Council could not be reached to ask the developer: ${err instanceof Error ? err.message : String(err)}` };
        }
        return ok({ content: [{ type: 'text', text: JSON.stringify(toClaudeAnswer(decision, args.input ?? {})) }] });
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(msg.method)}` } };
    }
  };
}

function main(): void {
  const env = envFromProcess(process.env);
  const handle = createHandler((args) => askCouncil(env, toAskBody(args, env)));
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    void handle(msg).then((res) => {
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
