import type { JsonObject } from './jsonl.js';
import { spawnCli } from './spawn.js';
import { ZERO_USAGE, type AdapterEvent, type CliSpec, type ResultEvent } from './types.js';

export interface RunCliOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

/**
 * Runs a CLI spec, parses each JSON line with `parse`, and yields the events.
 * The CLI's own `result` event is held back until the process exits so the real
 * exit code can be attached; when the CLI never emits one, a result is synthesized
 * from the exit code and the stderr tail.
 */
export async function* runCli(
  spec: CliSpec,
  opts: RunCliOptions,
  parse: (obj: JsonObject) => AdapterEvent[],
): AsyncGenerator<AdapterEvent> {
  const child = spawnCli(spec.cmd, spec.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: spec.stdin,
    signal: opts.signal,
  });

  let result: ResultEvent | undefined;
  for await (const obj of child.lines) {
    for (const ev of parse(obj)) {
      if (ev.type === 'result') {
        result = ev;
      } else {
        yield ev;
      }
    }
  }

  const exitCode = await child.exit;
  if (result) {
    yield { ...result, exitCode, isError: result.isError || exitCode !== 0 };
  } else {
    yield synthesizedResult(exitCode, exitCode !== 0, child.stderr());
  }
}

function synthesizedResult(exitCode: number, isError: boolean, detail: string): ResultEvent {
  const text = detail.trim();
  return { type: 'result', usage: ZERO_USAGE, exitCode, isError, text: text === '' ? undefined : text };
}

/**
 * Runs a CLI that prints a single JSON object (possibly pretty-printed over many
 * lines), parses it once after exit, and yields the parsed events with the exit
 * code attached. Unparseable output becomes an error result carrying stderr and
 * the start of stdout.
 */
export async function* runCliJson(
  spec: CliSpec,
  opts: RunCliOptions,
  parse: (obj: JsonObject) => AdapterEvent[],
): AsyncGenerator<AdapterEvent> {
  const child = spawnCli(spec.cmd, spec.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: spec.stdin,
    signal: opts.signal,
    captureStdout: true,
  });
  for await (const _ of child.lines) {
    /* drain; the object is parsed whole after exit */
  }
  const exitCode = await child.exit;
  const raw = child.stdout().trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    let sawResult = false;
    for (const ev of parse(parsed as JsonObject)) {
      if (ev.type === 'result') {
        sawResult = true;
        yield { ...ev, exitCode, isError: ev.isError || exitCode !== 0 };
      } else {
        yield ev;
      }
    }
    if (!sawResult) yield synthesizedResult(exitCode, exitCode !== 0, child.stderr());
    return;
  }

  const detail = [child.stderr().trim(), raw.slice(0, 2000)].filter((s) => s !== '').join('\n');
  yield synthesizedResult(exitCode, true, detail);
}
