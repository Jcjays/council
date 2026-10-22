import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PROVIDERS, TIER_ORDER, type Adapter, type CliHealth, type Provider, type ProviderPlan, type QuotaWindow, type ResultEvent, type Tier } from '../adapters/types.js';
import { effectiveSettings, type PermissionMode, type Settings } from '../config/settings.js';
import { runCouncil, type Seat } from '../council/council.js';
import { effectiveRouting, type EffectiveRouting } from '../council/effective.js';
import { route } from '../council/routing.js';
import { repoSnapshot } from '../council/snapshot.js';
import { budgetState, type BudgetState, type ProviderUsage } from '../ledger/budget.js';
import { appendEntry, currentPeriod, readEntries, sumPeriod } from '../ledger/ledger.js';
import { UsageStore } from '../ledger/usage.js';
import { costFor, lookupPrice, type PriceTable } from '../ledger/pricing.js';
import type { Decision } from '../mcp/permission-tool.js';
import { diffStat as gitDiffStat } from '../worktrees/git.js';
import { clipText, clipValue } from './clip.js';
import { buildHandoffPrompt, buildSummaryPrompt, mechanicalSummary } from './handoff.js';
import { describeRequest, permissionRule, ruleAllows } from './permissions.js';
import { canEscalate, transition, type TabStatus } from './state.js';
import { newId, newTab, type TabStore } from './store.js';
import type { PermissionItemData, PermissionStatus, Tab, TabWorker, TranscriptItem, TranscriptKind } from './types.js';

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
  /** Observed plans and usage windows; memory-only when omitted. */
  usage?: UsageStore;
  /** Base URL of this Council server, for the permission tool a Claude worker runs. Unset: Claude cannot ask and is limited to edits. */
  permissionUrl?: () => string | undefined;
  now?: () => Date;
}

/** CLIs whose runs report usage windows, so a probe can refresh them. */
const PROBED: Provider[] = ['claude', 'codex'];

export interface UsageRefresh {
  probed: Provider[];
  skipped: { provider: Provider; reason: string }[];
  budgets: Record<Provider, BudgetState>;
}

export type SubmitMode = { kind: 'auto' } | { kind: 'manual'; provider: Provider; model: string | null };

export interface WorkerPick {
  provider: Provider;
  model: string | null;
}

/** Allow once, allow for the rest of this tab, or deny. */
export type PermissionAnswer = 'allow-once' | 'allow-tab' | 'deny';

export interface PermissionAsk {
  tabId: string;
  token: string;
  toolName: string;
  input: unknown;
  toolUseId?: string;
}

export type PermissionReply = { id: string; status: 'pending' } | { id: string; status: 'answered'; decision: Decision };

/** Thrown for a permission call that does not belong to a running worker. */
export class PermissionRefused extends Error {}

interface PendingPermission {
  id: string;
  tabId: string;
  token: string;
  item: TranscriptItem;
  decision?: Decision;
  settled: Promise<void>;
  settle: () => void;
}

const DENIED_MESSAGE = 'The developer denied this in Council. Do not retry it; carry on without it, or say what you needed and why.';

interface ActiveRun {
  ac: AbortController;
  /** Proves a permission request comes from this run's tool. */
  token: string;
  /** Permission requests waiting for the developer; the stall timer is off while any are. */
  waiting: number;
  armStall: () => void;
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
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly observed: UsageStore;
  private readonly now: () => Date;

  constructor(private readonly deps: EngineDeps) {
    super();
    this.now = deps.now ?? (() => new Date());
    this.observed = deps.usage ?? new UsageStore();
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
    return Object.fromEntries(
      PROVIDERS.map((p) => {
        const plan = this.observed.plan(p) ?? this.deps.health?.()[p]?.plan;
        return [p, budgetState(p, sums[p], s.spendCaps[p] ?? 0, s.warnPct, { plan, usage: this.observed.usage(p), now: this.now() })];
      }),
    ) as Record<Provider, BudgetState>;
  }

