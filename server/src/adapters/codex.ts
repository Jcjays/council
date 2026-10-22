import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JsonObject } from './jsonl.js';
import { runCli } from './run.js';
import { resolveCommand } from './spawn.js';
import { isoFromEpoch, num, windowName, ZERO_USAGE, type AdapterEvent, type CliSpec, type ProviderPlan, type QuotaWindow, type RunOptions } from './types.js';

/** Codex attaches `rate_limits` snapshots ({primary, secondary}) to some events. */
function quotaFromRateLimits(o: JsonObject): AdapterEvent[] {
  const limits = o.rate_limits;
  if (!limits || typeof limits !== 'object') return [];
  const windows: QuotaWindow[] = [];
  for (const value of Object.values(limits as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const w = value as JsonObject;
    if (typeof w.used_percent !== 'number') continue;
    const minutes = num(w.window_minutes);
    windows.push({
      name: minutes > 0 ? windowName(minutes) : 'window',
      usedPct: Math.min(1, Math.max(0, w.used_percent / 100)),
      resetsAt: isoFromEpoch(w.resets_at),
    });
  }
  const out: AdapterEvent[] = windows.length > 0 ? [{ type: 'quota', windows }] : [];
  const plan = (limits as JsonObject).plan_type;
  if (typeof plan === 'string' && plan !== '') out.push({ type: 'account', plan: codexPlanFromType(plan) });
  return out;
}

/** `plan_type` of a rate-limit snapshot: a ChatGPT plan name, or an API key. */
function codexPlanFromType(plan: string): ProviderPlan {
  if (/api|key/i.test(plan)) return { kind: 'api-key', label: 'OpenAI API key', confirmed: true };
  return { kind: 'subscription', label: `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`, confirmed: true };
}

/**
 * Codex CLI `exec` in JSONL mode. Work runs get a workspace-write sandbox (or no
 * sandbox under fullAuto); votes run read-only with an output schema file.
 */
export function buildCodexArgs(o: RunOptions, schemaPath?: string): CliSpec {
  const args = ['exec', '--json', '-C', o.cwd, '--skip-git-repo-check'];
  if (o.purpose === 'work') {
    if (o.fullAuto) args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', 'workspace-write');
  } else {
    args.push('--sandbox', 'read-only');
    if (schemaPath) args.push('--output-schema', schemaPath);
  }
  if (o.model) args.push('-m', o.model);
  if (o.purpose === 'work' && o.resumeId) args.push('resume', o.resumeId);
  args.push('-');
  return { cmd: resolveCommand('codex'), args, stdin: o.prompt };
}

function itemId(item: JsonObject): string | undefined {
  return typeof item.id === 'string' ? item.id : undefined;
}

function completedItem(item: JsonObject, remember: (text: string) => void): AdapterEvent[] {
  const id = itemId(item);
  switch (item.type) {
    case 'agent_message':
      if (typeof item.text === 'string' && item.text !== '') {
        remember(item.text);
        return [{ type: 'text', text: item.text }];
      }
      return [];

    case 'command_execution': {
      const exitCode = item.exit_code;
      const isError = typeof exitCode === 'number' ? exitCode !== 0 : item.status === 'failed';
      return [
        { type: 'tool', id, name: 'command_execution', input: { command: item.command } },
        {
          type: 'tool_result',
          id,
          output: item.aggregated_output === undefined || item.aggregated_output === null ? '' : String(item.aggregated_output),
          isError,
        },
      ];
    }

    case 'file_change':
      return [{ type: 'tool', id, name: 'file_change', input: item.changes }];

    case 'mcp_tool_call':
      return [
        { type: 'tool', id, name: `${String(item.server ?? 'mcp')}.${String(item.tool ?? 'tool')}`, input: item.arguments },
        {
          type: 'tool_result',
          id,
          output: JSON.stringify(item.result ?? item.error ?? ''),
          isError: item.status === 'failed',
        },
      ];

    case 'web_search':
      return [{ type: 'tool', id, name: 'web_search', input: { query: item.query } }];

    case 'error':
      return [{ type: 'error', message: typeof item.message === 'string' ? item.message : JSON.stringify(item) }];

    default:
      return [];
  }
}

/** Stateful per-run parser for `codex exec --json`. */
export function createCodexParser(): (o: JsonObject) => AdapterEvent[] {
  let lastText: string | undefined;
  return (o) => [...quotaFromRateLimits(o), ...parseTyped(o)];

  function parseTyped(o: JsonObject): AdapterEvent[] {
    switch (o.type) {
      case 'thread.started':
        return typeof o.thread_id === 'string' ? [{ type: 'session', id: o.thread_id }] : [];

      case 'item.completed': {
        const item = o.item;
        if (!item || typeof item !== 'object') return [];
        return completedItem(item as JsonObject, (t) => {
          lastText = t;
        });
      }

      case 'turn.completed': {
        const usage = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as JsonObject;
        const cached = num(usage.cached_input_tokens);
        return [
          {
            type: 'result',
            usage: {
              inputTokens: Math.max(0, num(usage.input_tokens) - cached),
              cachedInputTokens: cached,
              outputTokens: num(usage.output_tokens) + num(usage.reasoning_output_tokens),
            },
            costUsd: undefined,
            exitCode: 0,
            isError: false,
            text: lastText,
          },
        ];
      }

      case 'turn.failed': {
        const error = o.error && typeof o.error === 'object' ? (o.error as JsonObject) : undefined;
        return [
          {
            type: 'result',
            usage: ZERO_USAGE,
            costUsd: undefined,
            exitCode: 0,
            isError: true,
            text: error && typeof error.message === 'string' ? error.message : 'turn failed',
          },
        ];
      }

      case 'error':
        return [{ type: 'error', message: typeof o.message === 'string' ? o.message : JSON.stringify(o) }];

      default:
        return [];
    }
  }
}

export async function* runCodex(opts: RunOptions): AsyncGenerator<AdapterEvent> {
  let schemaPath: string | undefined;
  if (opts.purpose !== 'work' && opts.jsonSchema) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-codex-'));
    schemaPath = path.join(dir, 'schema.json');
    await fs.writeFile(schemaPath, JSON.stringify(opts.jsonSchema), 'utf8');
  }
  try {
    yield* runCli(buildCodexArgs(opts, schemaPath), { cwd: opts.cwd, env: opts.env, signal: opts.signal }, createCodexParser());
  } finally {
    if (schemaPath) await fs.rm(path.dirname(schemaPath), { recursive: true, force: true });
  }
}
