import { EventEmitter } from 'node:events';
import { PROVIDERS, TIER_ORDER, type Adapter, type CliHealth, type Provider, type ResultEvent, type Tier } from '../adapters/types.js';
import { effectiveSettings, type Settings } from '../config/settings.js';
import { runCouncil, type Seat } from '../council/council.js';
import { route } from '../council/routing.js';
import { repoSnapshot } from '../council/snapshot.js';
import { budgetState, type BudgetState } from '../ledger/budget.js';
import { appendEntry, currentPeriod, readEntries, sumPeriod } from '../ledger/ledger.js';
import { costFor, lookupPrice, type PriceTable } from '../ledger/pricing.js';
import { diffStat as gitDiffStat } from '../worktrees/git.js';
import { clipText, clipValue } from './clip.js';
import { buildHandoffPrompt, buildSummaryPrompt, mechanicalSummary } from './handoff.js';
import { canEscalate, transition, type TabStatus } from './state.js';
import { newId, newTab, type TabStore } from './store.js';
import type { Tab, TabWorker, TranscriptItem, TranscriptKind } from './types.js';

export interface EngineDeps {
  adapters: Record<Provider, Adapter>;
  /** Uncommitted-change summary of a checkout, for hand-off prompts. Defaults to git. */
  diffStat?: (projectRoot: string) => Promise<string>;
  store: TabStore;
  ledgerFile: string;
  settings: () => Settings;
  pricing: () => PriceTable;
  /** Latest CLI health; providers reported as not installed are routed around. */
  health?: () => Partial<Record<Provider, CliHealth>>;
  snapshot?: (cwd: string) => Promise<string>;
  now?: () => Date;
}

export type SubmitMode = { kind: 'auto' } | { kind: 'manual'; provider: Provider; model: string | null };

export interface WorkerPick {
  provider: Provider;
  model: string | null;
}

interface ActiveRun {
  ac: AbortController;
  stallTimer?: NodeJS.Timeout;
  /** Resolves once the worker loop has fully unwound. */
  done: Promise<void>;
  finish: () => void;
}

const SAVE_DEBOUNCE_MS = 300;
const CLOSE_WAIT_MS = 5_000;

function label(w: WorkerPick): string {
  return `${w.provider} (${w.model ?? 'default'})`;
}

/** Read through a function so TypeScript does not keep a stale narrowing across awaits. */
function isClosed(tab: Tab): boolean {
  return tab.status === 'closed';
}

/**
 * Owns every tab: council votes, worker runs, escalation and switching, and
 * close. Workers run directly in the project checkout and never commit; the
 * developer reviews the result in their editor or git. Emits `tab` (full tab
 * after each change), `item` ({tabId, item}), `stall` ({tabId}),
 * `ledger` ({tabId, provider, costUsd}) and `engine-error`.
 */
export class TaskEngine extends EventEmitter {
  private readonly tabs = new Map<string, Tab>();
  private readonly runs = new Map<string, ActiveRun>();
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => Date;

  constructor(private readonly deps: EngineDeps) {
    super();
    this.now = deps.now ?? (() => new Date());
  }

  // ---- queries -------------------------------------------------------------

  getTab(id: string): Tab | undefined {
    return this.tabs.get(id);
  }

  projectIdFor(projectRoot: string): string {
    return this.deps.store.projectId(projectRoot);
  }