  /** Latest plan-usage windows per provider, as their CLIs reported them. */
  usage(): Partial<Record<Provider, ProviderUsage>> {
    return Object.fromEntries(PROVIDERS.flatMap((p) => (this.observed.usage(p) ? [[p, this.observed.usage(p)]] : [])));
  }

  /** The council and tier map in force given which CLIs are set up. */
  routing(projectId?: string): EffectiveRouting {
    const s = projectId ? effectiveSettings(this.deps.settings(), projectId) : this.deps.settings();
    return effectiveRouting(s, this.availableProviders());
  }

  /**
   * Runs the cheapest possible request on each set-up CLI that reports usage
   * windows (Claude, Codex), to read the plan and fresh windows. Each costs a
   * fraction of a cent and is ledgered as `probe`.
   */
  async refreshUsage(): Promise<UsageRefresh> {
    const s = this.deps.settings();
    const available = this.availableProviders();
    const probed: Provider[] = [];
    const skipped: UsageRefresh['skipped'] = [];
    await Promise.all(
      PROVIDERS.map(async (p) => {
        if (!available.includes(p)) return void skipped.push({ provider: p, reason: 'not set up' });
        if (!PROBED.includes(p)) return void skipped.push({ provider: p, reason: 'Gemini CLI does not report usage windows' });
        const model = s.models[p]?.[0] ?? null;
        try {
          const events = this.deps.adapters[p].run({
            cwd: process.cwd(),
            prompt: 'Reply with the single word ok.',
            model,
            purpose: 'probe',
            fullAuto: false,
            signal: AbortSignal.timeout(s.seatTimeoutMs),
          });
          for await (const ev of events) {
            if (ev.type === 'quota') this.noteUsage(p, ev.windows);
            else if (ev.type === 'account') this.notePlan(p, ev.plan);
            else if (ev.type === 'result') {
              const costUsd = ev.costUsd ?? costFor(p, model, ev.usage, this.deps.pricing());
              await appendEntry(this.deps.ledgerFile, { ts: this.now().toISOString(), provider: p, model, purpose: 'probe', tabId: '', projectId: '', usage: ev.usage, costUsd });
              this.emit('ledger', { tabId: '', provider: p, costUsd });
            }
          }
          probed.push(p);
        } catch (err) {
          skipped.push({ provider: p, reason: err instanceof Error ? err.message : String(err) });
        }
      }),
    );
    const order = (a: { provider: Provider } | Provider, b: { provider: Provider } | Provider) =>
      PROVIDERS.indexOf(typeof a === 'string' ? a : a.provider) - PROVIDERS.indexOf(typeof b === 'string' ? b : b.provider);
    return { probed: probed.sort(order), skipped: skipped.sort(order), budgets: await this.budgets() };
  }

  private noteUsage(provider: Provider, windows: QuotaWindow[]): void {
    const usage: ProviderUsage = { windows, observedAt: this.now().toISOString() };
    this.observed.noteUsage(provider, usage);
    this.emit('quota', { provider, usage });
  }

  private notePlan(provider: Provider, plan: ProviderPlan): void {
    const known = this.observed.plan(provider);
    if (known && known.kind === plan.kind && known.label === plan.label && known.confirmed === plan.confirmed) return;
    this.observed.notePlan(provider, plan);
    this.emit('quota', { provider });
  }

  // ---- commands ------------------------------------------------------------

