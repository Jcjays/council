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
    const stderr = child.stderr().trim();
    yield {
      type: 'result',
      usage: ZERO_USAGE,
      exitCode,
      isError: exitCode !== 0,
      text: stderr === '' ? undefined : stderr,
    };
  }
}
