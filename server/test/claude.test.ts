import fs from 'node:fs';
import { expect, test } from 'vitest';
import { buildClaudeArgs, parseClaudeLine } from '../src/adapters/claude.js';
import type { AdapterEvent, RunOptions } from '../src/adapters/types.js';
import { fixtureLines } from './helpers/fixtures.js';

const base: RunOptions = {
  cwd: 'C:/w',
  prompt: 'do it',
  model: 'claude-sonnet-5-5',
  purpose: 'work',
  fullAuto: false,
};
const bridge = { url: 'http://127.0.0.1:4318', tabId: 'tab-1', token: 'secret' };

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

test('work args: print mode, stream-json, model, resume and acceptEdits', () => {
  const s = buildClaudeArgs({ ...base, resumeId: 'abc' });
  expect(s.cmd).toBe('claude');
  expect(s.args).toEqual(
    expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5-5', '--resume', 'abc', '--permission-mode', 'acceptEdits']),
  );
  expect(s.args).not.toContain('--dangerously-skip-permissions');
  expect(s.args).not.toContain('--allowedTools');
  expect(s.stdin).toBe('do it');
});

test('ask mode sends every permission prompt to the Council tool for this tab', () => {
  const s = buildClaudeArgs({ ...base, permissions: bridge });
  expect(flag(s.args, '--permission-mode')).toBe('acceptEdits');
  expect(flag(s.args, '--permission-prompt-tool')).toBe('mcp__council__approve');
  const config = JSON.parse(flag(s.args, '--mcp-config') ?? '{}');
  const server = config.mcpServers.council;
  expect(server).toMatchObject({ type: 'stdio', command: process.execPath });
  expect(server.args).toEqual([expect.stringMatching(/permission-tool.(ts|js)$/)]);
  expect(fs.existsSync(server.args[0])).toBe(true);
  expect(server.env).toEqual({ COUNCIL_URL: bridge.url, COUNCIL_TAB_ID: 'tab-1', COUNCIL_PERMISSION_TOKEN: 'secret' });
});

test('fullAuto uses --dangerously-skip-permissions and asks nobody', () => {
  const s = buildClaudeArgs({ ...base, fullAuto: true, permissions: bridge });
  expect(s.args).toContain('--dangerously-skip-permissions');
  expect(s.args).not.toContain('--permission-mode');
  expect(s.args).not.toContain('--mcp-config');
  expect(s.args).not.toContain('--permission-prompt-tool');
});

test('vote args disable tools, cap budget, pass the json schema and skip persistence', () => {
  const s = buildClaudeArgs({ ...base, purpose: 'vote', model: 'claude-haiku-5-5', jsonSchema: { type: 'object' }, permissions: bridge });
  expect(s.args).toEqual(
    expect.arrayContaining(['--tools', '', '--no-session-persistence', '--max-budget-usd', '0.05', '--json-schema', '{"type":"object"}']),
  );
  expect(s.args).not.toContain('--permission-mode');
  expect(s.args).not.toContain('--mcp-config');
  expect(s.args).not.toContain('--resume');
});

test('null model omits --model', () => {
  const s = buildClaudeArgs({ ...base, model: null });
  expect(s.args).not.toContain('--model');
});

test('parses the recorded work stream into session, tool, tool_result, text and result events', () => {
  const events = fixtureLines('claude-work.jsonl').flatMap(parseClaudeLine);
  expect(events[0]).toEqual({ type: 'session', id: 'd679c65c-7956-4f6b-933b-9ae9a3fe31a8' });
  const tool = events.find((e) => e.type === 'tool');
  expect(tool).toMatchObject({ type: 'tool', name: 'Write', id: 'toolu_01HhZMCYHaiYhvHPqnHpyi1a' });
  expect((tool as Extract<AdapterEvent, { type: 'tool' }>).input).toMatchObject({ content: 'hi' });
  const toolResult = events.find((e) => e.type === 'tool_result');
  expect(toolResult).toMatchObject({ type: 'tool_result', id: 'toolu_01HhZMCYHaiYhvHPqnHpyi1a' });
  expect((toolResult as Extract<AdapterEvent, { type: 'tool_result' }>).output).toContain('File created successfully');
  const text = events.find((e) => e.type === 'text');
  expect(text).toMatchObject({ type: 'text', text: expect.stringContaining('hello.txt') });
  const result = events.at(-1);
  expect(result).toEqual({
    type: 'result',
    usage: { inputTokens: 4, cachedInputTokens: 16941 + 49877, outputTokens: 298 },
    costUsd: 0.00403637,
    exitCode: 0,
    isError: false,
    text: 'I created `hello.txt` in the working directory (`scratchpad\\fx-claude`), containing `hi`.',
  });
});

test('parses the recorded vote stream: text pong and a priced result', () => {
  const events = fixtureLines('claude-vote.jsonl').flatMap(parseClaudeLine);
  expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'pong' }]);
  const result = events.at(-1);
  expect(result).toMatchObject({ type: 'result', text: 'pong', isError: false });
  expect((result as Extract<AdapterEvent, { type: 'result' }>).costUsd).toBeCloseTo(0.00114282, 8);
});

test('result with is_error=true maps to isError', () => {
  const [ev] = parseClaudeLine({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    total_cost_usd: 0.01,
    usage: { input_tokens: 1, output_tokens: 2 },
    result: 'boom',
  });
  expect(ev).toMatchObject({ type: 'result', isError: true, costUsd: 0.01, text: 'boom' });
});

test('structured_output is surfaced as result text when present', () => {
  const [ev] = parseClaudeLine({ type: 'result', is_error: false, structured_output: { tier: 'easy' }, usage: {}, total_cost_usd: 0 });
  expect(ev).toMatchObject({ type: 'result', text: '{"tier":"easy"}', usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } });
});

test('a rate_limit_event with plan windows becomes a quota event', () => {
  const line = fixtureLines('claude-vote.jsonl').find((o) => o.type === 'rate_limit_event');
  expect(line).toBeDefined();
  expect(parseClaudeLine(line as Record<string, unknown>)).toEqual([
    {
      type: 'quota',
      windows: [
        { name: '5-hour', usedPct: 0.59, resetsAt: new Date(1792512600 * 1000).toISOString() },
        { name: '7-day', usedPct: 0.51, resetsAt: new Date(1792767600 * 1000).toISOString() },
      ],
    },
  ]);
});

test('hook, thinking and bare rate-limit events produce nothing', () => {
  expect(parseClaudeLine({ type: 'rate_limit_event' })).toEqual([]);
  expect(parseClaudeLine({ type: 'system', subtype: 'thinking_tokens' })).toEqual([]);
  expect(parseClaudeLine({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } })).toEqual([]);
});