  async createTab(projectRoot: string, title: string): Promise<Tab> {
    const tab = newTab(this.deps.store, projectRoot, title);
    tab.fullAuto = effectiveSettings(this.deps.settings(), tab.projectId).permissionMode === 'auto';
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

  /** Ask mode or Auto for this tab. Auto also answers whatever is waiting; Ask takes effect from the next run. */
  async setPermissionMode(tabId: string, mode: PermissionMode): Promise<Tab> {
    const tab = this.must(tabId);
    if (tab.status === 'closed') throw new Error('tab is closed');
    const auto = mode === 'auto';
    if (tab.fullAuto !== auto) {
      tab.fullAuto = auto;
      const running = this.runs.has(tab.id);
      this.addItem(
        tab,
        'system',
        auto
          ? 'Permissions set to Auto: the worker no longer asks before running commands.'
          : `Permissions set to Ask me${running ? '; the worker running now keeps Auto until it finishes' : ''}.`,
      );
      if (auto) this.settlePending(tab, { behavior: 'allow' }, 'allowed');
    }
    await this.touch(tab);
    return tab;
  }

  /** A worker's permission tool asks whether a tool use may go ahead. Answered at once when Auto or a tab rule covers it. */
  askPermission(ask: PermissionAsk): PermissionReply {
    const tab = this.tabs.get(ask.tabId);
    const run = tab ? this.runs.get(tab.id) : undefined;
    if (!tab || !run) throw new PermissionRefused('no running worker for this tab');
    if (run.token !== ask.token) throw new PermissionRefused('wrong permission token for this run');
    const id = newId();
    if (tab.fullAuto || (tab.allowedTools ?? []).some((rule) => ruleAllows(rule, ask.toolName, ask.input))) {
      return { id, status: 'answered', decision: { behavior: 'allow' } };
    }
    const data: PermissionItemData = {
      id,
      toolName: ask.toolName,
      input: clipValue(ask.input),
      rule: permissionRule(ask.toolName, ask.input),
      ...describeRequest(ask.toolName, ask.input),
      status: 'pending',
    };
    const item = this.addItem(tab, 'permission', undefined, data);
    let settle: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.permissions.set(id, { id, tabId: tab.id, token: ask.token, item, settled, settle });
    run.waiting += 1;
    if (run.stallTimer) clearTimeout(run.stallTimer);
    this.emit('permission', { tabId: tab.id, item });
    this.persistSoon(tab);
    return { id, status: 'pending' };
  }

  /** Long-poll: the decision once the developer answers, or `pending` after `waitMs`. */
  async waitForPermission(id: string, token: string, waitMs: number): Promise<PermissionReply> {
    const p = this.permissions.get(id);
    if (!p) throw new PermissionRefused('unknown permission request');
    if (p.token !== token) throw new PermissionRefused('wrong permission token for this request');
    if (!p.decision) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([p.settled, new Promise<void>((r) => (timer = setTimeout(r, waitMs)))]);
      clearTimeout(timer);
    }
    return p.decision ? { id, status: 'answered', decision: p.decision } : { id, status: 'pending' };
  }

  /** The developer's answer from the approval card. */
  async answerPermission(id: string, answer: PermissionAnswer): Promise<Tab> {
    const p = this.permissions.get(id);
    if (!p) throw new Error('this request is no longer waiting; the worker has finished');
    if (p.decision) throw new Error('this request was already answered');
    const tab = this.must(p.tabId);
    const data = p.item.data as PermissionItemData;
    if (answer === 'allow-tab') {
      tab.allowedTools = [...new Set([...(tab.allowedTools ?? []), data.rule])];
    }
    const decision: Decision = answer === 'deny' ? { behavior: 'deny', message: DENIED_MESSAGE } : { behavior: 'allow' };
    this.resolvePermission(tab, p, decision, answer === 'deny' ? 'denied' : answer === 'allow-tab' ? 'allowed-tab' : 'allowed');
    await this.touch(tab);
    return tab;
  }

