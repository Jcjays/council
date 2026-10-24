import type { Adapter, AdapterEvent, Provider, ProviderPlan, QuotaWindow, ResultEvent, Tier } from '../adapters/types.js';
import { costFor, type PriceTable } from '../ledger/pricing.js';
import type { Rung } from './ladder.js';
import { buildVotePrompt } from './prompt.js';
import { pickRung, tally, type RungPick } from './tally.js';
import { extractVote, voteSchema, type Vote } from './vote.js';

export interface Seat {
  provider: Provider;
  model: string | null;
}

export interface SeatResult {
  seat: Seat;
  vote: Vote | null;
  costUsd: number;
  durationMs: number;
  error?: string;
  overCeiling: boolean;
  /** What the seat said, for the vote card. */
  text?: string;
}

/** The rung the council settled on, with the worker it names. */
export type CouncilPick = RungPick & { provider: Provider; model: string };

export interface CouncilResult {
  seats: SeatResult[];
  /** The complexity verdict (majority of the seats' complexity ratings). */
  decision: Tier;
  tie: boolean;
  counts: Record<Tier, number>;
  /** The chosen model, or null when no seat voted or the ladder is empty. */
  pick: CouncilPick | null;
}

export interface CouncilArgs {
  seats: Seat[];
  /** The models the seats may choose from, cheapest first. */
  ladder: Rung[];
  adapters: Record<Provider, Adapter>;
  task: string;
  cwd: string;
  snapshot: string;
  /** Called for every seat's result event, with the cost filled in. The ledger hook. */
  onResult: (provider: Provider, model: string | null, ev: ResultEvent) => Promise<void> | void;
  /** Called when a seat's CLI reports the account's usage windows. */
  onQuota?: (provider: Provider, windows: QuotaWindow[]) => void;
  /** How the seat's CLI is paid for, when its stream says. */
  onAccount?: (provider: Provider, plan: ProviderPlan) => void;
  pricing: PriceTable;
  timeoutMs?: number;
  costCeiling?: number;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_SEAT_TIMEOUT_MS = 60_000;
export const DEFAULT_VOTE_COST_CEILING = 0.05;

/** Yields from `it` until it ends or `signal` aborts, whichever comes first. */
async function* untilAbort<T>(it: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = it[Symbol.asyncIterator]();
  const aborted = new Promise<IteratorResult<T>>((resolve) => {
    const done = () => resolve({ done: true, value: undefined as never });
    if (signal.aborted) done();
    else signal.addEventListener('abort', done, { once: true });
  });
  for (;;) {
    const next = await Promise.race([iterator.next(), aborted]);
    if (next.done) {
      if (signal.aborted) void iterator.return?.();
      return;
    }
    yield next.value;
  }
}

async function runSeat(seat: Seat, a: CouncilArgs, prompt: string, modelIds: string[]): Promise<SeatResult> {
  const timeoutMs = a.timeoutMs ?? DEFAULT_SEAT_TIMEOUT_MS;
  const ceiling = a.costCeiling ?? DEFAULT_VOTE_COST_CEILING;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let streamed = '';
  let costUsd = 0;
  let error: string | undefined;
  let result: ResultEvent | undefined;

  try {
    const events: AsyncIterable<AdapterEvent> = a.adapters[seat.provider].run({
      cwd: a.cwd,
      prompt,
      model: seat.model,
      purpose: 'vote',
      fullAuto: false,
      signal: ac.signal,
      jsonSchema: voteSchema(modelIds),
      env: a.env,
    });
    for await (const ev of untilAbort(events, ac.signal)) {
      if (ev.type === 'text') streamed += ev.text;
      else if (ev.type === 'quota') a.onQuota?.(seat.provider, ev.windows);
      else if (ev.type === 'account') a.onAccount?.(seat.provider, ev.plan);
      else if (ev.type === 'error') error = ev.message;
      else if (ev.type === 'result') {
        costUsd = ev.costUsd ?? costFor(seat.provider, seat.model, ev.usage, a.pricing);
        result = { ...ev, costUsd };
        await a.onResult(seat.provider, seat.model, result);
      }
    }
    if (ac.signal.aborted) error = `timed out after ${timeoutMs} ms`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  const text = (result?.text ?? streamed).trim();
  const failed = result?.isError === true;
  const vote = failed || text === '' ? null : extractVote(text, modelIds);
  if (!vote && !error) error = failed ? text || 'seat failed' : 'no vote in output';

  return {
    seat,
    vote,
    costUsd,
    durationMs: Date.now() - started,
    error,
    overCeiling: costUsd > ceiling,
    text: text === '' ? undefined : text,
  };
}

/** Runs every seat in parallel on the same prompt, tallies the complexity verdicts and settles on a rung. */
export async function runCouncil(a: CouncilArgs): Promise<CouncilResult> {
  const prompt = buildVotePrompt(a.task, a.snapshot, a.ladder);
  const modelIds = a.ladder.map((r) => r.model);
  const seats = await Promise.all(a.seats.map((seat) => runSeat(seat, a, prompt, modelIds)));
  const votes = seats.flatMap((s) => (s.vote ? [s.vote] : []));
  const t = tally(votes.map((v) => v.tier));
  const picked = pickRung(votes, a.ladder);
  const rung = picked ? a.ladder[picked.index] : undefined;
  const pick: CouncilPick | null = picked && rung ? { ...picked, provider: rung.provider, model: rung.model } : null;
  return { seats, decision: t.decision, tie: t.tie, counts: t.counts, pick };
}