  listTabs(projectId?: string): Tab[] {
    return [...this.tabs.values()]
      .filter((t) => !projectId || t.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Loads a project's saved tabs. Tabs left mid-run by a previous server are marked failed. */
  async loadProject(projectRoot: string): Promise<Tab[]> {
    const projectId = this.deps.store.projectId(projectRoot);
    for (const tab of await this.deps.store.list(projectId)) {
      if (this.tabs.has(tab.id)) continue;
      if (tab.status === 'running' || tab.status === 'voting' || tab.status === 'handing-off') {
        tab.status = 'failed';
        this.addItem(tab, 'system', 'Council was restarted while this tab was running; the worker process is gone.');
        await this.deps.store.save(tab);
      }
      this.tabs.set(tab.id, tab);
    }
    return this.listTabs(projectId);
  }

  async budgets(): Promise<Record<Provider, BudgetState>> {
    const s = this.deps.settings();
    const entries = await readEntries(this.deps.ledgerFile);
    const { start, end } = currentPeriod(this.now(), s.resetDay);
    const sums = sumPeriod(entries, start, end);
    return Object.fromEntries(PROVIDERS.map((p) => [p, budgetState(p, sums[p], s.budgets[p] ?? 0, s.warnPct)])) as Record<
      Provider,
      BudgetState
    >;
  }

  // ---- commands ------------------------------------------------------------

  async createTab(projectRoot: string, title: string): Promise<Tab> {
    const tab = newTab(this.deps.store, projectRoot, title);
    this.tabs.set(tab.id, tab);
    await this.touch(tab);
    return tab;
  }

  async submit(tabId: string, text: string, mode: SubmitMode, opts: { fullAuto?: boolean } = {}): Promise<Tab> {
    const tab = this.must(tabId);
    this.require(tab, ['drafting']);
    if (tab.title.trim() === '') tab.title = (text.split('\n')[0] ?? '').slice(0, 60) || 'task';
    if (opts.fullAuto !== undefined) tab.fullAuto = opts.fullAuto;
    this.addItem(tab, 'user', text);

    if (mode.kind === 'manual') {
      tab.worker = { provider: mode.provider, model: mode.model, sessionId: null };
      tab.tier = this.tierFor(tab, mode.provider) ?? 'medium';
      tab.status = transition(tab.status, 'submit-manual');
      await this.touch(tab);
      this.spawn(tab, () => this.runWorker(tab, text));
      return tab;
    }

    tab.status = transition(tab.status, 'submit-auto');
    await this.touch(tab);
    this.spawn(tab, () => this.runVote(tab, text));
    return tab;
  }

  async start(tabId: string, override?: WorkerPick): Promise<Tab> {
    const tab = this.must(tabId);
    this.require(tab, ['awaiting-start']);
    if (override) {
      tab.worker = { provider: override.provider, model: override.model, sessionId: null };
      tab.tier = this.tierFor(tab, override.provider) ?? tab.tier;
      this.addItem(tab, 'system', `Developer chose ${label(override)} instead of the council's pick.`);
    }
    tab.status = transition(tab.status, 'start');
    await this.touch(tab);
    const task = this.taskText(tab);
    this.spawn(tab, () => this.runWorker(tab, task));
    return tab;
  }

  async send(tabId: string, text: string): Promise<Tab> {
    const tab = this.must(tabId);
    this.require(tab, ['idle', 'failed']);
    this.addItem(tab, 'user', text);
    tab.status = transition(tab.status, 'message');
    await this.touch(tab);
    this.spawn(tab, () => this.runWorker(tab, text));
    return tab;
  }

  async escalate(tabId: string): Promise<Tab> {
    const tab = this.must(tabId);
    this.require(tab, ['idle', 'failed']);
    if (!tab.tier || !canEscalate(tab.tier)) throw new Error('this tab is already at the top tier');
    const from = await this.prepareHandoff(tab, 'escalate');
    this.spawn(tab, () => this.finishHandoff(tab, from, 'escalate'));
    return tab;
  }

  async switchWorker(tabId: string, provider: Provider, model: string | null): Promise<Tab> {
    const tab = this.must(tabId);
    this.require(tab, ['idle', 'failed']);
    if (tab.worker && tab.worker.provider === provider) {
      tab.worker = { ...tab.worker, model };
      this.addItem(tab, 'system', `Model changed to ${model ?? 'the CLI default'}; the next message uses it on the same session.`);
      await this.touch(tab);
      return tab;
    }
    const from = await this.prepareHandoff(tab, 'switch', { provider, model });
    this.spawn(tab, () => this.finishHandoff(tab, from, 'switch'));
    return tab;
  }

  /** Stops any running worker and closes the tab. Whatever the worker changed stays in the checkout. */
  async close(tabId: string): Promise<Tab> {
    const tab = this.must(tabId);
    const run = this.runs.get(tab.id);
    run?.ac.abort();
    tab.status = transition(tab.status, 'close');
    await this.touch(tab);
    if (run) await Promise.race([run.done, new Promise<void>((r) => setTimeout(r, CLOSE_WAIT_MS))]);
    return tab;
  }

  // ---- internals -----------------------------------------------------------

  private must(tabId: string): Tab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`unknown tab ${tabId}`);
    return tab;
  }

