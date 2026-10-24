import type { Adapter, AdapterEvent, CliHealth, Provider, RunOptions } from '../../src/adapters/types.js';

export interface FakeScript {
  events: AdapterEvent[];
  /** Pause before each event; honours the run's abort signal. */
  delayMs?: number;
  /** Throw this message instead of yielding anything. */
  throwMessage?: string;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Scripted stand-in for a CLI adapter. Records every RunOptions it receives. */
export class FakeAdapter implements Adapter {
  calls: RunOptions[] = [];
  health: CliHealth = { installed: true, version: 'fake', authed: true };

  constructor(
    public readonly provider: Provider,
    private readonly script: FakeScript | ((opts: RunOptions) => FakeScript),
  ) {}

  async check(): Promise<CliHealth> {
    return this.health;
  }

  async *run(opts: RunOptions): AsyncGenerator<AdapterEvent> {
    this.calls.push(opts);
    const s = typeof this.script === 'function' ? this.script(opts) : this.script;
    if (s.throwMessage) throw new Error(s.throwMessage);
    for (const ev of s.events) {
      if (s.delayMs) await sleep(s.delayMs, opts.signal);
      if (opts.signal?.aborted) return;
      yield ev;
    }
  }
}

export function voteEvents(tier: string, confidence = 0.8, reason = 'because', costUsd: number | undefined = 0.001, model: string | null = null): AdapterEvent[] {
  const text = JSON.stringify(model ? { model, complexity: tier, confidence, reason } : { complexity: tier, confidence, reason });
  return [
    { type: 'text', text },
    { type: 'result', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }, costUsd, exitCode: 0, isError: false, text },
  ];
}

export function workEvents(sessionId = 'sess-1', text = 'done', costUsd = 0.01): AdapterEvent[] {
  return [
    { type: 'session', id: sessionId },
    { type: 'text', text },
    { type: 'tool', id: 't1', name: 'Write', input: { file_path: 'a.txt' } },
    { type: 'tool_result', id: 't1', output: 'ok' },
    { type: 'result', usage: { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 200 }, costUsd, exitCode: 0, isError: false, text },
  ];
}

export function failEvents(sessionId = 'sess-x', message = 'worker exploded'): AdapterEvent[] {
  return [
    { type: 'session', id: sessionId },
    { type: 'result', usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 }, costUsd: 0.001, exitCode: 1, isError: true, text: message },
  ];
}

export function registry(claude: Adapter, codex: Adapter, gemini: Adapter): Record<Provider, Adapter> {
  return { claude, codex, gemini };
}