  /** Stops any running worker and closes the tab. Whatever the worker changed stays in the checkout. */
  async close(tabId: string): Promise<Tab> {
    const tab = this.must(tabId);
    const run = this.runs.get(tab.id);
    this.settlePending(tab, { behavior: 'deny', message: 'The tab was closed in Council.' }, 'denied');
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

  private resolvePermission(tab: Tab, p: PendingPermission, decision: Decision, status: PermissionStatus): void {
    if (p.decision) return;
    p.decision = decision;
    (p.item.data as PermissionItemData).status = status;
    this.emit('item', { tabId: tab.id, item: p.item });
    p.settle();
    const run = this.runs.get(tab.id);
    if (run && run.token === p.token) {
      run.waiting = Math.max(0, run.waiting - 1);
      if (run.waiting === 0) run.armStall();
    }
  }

  /** Answers every request of this tab that is still waiting. */
  private settlePending(tab: Tab, decision: Decision, status: PermissionStatus): void {
    for (const p of this.permissions.values()) {
      if (p.tabId === tab.id && !p.decision) this.resolvePermission(tab, p, decision, status);
    }
  }

  private forgetPermissions(token: string): void {
    for (const [id, p] of this.permissions) if (p.token === token) this.permissions.delete(id);
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

  private availableProviders(): Provider[] {
    const unavailable = this.unavailable();
    return PROVIDERS.filter((p) => !unavailable.includes(p));
  }

  private tierFor(tab: Tab, provider: Provider): Tier | null {
    const map = this.routing(tab.projectId).tierMap;
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
    const eff = this.routing(tab.projectId);
    const cwd = tab.projectRoot;
    const snapshot = await (this.deps.snapshot ?? repoSnapshot)(cwd);
    const result = await runCouncil({
      seats: eff.seats,
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
      onQuota: (provider, windows) => this.noteUsage(provider, windows),
      onAccount: (provider, plan) => this.notePlan(provider, plan),
    });
    if (isClosed(tab)) return;

    tab.vote = result;
    const decision = route(result.decision, eff.tierMap, await this.budgets(), this.unavailable());
    tab.tier = decision.tier;
    tab.routing = { shiftedFrom: decision.shiftedFrom, reason: decision.reason, notes: eff.notes };
    tab.worker = { provider: decision.provider, model: decision.model, sessionId: null };
    this.addItem(tab, 'vote', undefined, { council: result, routing: decision, notes: eff.notes });

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
    const stallMs = Math.max(10, s.stallMinutes * 60_000);
    const run: ActiveRun = { ac: new AbortController(), token: randomBytes(18).toString('base64url'), waiting: 0, armStall: () => {}, done, finish };
    this.runs.set(tab.id, run);
    const armStall = () => {
      if (run.stallTimer) clearTimeout(run.stallTimer);
      if (run.waiting > 0) return;
      run.stallTimer = setTimeout(() => {
        if (tab.status === 'running' && !tab.stalled && run.waiting === 0) {
          tab.stalled = true;
          this.emit('stall', { tabId: tab.id });
          void this.touch(tab);
        }
      }, stallMs);
    };
    run.armStall = armStall;
    const url = tab.fullAuto ? undefined : this.deps.permissionUrl?.();

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
        permissions: url ? { url, tabId: tab.id, token: run.token } : undefined,
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
          case 'quota':
            this.noteUsage(worker.provider, ev.windows);
            break;
          case 'account':
            this.notePlan(worker.provider, ev.plan);
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
      this.settlePending(tab, { behavior: 'deny', message: 'The worker run ended before the developer answered.' }, 'denied');
      this.runs.delete(tab.id);
      this.forgetPermissions(run.token);
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
    const eff = this.routing(tab.projectId);
    const from = tab.worker ?? { provider: 'gemini', model: null, sessionId: null };
    let next: TabWorker;

    if (reason === 'escalate') {
      const idx = TIER_ORDER.indexOf(tab.tier ?? 'easy');
      const nextTier = TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)] as Tier;
      const r = route(nextTier, eff.tierMap, await this.budgets(), this.unavailable());
      tab.tier = r.tier;
      tab.routing = { shiftedFrom: r.shiftedFrom, reason: r.reason, notes: eff.notes };
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
        signal: AbortSignal.timeout(s.seatTimeoutMs),
      });
      for await (const ev of events) {
        if (ev.type === 'text') text += ev.text;
        if (ev.type === 'quota') this.noteUsage(seat.provider, ev.windows);
        if (ev.type === 'account') this.notePlan(seat.provider, ev.plan);
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
