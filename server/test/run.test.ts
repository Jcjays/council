import { expect, test } from 'vitest';
import type { JsonObject } from '../src/adapters/jsonl.js';
import { runCli } from '../src/adapters/run.js';
import { ZERO_USAGE, type AdapterEvent } from '../src/adapters/types.js';
import { collect } from './helpers/fixtures.js';

const cwd = process.cwd();
const node = process.execPath;

const parse = (o: JsonObject): AdapterEvent[] => {
  if (o.type === 'text') return [{ type: 'text', text: String(o.text) }];
  if (o.type === 'result') return [{ type: 'result', usage: ZERO_USAGE, exitCode: 0, isError: false, text: 'done' }];
  return [];
};

test('runCli streams parsed events and attaches the real exit code to the result', async () => {
  const script = 'console.log(JSON.stringify({type:"text",text:"hi"}));console.log(JSON.stringify({type:"result"}));process.exit(0)';
  const events = await collect(runCli({ cmd: node, args: ['-e', script], stdin: '' }, { cwd }, parse));
  expect(events).toEqual([
    { type: 'text', text: 'hi' },
    { type: 'result', usage: ZERO_USAGE, exitCode: 0, isError: false, text: 'done' },
  ]);
});

test('runCli synthesizes an error result when the CLI exits without one', async () => {
  const script = 'console.error("boom");process.exit(1)';
  const events = await collect(runCli({ cmd: node, args: ['-e', script] }, { cwd }, parse));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'result', exitCode: 1, isError: true, usage: ZERO_USAGE });
  expect((events[0] as Extract<AdapterEvent, { type: 'result' }>).text).toContain('boom');
});

test('runCli passes stdin from the spec to the child', async () => {
  const script = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.stringify({type:"text",text:s}));console.log(JSON.stringify({type:"result"}))})';
  const events = await collect(runCli({ cmd: node, args: ['-e', script], stdin: 'the prompt' }, { cwd }, parse));
  expect(events[0]).toEqual({ type: 'text', text: 'the prompt' });
});

test('runCli marks the result as error when the CLI exits non-zero after a success result', async () => {
  const script = 'console.log(JSON.stringify({type:"result"}));process.exit(3)';
  const events = await collect(runCli({ cmd: node, args: ['-e', script] }, { cwd }, parse));
  expect(events.at(-1)).toMatchObject({ type: 'result', exitCode: 3, isError: true });
});