  private require(tab: Tab, statuses: TabStatus[]): void {
    if (!statuses.includes(tab.status)) {
      throw new Error(`tab is ${tab.status}; this action needs ${statuses.join(' or ')}`);
    }
  }

  private settingsFor(tab: Tab): Settings {
    return effectiveSettings(this.deps.settings(), tab.projectId);
  }

  /** Providers whose CLI is missing or not signed in; routing treats them like an exhausted budget. */
  private unavailable(): Provider[] {
    const health = this.deps.health?.() ?? {};
    return PROVIDERS.filter((p) => {
      const h = health[p];
      return h !== undefined && (h.installed === false || h.authed === false);
    });
  }

  private tierFor(tab: Tab, provider: Provider): Tier | null {
    const map = this.settingsFor(tab).tierMap;
    return TIER_ORDER.find((t) => map[t].provider === provider) ?? null;
  }

  private taskText(tab: Tab): string {
    return tab.transcript.find((i) => i.kind === 'user')?.text ?? tab.title;
  }

  private spawn(tab: Tab, fn: () => Promise<void>): void {
    fn().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('engine-error', { tabId: tab.id, error: err });
      this.addItem(tab, 'error', message);
      if (tab.status === 'running' || tab.status === 'voting' || tab.status === 'handing-off') tab.status = 'failed';
      void this.touch(tab);
    });
  }

  private addItem(tab: Tab, kind: TranscriptKind, text?: string, data?: unknown, tool?: TranscriptItem['tool']): TranscriptItem {
    const item: TranscriptItem = { id: newId(), ts: this.now().toISOString(), kind };
    if (text !== undefined) item.text = text;
    if (data !== undefined) item.data = data;
    if (tool !== undefined) item.tool = tool;
    tab.transcript.push(item);
    this.emit('item', { tabId: tab.id, item });
    return item;
  }

  /** Persists and announces the whole tab. Used for status and metadata changes, not for every streamed chunk. */
  private async touch(tab: Tab): Promise<void> {
    const pending = this.saveTimers.get(tab.id);
    if (pending) {
      clearTimeout(pending);
      this.saveTimers.delete(tab.id);
    }
    tab.updatedAt = this.now().toISOString();
    await this.deps.store.save(tab);
    this.emit('tab', structuredClone(tab));
  }

  /** Debounced save while a worker streams; the stream itself reaches clients as `item` events. */
  private persistSoon(tab: Tab): void {
    if (this.saveTimers.has(tab.id)) return;
    this.saveTimers.set(
      tab.id,
      setTimeout(() => {
        this.saveTimers.delete(tab.id);
        tab.updatedAt = this.now().toISOString();
        this.deps.store.save(tab).catch((err: unknown) => this.emit('engine-error', { tabId: tab.id, error: err }));
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private async record(tab: Tab, provider: Provider, model: string | null, purpose: 'vote' | 'work' | 'summarize', ev: ResultEvent): Promise<number> {
    const costUsd = ev.costUsd ?? costFor(provider, model, ev.usage, this.deps.pricing());
    await appendEntry(this.deps.ledgerFile, {
      ts: this.now().toISOString(),
      provider,
      model,
      purpose,
      tabId: tab.id,
      projectId: tab.projectId,
      usage: ev.usage,
      costUsd,
    });
    tab.costUsd += costUsd;
    this.emit('ledger', { tabId: tab.id, provider, costUsd });
    return costUsd;
  }

  private async runVote(tab: Tab, task: string): Promise<void> {
    const s = this.settingsFor(tab);
    const cwd = tab.projectRoot;
    const snapshot = await (this.deps.snapshot ?? repoSnapshot)(cwd);
    const result = await runCouncil({
      seats: s.seats,
      adapters: this.deps.adapters,
      task,
      cwd,
      snapshot,
      pricing: this.deps.pricing(),
      timeoutMs: s.seatTimeoutMs,
      costCeiling: s.voteCostCeiling,
      onResult: async (provider, model, ev) => {
        await this.record(tab, provider, model, 'vote', ev);
      },
    });
    if (isClosed(tab)) return;

    tab.vote = result;
    const decision = route(result.decision, s.tierMap, await this.budgets(), this.unavailable());
    tab.tier = decision.tier;
    tab.routing = { shiftedFrom: decision.shiftedFrom, reason: decision.reason };
    tab.worker = { provider: decision.provider, model: decision.model, sessionId: null };
    this.addItem(tab, 'vote', undefined, { council: result, routing: decision });

    if (s.autoStart) {
      tab.status = transition(tab.status, 'vote-done-autostart');
      await this.touch(tab);
      await this.runWorker(tab, task);
    } else {
      tab.status = transition(tab.status, 'vote-done');
      await this.touch(tab);
    }
  }

  private async runWorker(tab: Tab, prompt: string): Promise<void> {
    if (isClosed(tab)) return;
    const s = this.settingsFor(tab);
    const worker = tab.worker;
    if (!worker) throw new Error('no worker assigned');
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run: ActiveRun = { ac: new AbortController(), done, finish };
    this.runs.set(tab.id, run);
    const stallMs = Math.max(10, s.stallMinutes * 60_000);
    const armStall = () => {
      if (run.stallTimer) clearTimeout(run.stallTimer);
      run.stallTimer = setTimeout(() => {
        if (tab.status === 'running' && !tab.stalled) {
          tab.stalled = true;
          this.emit('stall', { tabId: tab.id });
          void this.touch(tab);
        }
      }, stallMs);
    };

    let result: ResultEvent | undefined;
    let threw: string | undefined;
    armStall();
    try {
      const events = this.deps.adapters[worker.provider].run({
        cwd: tab.projectRoot,
        prompt,
        model: worker.model,
        purpose: 'work',
        resumeId: worker.sessionId ?? undefined,
        fullAuto: tab.fullAuto,
        allowedCommands: s.allowedCommands,
        signal: run.ac.signal,
      });
      for await (const ev of events) {
        if (isClosed(tab)) break;
        tab.stalled = false;
        armStall();
        switch (ev.type) {
          case 'session':
            worker.sessionId = ev.id;
            await this.touch(tab);
            break;
          case 'text':
            this.addItem(tab, 'assistant', ev.text);
            this.persistSoon(tab);
            break;
          case 'tool':
            this.addItem(tab, 'tool', undefined, undefined, { id: ev.id, name: ev.name, input: clipValue(ev.input) });
            this.persistSoon(tab);
            break;
          case 'tool_result': {
            const output = clipText(ev.output);
            const call = ev.id ? [...tab.transcript].reverse().find((i) => i.kind === 'tool' && i.tool?.id === ev.id) : undefined;
            if (call?.tool) {
              call.tool.output = output;
              call.tool.isError = ev.isError;
              this.emit('item', { tabId: tab.id, item: call });
            } else {
              this.addItem(tab, 'tool', undefined, undefined, { name: 'result', input: null, output, isError: ev.isError });
            }
            this.persistSoon(tab);
            break;
          }
          case 'error':
            this.addItem(tab, 'error', ev.message);
            this.persistSoon(tab);
            break;
          case 'result': {
            result = ev;
            const costUsd = await this.record(tab, worker.provider, worker.model, 'work', ev);
            this.addItem(tab, 'result', ev.text, { usage: ev.usage, costUsd, exitCode: ev.exitCode, isError: ev.isError });
            await this.touch(tab);
            break;
          }
        }
      }
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    } finally {
      if (run.stallTimer) clearTimeout(run.stallTimer);
      this.runs.delete(tab.id);
      run.finish();
    }

    if (isClosed(tab)) return;
    tab.stalled = false;
    if (threw !== undefined) this.addItem(tab, 'error', threw);
    const failed = threw !== undefined || !result || result.isError;

    if (!failed) {
      tab.status = transition(tab.status, 'worker-done');
      await this.touch(tab);
      return;
    }

    tab.status = transition(tab.status, 'worker-failed');
    if (s.autoEscalate && tab.escalations === 0 && tab.tier && canEscalate(tab.tier)) {
      // Go straight to handing-off; prepareHandoff announces the new state.
      const from = await this.prepareHandoff(tab, 'escalate');
      await this.finishHandoff(tab, from, 'escalate');
      return;
    }
    await this.touch(tab);
  }

  /** Moves the tab to handing-off and assigns the next worker. Returns the worker being replaced. */
  private async prepareHandoff(tab: Tab, reason: 'escalate' | 'switch', target?: WorkerPick): Promise<TabWorker> {
    const s = this.settingsFor(tab);
    const from = tab.worker ?? { provider: 'gemini', model: null, sessionId: null };
    let next: TabWorker;

    if (reason === 'escalate') {
      const idx = TIER_ORDER.indexOf(tab.tier ?? 'easy');
      const nextTier = TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)] as Tier;
      const r = route(nextTier, s.tierMap, await this.budgets(), this.unavailable());
      tab.tier = r.tier;
      tab.routing = { shiftedFrom: r.shiftedFrom, reason: r.reason };
      tab.escalations += 1;
      next = { provider: r.provider, model: r.model, sessionId: null };
    } else {
      if (!target) throw new Error('switch needs a target worker');
      tab.tier = this.tierFor(tab, target.provider) ?? tab.tier;
      next = { provider: target.provider, model: target.model, sessionId: null };
    }

    const previous = tab.previousWorkers.find((w) => w.provider === next.provider && w.sessionId);
    if (previous) next.sessionId = previous.sessionId;

    tab.status = transition(tab.status, reason);
    tab.previousWorkers.push(from);
    tab.worker = next;
    this.addItem(
      tab,
      'system',
      reason === 'escalate'
        ? `Escalated from ${label(from)} to ${label(next)} (${tab.tier}).`
        : `Switched from ${label(from)} to ${label(next)}${next.sessionId ? ', resuming its earlier session' : ''}.`,
    );
    await this.touch(tab);
    return from;
  }

  private async finishHandoff(tab: Tab, from: TabWorker, reason: 'escalate' | 'switch'): Promise<void> {
    const summary = await this.summarize(tab);
    let diffStat = '';
    try {
      diffStat = await (this.deps.diffStat ?? gitDiffStat)(tab.projectRoot);
    } catch {
      /* no diff available */
    }
    if (isClosed(tab)) return;
    const prompt = buildHandoffPrompt({ task: this.taskText(tab), summary, diffStat, fromWorker: label(from), reason });
    tab.status = transition(tab.status, 'handoff-ready');
    await this.touch(tab);
    await this.runWorker(tab, prompt);
  }

  private cheapestSeat(seats: Seat[]): Seat | undefined {
    const pricing = this.deps.pricing();
    const nominal = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 200_000 };
    const priced = seats
      .filter((s) => lookupPrice(s.provider, s.model, pricing) !== undefined)
      .sort((a, b) => costFor(a.provider, a.model, nominal, pricing) - costFor(b.provider, b.model, nominal, pricing));
    return priced[0] ?? seats[0];
  }

  private async summarize(tab: Tab): Promise<string> {
    const s = this.settingsFor(tab);
    const seat = this.cheapestSeat(s.seats.filter((seat) => !this.unavailable().includes(seat.provider)));
    if (!seat) return mechanicalSummary(tab.transcript);
    try {
      let text = '';
      const events = this.deps.adapters[seat.provider].run({
        cwd: tab.projectRoot,
        prompt: buildSummaryPrompt(tab.transcript),
        model: seat.model,
        purpose: 'summarize',
        fullAuto: false,
        allowedCommands: [],
        signal: AbortSignal.timeout(s.seatTimeoutMs),
      });
      for await (const ev of events) {
        if (ev.type === 'text') text += ev.text;
        if (ev.type === 'result') {
          await this.record(tab, seat.provider, seat.model, 'summarize', ev);
          if (ev.isError) return mechanicalSummary(tab.transcript);
          if (text === '' && ev.text) text = ev.text;
        }
      }
      return text.trim() === '' ? mechanicalSummary(tab.transcript) : text.trim();
    } catch {
      return mechanicalSummary(tab.transcript);
    }
  }
}
