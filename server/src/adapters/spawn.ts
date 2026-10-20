import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { JsonLineBuffer, type JsonObject } from './jsonl.js';

export interface SpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin, then stdin is closed. Stdin is closed immediately when omitted. */
  stdin?: string;
  signal?: AbortSignal;
  /** Keep the raw stdout text (for CLIs that print one multi-line JSON object). */
  captureStdout?: boolean;
}

export interface SpawnedCli {
  /** Every JSON object line the child prints on stdout, in order. */
  lines: AsyncIterable<JsonObject>;
  /** Raw stdout text; empty unless `captureStdout` was set. */
  stdout: () => string;
  /** Exit code; -1 when the child was killed by a signal or failed to start. */
  exit: Promise<number>;
  /** Last 8 KB of stderr, for diagnostics. */
  stderr: () => string;
  pid: number | undefined;
}

const STDERR_KEEP = 8 * 1024;

/**
 * On Windows, npm-installed CLIs are `.cmd` shims. Returns the shim path when one
 * is on PATH so the caller can run it; otherwise the bare name.
 */
export function resolveCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return name;
  if (path.isAbsolute(name) || /\.(cmd|bat|exe)$/i.test(name)) return name;
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

/**
 * npm's `.cmd` shim ends in `"%_prog%" "%dp0%\node_modules\<pkg>\bin.js" %*`.
 * Returns that JS entry, resolved against the shim's directory, or null.
 */
export function shimTarget(cmdPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(cmdPath, 'utf8');
  } catch {
    return null;
  }
  const match = /"%dp0%\\?([^"]+\.(?:js|mjs|cjs))"/i.exec(text);
  if (!match || !match[1]) return null;
  return path.join(path.dirname(cmdPath), match[1]);
}

function prepare(cmd: string, args: string[]): { file: string; argv: string[] } {
  if (/\.cmd$/i.test(cmd)) {
    const target = shimTarget(cmd);
    if (target) return { file: process.execPath, argv: [target, ...args] };
  }
  return { file: cmd, argv: args };
}

export function spawnCli(cmd: string, args: string[], opts: SpawnOptions): SpawnedCli {
  const { file, argv } = prepare(cmd, args);
  const child = spawn(file, argv, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderrBuf = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf = (stderrBuf + chunk).slice(-STDERR_KEEP);
  });

  const exit = new Promise<number>((resolve) => {
    let settled = false;
    child.on('error', (err) => {
      stderrBuf = (stderrBuf + String(err)).slice(-STDERR_KEEP);
      if (!settled) {
        settled = true;
        resolve(-1);
      }
    });
    child.on('close', (code, signal) => {
      if (!settled) {
        settled = true;
        resolve(code ?? (signal ? -1 : 1));
      }
    });
  });

  if (opts.signal) {
    const kill = () => {
      if (child.exitCode === null && !child.killed) child.kill();
    };
    if (opts.signal.aborted) kill();
    else opts.signal.addEventListener('abort', kill, { once: true });
  }

  child.stdin.on('error', () => {
    /* child exited before reading stdin; nothing to do */
  });
  child.stdin.end(opts.stdin ?? '');

  let rawStdout = '';
  const lines = (async function* () {
    const buffer = new JsonLineBuffer();
    child.stdout.setEncoding('utf8');
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      if (opts.captureStdout) rawStdout += chunk;
      for (const obj of buffer.push(chunk)) yield obj;
    }
    for (const obj of buffer.flush()) yield obj;
  })();

  return { lines, exit, stderr: () => stderrBuf, stdout: () => rawStdout, pid: child.pid };
}
