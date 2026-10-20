import { expect, test } from 'vitest';
import { buildGeminiArgs, createGeminiParser, parseGeminiJson } from '../src/adapters/gemini.js';
import type { JsonObject } from '../src/adapters/jsonl.js';

const parseGeminiLine = (o: JsonObject) => createGeminiParser()(o);
import type { AdapterEvent, RunOptions } from '../src/adapters/types.js';
import { fixtureJson, fixtureLines } from './helpers/fixtures.js';

const base: RunOptions = {
  cwd: 'C:/w',
  prompt: 'do it',
  model: 'flash',
  purpose: 'work',
  fullAuto: false,
  allowedCommands: ['Bash(npm test*)'],
};

test('work args: stream-json, model, auto_edit approval, prompt on stdin', () => {
  const s = buildGeminiArgs(base);
  expect(s.cmd).toMatch(/gemini/);
  expect(s.args).toEqual(['-o', 'stream-json', '-m', 'flash', '--approval-mode', 'auto_edit']);
  expect(s.stdin).toBe('do it');
});

test('fullAuto uses --approval-mode yolo', () => {
  const s = buildGeminiArgs({ ...base, fullAuto: true });
  expect(s.args).toEqual(expect.arrayContaining(['--approval-mode', 'yolo']));
  expect(s.args).not.toContain('auto_edit');
});

test('resume passes --resume with the session id', () => {
  const s = buildGeminiArgs({ ...base, resumeId: 'sess-1' });
  expect(s.args).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
});

test('vote args use single-object json output and no approval mode', () => {
  const s = buildGeminiArgs({ ...base, purpose: 'vote' });
  expect(s.args).toEqual(['-o', 'json', '-m', 'flash']);
});

test('null model omits -m', () => {
  expect(buildGeminiArgs({ ...base, model: null }).args).not.toContain('-m');
});

test('parses the stream fixture into session, tool, tool_result, text and result events', () => {
  const parse = createGeminiParser();
  const events = fixtureLines('gemini-work.jsonl').flatMap((l) => parse(l));
  expect(events[0]).toEqual({ type: 'session', id: '2f6d1b1e-7c1a-4b4e-9d1e-gemini000001' });
  expect(events.find((e) => e.type === 'tool')).toEqual({
    type: 'tool',
    id: 'write_file-1761004801000',
    name: 'write_file',
    input: { file_path: 'hello.txt', content: 'hi' },
  });
  expect(events.find((e) => e.type === 'tool_result')).toEqual({
    type: 'tool_result',
    id: 'write_file-1761004801000',
    output: 'Successfully created and wrote to new file: hello.txt.',
    isError: false,
  });
  expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'I created hello.txt containing hi.' }]);
  expect(events.at(-1)).toEqual({
    type: 'result',
    usage: { inputTokens: 9876 - 5000, cachedInputTokens: 5000, outputTokens: 40 + 34 },
    costUsd: undefined,
    exitCode: 0,
    isError: false,
    text: 'I created hello.txt containing hi.',
  });
});

test('user messages echoed by the CLI are not emitted as text', () => {
  expect(parseGeminiLine({ type: 'message', role: 'user', content: 'hello' })).toEqual([]);
});

test('error events map to error, and an error-status result is isError', () => {
  expect(parseGeminiLine({ type: 'error', severity: 'error', message: 'quota exceeded' })).toEqual([
    { type: 'error', message: 'quota exceeded' },
  ]);
  const [r] = parseGeminiLine({ type: 'result', status: 'error', stats: {} });
  expect(r).toMatchObject({ type: 'result', isError: true, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } });
});

test('flat stats (older CLIs) are read when there is no models map', () => {
  const [r] = parseGeminiLine({
    type: 'result',
    status: 'success',
    stats: { input_tokens: 120, output_tokens: 30, cached: 20, total_tokens: 150 },
  });
  expect((r as Extract<AdapterEvent, { type: 'result' }>).usage).toEqual({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 });
});

test('parses the json vote fixture into text and a result with token usage', () => {
  const events = parseGeminiJson(fixtureJson('gemini-vote.json'));
  expect(events).toEqual([
    { type: 'text', text: 'pong' },
    {
      type: 'result',
      usage: { inputTokens: 1203 - 200, cachedInputTokens: 200, outputTokens: 1 + 26 },
      costUsd: undefined,
      exitCode: 0,
      isError: false,
      text: 'pong',
    },
  ]);
});

test('json output with an error object is an error result carrying the message', () => {
  const events = parseGeminiJson({ response: '', stats: {}, error: { type: 'ApiError', message: 'bad key', code: 401 } });
  expect(events.at(-1)).toMatchObject({ type: 'result', isError: true, text: 'bad key' });
});
