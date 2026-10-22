import { PERMISSION_TOOL, permissionMcpConfig } from '../mcp/launch.js';
import type { JsonObject } from './jsonl.js';
import { runCli } from './run.js';
import { resolveCommand } from './spawn.js';
import { isoFromEpoch, num, VOTE_MAX_BUDGET_USD, type AdapterEvent, type CliSpec, type QuotaWindow, type RunOptions } from './types.js';

const CLAUDE_WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day' };

function quotaFromRateLimit(o: JsonObject): AdapterEvent[] {
  const info = o.rate_limit_info;
  if (!info || typeof info !== 'object') return [];
  const unified = (info as JsonObject).unifiedWindows;
  if (!unified || typeof unified !== 'object') return [];
  const windows: QuotaWindow[] = [];
  for (const [key, value] of Object.entries(unified as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const w = value as JsonObject;
    if (typeof w.utilization !== 'number') continue;
    windows.push({ name: CLAUDE_WINDOW_NAMES[key] ?? key.replace(/_/g, '-'), usedPct: w.utilization, resetsAt: isoFromEpoch(w.resetsAt) });
  }
  return windows.length > 0 ? [{ type: 'quota', windows }] : [];
}

/**
 * Claude Code in print mode. Work runs accept edits and send every other
 * permission prompt to Council's MCP tool, which asks the developer; Auto mode
 * skips permissions. Votes and summaries run tool-less and capped.
 */
export function buildClaudeArgs(o: RunOptions): CliSpec {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (o.model) args.push('--model', o.model);

  if (o.purpose === 'work') {
    if (o.resumeId) args.push('--resume', o.resumeId);
    if (o.fullAuto) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'acceptEdits');
      if (o.permissions) args.push('--mcp-config', permissionMcpConfig(o.permissions), '--permission-prompt-tool', PERMISSION_TOOL);
    }
  } else {
    args.push('--tools', '', '--no-session-persistence', '--max-budget-usd', String(VOTE_MAX_BUDGET_USD));
    if (o.jsonSchema) args.push('--json-schema', JSON.stringify(o.jsonSchema));
  }

  return { cmd: resolveCommand('claude'), args, stdin: o.prompt };
}

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : ''))
    .join('');
}

function contentBlocks(o: JsonObject): JsonObject[] {
  const message = o.message;
  if (!message || typeof message !== 'object') return [];
  const content = (message as JsonObject).content;
  return Array.isArray(content) ? (content.filter((b) => b && typeof b === 'object') as JsonObject[]) : [];
}

export function parseClaudeLine(o: JsonObject): AdapterEvent[] {
  switch (o.type) {
    case 'system':
      return o.subtype === 'init' && typeof o.session_id === 'string' ? [{ type: 'session', id: o.session_id }] : [];

    case 'rate_limit_event':
      return quotaFromRateLimit(o);

    case 'assistant': {
      const out: AdapterEvent[] = [];
      for (const block of contentBlocks(o)) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
          out.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          out.push({
            type: 'tool',
            id: typeof block.id === 'string' ? block.id : undefined,
            name: block.name,
            input: block.input,
          });
        }
      }
      return out;
    }

    case 'user': {
      const out: AdapterEvent[] = [];
      for (const block of contentBlocks(o)) {
        if (block.type === 'tool_result') {
          out.push({
            type: 'tool_result',
            id: typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
            output: blocksToText(block.content),
            isError: block.is_error === true,
          });
        }
      }
      return out;
    }

    case 'result': {
      const usage = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as JsonObject;
      const text =
        o.structured_output !== undefined
          ? JSON.stringify(o.structured_output)
          : typeof o.result === 'string'
            ? o.result
            : undefined;
      return [
        {
          type: 'result',
          usage: {
            inputTokens: num(usage.input_tokens),
            cachedInputTokens: num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens),
            outputTokens: num(usage.output_tokens),
          },
          costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : undefined,
          exitCode: 0,
          isError: o.is_error === true,
          text,
        },
      ];
    }

    default:
      return [];
  }
}

export function runClaude(opts: RunOptions): AsyncIterable<AdapterEvent> {
  return runCli(buildClaudeArgs(opts), { cwd: opts.cwd, env: opts.env, signal: opts.signal }, parseClaudeLine);
}
