# Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Node server plus browser UI that routes a developer's task to Gemini, Codex or Claude by council vote, runs each tab's worker in its own git worktree, and tallies spend per provider.

**Architecture:** Three CLI adapters share one interface (`buildArgs` + `parseLine` pure functions wrapped by a spawn helper). Pure services (ledger, budget, tally, routing, state machine) are composed by a `TaskEngine` that owns tabs and emits events. An `http` + `ws` layer exposes REST and a WebSocket stream to a Vite/React client.

**Tech Stack:** Node 24, TypeScript (ESM, strict), Vitest, `ws`, Vite + React 18. npm workspaces: `server/`, `client/`.

**Spec:** `docs/superpowers/specs/2026-10-20-council-design.md`

## Global Constraints

- Node `>=24`; ESM everywhere (`"type": "module"`); TypeScript `strict: true`.
- Providers are exactly `'claude' | 'codex' | 'gemini'`; tiers exactly `'easy' | 'medium' | 'hard'`; purposes exactly `'vote' | 'work' | 'summarize'`.
- Data dir is `~/.council`, overridden by env `COUNCIL_HOME`. Tests always set `COUNCIL_HOME` to a temp dir.
- Defaults: budgets `{ claude: 40, codex: 30, gemini: 30 }` USD; warn at `0.8`; reset day `1`; vote cost ceiling `0.05`; seat timeout `60_000` ms; stall `10` minutes; port `4317`.
- Default council seats: `[{provider:'gemini', model:'flash'}, {provider:'codex', model:null}, {provider:'claude', model:'claude-haiku-5-5'}]` (`null` = CLI default model).
- Default tier map: `easy → {gemini, 'flash'}`, `medium → {codex, null}`, `hard → {claude, 'claude-sonnet-5-5'}`.
- Worktrees at `<project>/.worktrees/<branch-leaf>`; branches `council/<slug>-<6-char id>`.
- No file contents are ever sent to council seats by the app.
- Every adapter `result` event is written to the ledger before anything else reacts to it.

## Review Focus

1. A CLI prints a non-JSON line (warning, ANSI, deprecation notice) in the middle of its JSONL stream; the parser must skip it and keep going. Pinned in Task 1.
2. A worker exits 0 but reports failure in-band (Claude `is_error`, Codex `turn.failed`, Gemini `error`); the tab must go to `failed` and the ledger line must still be written. Pinned in Tasks 2–4 and 14.
3. A tab title with spaces, slashes, emoji or 200 characters must still produce a valid git branch name. Pinned in Task 11.
4. A ledger file with a truncated or corrupt last line must still load and budgets must still compute. Pinned in Task 6.
5. The developer closes a tab while its worker is running; the child process must be killed and no further events applied to the closed tab. Pinned in Task 14.

---

### Task 0: Scaffold the workspace

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `README.md`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/config/paths.ts`
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`
- Test: `server/test/paths.test.ts`

**Interfaces:**
- Produces: `councilHome(): string` (env `COUNCIL_HOME` or `~/.council`), `paths(home?)` → `{ home, settings, pricing, ledger, projects }` absolute paths.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/paths.test.ts
test('councilHome prefers COUNCIL_HOME', () => {
  process.env.COUNCIL_HOME = 'C:/tmp/ch';
  expect(councilHome()).toBe('C:/tmp/ch');
});
test('paths derive files from home', () => {
  const p = paths('/x');
  expect(p.ledger).toBe(path.join('/x', 'ledger.jsonl'));
  expect(p.projects).toBe(path.join('/x', 'projects'));
});
```

- [ ] **Step 2: Create root `package.json`** with `"workspaces": ["server", "client"]`, scripts `dev` (concurrently server `tsx watch` and client `vite`), `build`, `test` (`npm -w server test`), `e2e`, `start`. Server devDeps: `typescript`, `vitest`, `tsx`, `@types/node`, `@types/ws`; deps: `ws`. Client deps: `react`, `react-dom`; devDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`. Vite dev server proxies `/api` and `/ws` to `http://localhost:4317`.

- [ ] **Step 3: Run test to verify it fails** — `npm -w server test` → FAIL: cannot find module `../src/config/paths`.

- [ ] **Step 4: Implement `server/src/config/paths.ts`** exporting `councilHome()` and `paths(home = councilHome())`.

- [ ] **Step 5: Run tests** → PASS. `npm -w client run build` succeeds with a placeholder `App`.

- [ ] **Step 6: Commit** — `chore: scaffold council workspace (server, client, vitest)` including the spec and this plan.

---

### Task 1: JSONL parser and cross-platform spawn helper

**Files:**
- Create: `server/src/adapters/jsonl.ts`, `server/src/adapters/spawn.ts`
- Test: `server/test/jsonl.test.ts`, `server/test/spawn.test.ts`

**Interfaces:**
- Produces: `class JsonLineBuffer { push(chunk: string): unknown[]; flush(): unknown[] }` — splits on `\n`, parses complete lines, silently skips lines that are not JSON objects.
- Produces: `resolveCommand(name: string, env = process.env): string` — on win32 returns `<dir>/<name>.cmd` when such a file exists on `PATH`, else `name`.
- Produces: `spawnCli(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: string; signal?: AbortSignal }): { lines: AsyncIterable<unknown>; exit: Promise<number>; stderr: () => string }`.

- [ ] **Step 1: Write failing tests**

```ts
test('parses complete lines and skips garbage', () => {
  const b = new JsonLineBuffer();
  expect(b.push('{"a":1}\nWARNING: deprecated\n{"b":')).toEqual([{ a: 1 }]);
  expect(b.push('2}\n')).toEqual([{ b: 2 }]);
});
test('flush parses a trailing line without newline', () => {
  const b = new JsonLineBuffer();
  b.push('{"a":1}');
  expect(b.flush()).toEqual([{ a: 1 }]);
});
test('spawnCli streams JSON lines from a real child and resolves exit code', async () => {
  const child = spawnCli(process.execPath, ['-e', 'console.log(JSON.stringify({x:1}));console.log("noise");process.exit(3)'], { cwd: process.cwd() });
  const got = []; for await (const l of child.lines) got.push(l);
  expect(got).toEqual([{ x: 1 }]);
  expect(await child.exit).toBe(3);
});
test('spawnCli writes stdin when provided', async () => {
  const child = spawnCli(process.execPath, ['-e', 'process.stdin.on("data",d=>console.log(JSON.stringify({got:String(d).trim()})))'], { cwd: process.cwd(), stdin: 'hello' });
  const got = []; for await (const l of child.lines) got.push(l);
  expect(got).toEqual([{ got: 'hello' }]);
});
```

- [ ] **Step 2: Run** `npm -w server test` → FAIL (modules missing).
- [ ] **Step 3: Implement** `jsonl.ts` and `spawn.ts`. `spawnCli` uses `child_process.spawn` with `windowsHide: true`, ends stdin after writing, kills on `signal.abort`, collects stderr (last 8 KB).
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `feat(adapters): jsonl buffer and spawn helper`.

---

### Task 2: Claude adapter

**Files:**
- Create: `server/src/adapters/types.ts`, `server/src/adapters/claude.ts`
- Create: `server/test/fixtures/claude-work.jsonl`, `server/test/fixtures/claude-vote.jsonl` (recorded)
- Test: `server/test/claude.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Provider`, `Tier`, `Purpose`, `Usage { inputTokens; cachedInputTokens; outputTokens }`, `RunOptions`, `AdapterEvent`, `CliHealth`, `Adapter` exactly as in the spec, plus `CliSpec { cmd: string; args: string[]; stdin?: string }`.
- Produces: `buildClaudeArgs(o: RunOptions): CliSpec`, `parseClaudeLine(obj: unknown): AdapterEvent[]`, `class ClaudeAdapter implements Adapter`.

- [ ] **Step 1: Record fixtures** (one-off, costs cents): in a scratch dir run `claude -p "Reply with the single word pong" --output-format stream-json --verbose --model claude-haiku-5-5 --no-session-persistence --tools ""` → `claude-vote.jsonl`; and `claude -p "Create a file named hello.txt containing hi" --output-format stream-json --verbose --model claude-haiku-5-5 --permission-mode acceptEdits` → `claude-work.jsonl`. Redact nothing but confirm no secrets are present.

- [ ] **Step 2: Write failing tests**

```ts
test('work args: acceptEdits, allowed tools, model, resume', () => {
  const s = buildClaudeArgs({ cwd: 'C:/w', prompt: 'do it', model: 'claude-sonnet-5-5', purpose: 'work', resumeId: 'abc', fullAuto: false, allowedCommands: ['Bash(npm test*)'] });
  expect(s.cmd).toBe('claude');
  expect(s.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5-5', '--resume', 'abc', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(npm test*)']));
  expect(s.stdin).toBe('do it');
});
test('fullAuto uses --dangerously-skip-permissions', ...);
test('vote args disable tools, cap budget, pass json schema, no persistence', ...);
test('null model omits --model', ...);
test('parses recorded work stream into session, text, tool and result events', () => {
  const events = fixtureLines('claude-work.jsonl').flatMap(parseClaudeLine);
  expect(events[0]).toMatchObject({ type: 'session' });
  expect(events.some(e => e.type === 'tool')).toBe(true);
  const r = events.at(-1); expect(r.type).toBe('result'); expect(r.costUsd).toBeGreaterThan(0); expect(r.usage.outputTokens).toBeGreaterThan(0);
});
test('result with is_error=true maps to isError', () => { ... synthetic object ... });
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** Usage mapping: `inputTokens = usage.input_tokens`, `cachedInputTokens = cache_read_input_tokens + cache_creation_input_tokens`, `outputTokens = usage.output_tokens`; `costUsd = total_cost_usd`; `text` on result = `result` (or `structured_output` JSON-stringified when present). `check()` runs `claude --version` and reports `authed: true` when `ANTHROPIC_API_KEY` is set or `~/.claude` credentials exist.
- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit** — `feat(adapters): claude adapter with recorded fixtures`.

---

### Task 3: Gemini adapter

**Files:** `server/src/adapters/gemini.ts`, fixtures `gemini-work.jsonl`, `gemini-vote.json`, test `server/test/gemini.test.ts`.

**Interfaces:** `buildGeminiArgs(o): CliSpec`, `parseGeminiLine(obj): AdapterEvent[]`, `parseGeminiJson(obj): AdapterEvent[]` (for `-o json` vote runs), `class GeminiAdapter`.

- [ ] **Step 1: Record fixtures**: `gemini -p "Reply with the single word pong" -m flash -o json` → `gemini-vote.json`; `gemini -p "Create a file named hello.txt containing hi" -m flash -o stream-json --approval-mode auto_edit` → `gemini-work.jsonl`.
- [ ] **Step 2: Tests**: work args contain `-o stream-json -m flash --approval-mode auto_edit` and prompt as positional/`-p`; fullAuto → `--approval-mode yolo`; resume → `--resume <id>`; vote → `-o json`; parse fixtures: `init` → session, `message` → text, `result` → result with tokens summed over `stats.models[*].tokens` (`inputTokens = prompt - cached`, `cachedInputTokens = cached`, `outputTokens = candidates + thoughts`), `costUsd` undefined; exit code 53 or `error` → `isError`.
- [ ] **Step 3–5:** FAIL → implement (`cmd` from `resolveCommand('gemini')`) → PASS → commit `feat(adapters): gemini adapter`.

---

### Task 4: Codex adapter (from documented schema; re-recorded in Task 17)

**Files:** `server/src/adapters/codex.ts`, fixture `codex-work.jsonl` (hand-written from docs), test `server/test/codex.test.ts`.

**Interfaces:** `buildCodexArgs(o): CliSpec`, `parseCodexLine(obj): AdapterEvent[]`, `class CodexAdapter`.

- [ ] **Tests**: work args `exec --json -C <cwd> --sandbox workspace-write --skip-git-repo-check -` with stdin prompt and `-m` when model non-null; fullAuto → `--yolo`; resume → `exec resume <id> --json ... -`; vote → `--sandbox read-only --output-schema <tmpfile>`; parse: `thread.started.thread_id` → session; `item.completed` with `item.type==='agent_message'` → text; `command_execution`/`file_change` → tool; `turn.completed.usage` → result (`inputTokens = input_tokens - cached_input_tokens`, `cachedInputTokens`, `outputTokens = output_tokens + reasoning_output_tokens`); `turn.failed` → result `isError: true` with `text = error.message`.
- [ ] FAIL → implement → PASS → commit `feat(adapters): codex adapter from documented schema`.

---

### Task 5: Adapter registry and CLI health

**Files:** `server/src/adapters/index.ts`, `server/src/adapters/health.ts`; test `server/test/health.test.ts`.

**Interfaces:** `adapters: Record<Provider, Adapter>`; `probeVersion(cmd: string, args = ['--version']): Promise<{ installed: boolean; version?: string; error?: string }>`; `checkAll(): Promise<Record<Provider, CliHealth>>`.

- [ ] **Tests**: `probeVersion(process.execPath)` → `installed: true`, `version` matches `/^v?\d+/`; `probeVersion('definitely-not-a-cli-xyz')` → `installed: false` with `error`.
- [ ] FAIL → implement → PASS → commit `feat(adapters): registry and health probe`.

---

### Task 6: Pricing and ledger

**Files:** `server/src/ledger/pricing.ts`, `server/src/ledger/ledger.ts`; tests `pricing.test.ts`, `ledger.test.ts`.

**Interfaces:**
- `type PriceTable = Record<string, { inputPerM: number; cachedInputPerM: number; outputPerM: number }>`; `DEFAULT_PRICING: PriceTable` (keys: `gemini-2.5-flash`, `gemini-2.5-pro`, `flash`, `pro`, `codex:default`, plus any current OpenAI names found during implementation; values verified against public price pages and noted in README as editable).
- `costFor(provider: Provider, model: string | null, usage: Usage, table: PriceTable): number` — exact key, then longest prefix match, then `<provider>:default`, else `0`.
- `interface LedgerEntry { ts: string; provider; model: string | null; purpose: Purpose; tabId: string; projectId: string; usage: Usage; costUsd: number }`
- `appendEntry(file: string, e: LedgerEntry): Promise<void>`; `readEntries(file: string): Promise<LedgerEntry[]>` (missing file → `[]`; corrupt line skipped); `periodStart(now: Date, resetDay: number): Date`; `sumPeriod(entries, start: Date, end: Date): Record<Provider, { spent: number; routingSpent: number }>` where `routingSpent` sums `purpose !== 'work'`.

- [ ] **Tests**: `costFor` exact / prefix / default / unknown=0; 1M input tokens at `inputPerM: 0.3` → `0.3`; append then read round-trips two entries; corrupt trailing line is skipped; `periodStart(2026-10-20, 1)` → `2026-10-01`; `periodStart(2026-10-05, 15)` → `2026-09-15`; `sumPeriod` splits `vote` into `routingSpent` and excludes entries before `start`.
- [ ] FAIL → implement → PASS → commit `feat(ledger): pricing table, jsonl ledger, period sums`.

---

### Task 7: Budget state and budget-aware routing

**Files:** `server/src/ledger/budget.ts`, `server/src/council/routing.ts`; tests `budget.test.ts`, `routing.test.ts`.

**Interfaces:**
- `interface BudgetState { provider; spent; routingSpent; limit; pct; warning: boolean; exhausted: boolean }`; `budgetState(provider, sums, limit, warnPct = 0.8): BudgetState`.
- `type TierMap = Record<Tier, { provider: Provider; model: string | null }>`; `TIER_ORDER = ['easy','medium','hard'] as const`.
- `route(tier: Tier, map: TierMap, budgets: Record<Provider, BudgetState>): { tier: Tier; provider; model; shiftedFrom?: Tier; reason?: string }`.

- [ ] **Tests**: `pct` = spent/limit, `warning` at 0.8, `exhausted` at ≥1.0; `route('easy')` with Gemini exhausted → medium with `shiftedFrom:'easy'`; `route('hard')` with Claude exhausted → medium (shift down); all exhausted → original tier with `reason` containing `exhausted`.
- [ ] FAIL → implement → PASS → commit `feat(budget): budget state and routing shifts`.

---

### Task 8: Vote extraction and tally

**Files:** `server/src/council/vote.ts`, `server/src/council/tally.ts`; tests `vote.test.ts`, `tally.test.ts`.

**Interfaces:** `VOTE_JSON_SCHEMA` (object; `tier` enum, `confidence` 0–1, `reason` string; all required); `interface Vote { tier: Tier; confidence: number; reason: string }`; `extractVote(text: string): Vote | null` (accepts raw JSON, fenced JSON, or JSON embedded in prose; rejects bad tier); `tally(tiers: Tier[]): { decision: Tier; counts: Record<Tier, number>; tie: boolean }`.

- [ ] **Tests**: extract from ```` ```json {...} ``` ````, from `Here you go: {...}`, null on `{"tier":"huge"}`, null on empty; tally `[easy,easy,hard]` → easy; `[easy,medium,hard]` → medium, `tie:true`; `[easy,hard]` → hard, `tie:true`; `[medium,medium,hard,hard]` → hard; `[]` → medium.
- [ ] FAIL → implement → PASS → commit `feat(council): vote schema, extraction, tally`.

---

### Task 9: Repo snapshot and vote prompt

**Files:** `server/src/council/snapshot.ts`, `server/src/council/prompt.ts`; tests `snapshot.test.ts`, `prompt.test.ts`.

**Interfaces:** `repoSnapshot(cwd: string, opts = { maxEntries: 40 }): Promise<string>` — top-level entries (dirs with `/`), file-extension counts over the tree (respecting `.gitignore` via `git ls-files` when available, else fs walk capped at 5000 files), never file contents; `buildVotePrompt(task: string, snapshot: string): string` — includes the three tier definitions (easy: single-file, mechanical, well-specified; medium: multi-file or needs reading code to decide; hard: design, architecture, cross-cutting, ambiguous, or debugging unknown cause), instructs "do not open files or run tools", and demands only the JSON object.

- [ ] **Tests**: snapshot of a temp dir lists `src/` and `README.md` and `.ts: 2`; snapshot never contains a known file's content string; prompt contains the task text, the snapshot, the word `"tier"`, and `do not open files`.
- [ ] FAIL → implement → PASS → commit `feat(council): repo snapshot and vote prompt`.

---

### Task 10: Council runner

**Files:** `server/src/council/council.ts`; test `council.test.ts` with an in-test `FakeAdapter` (scripted events, optional delay, optional throw).

**Interfaces:**
- `interface Seat { provider: Provider; model: string | null }`
- `interface SeatResult { seat: Seat; vote: Vote | null; costUsd: number; durationMs: number; error?: string; overCeiling: boolean }`
- `interface CouncilResult { seats: SeatResult[]; decision: Tier; tie: boolean; counts: Record<Tier, number> }`
- `runCouncil(args: { seats: Seat[]; adapters: Record<Provider, Adapter>; task: string; cwd: string; snapshot: string; onResult: (provider, model, ev: AdapterEvent & {type:'result'}) => Promise<void>; timeoutMs?: number; costCeiling?: number; pricing: PriceTable }): Promise<CouncilResult>` — runs seats in parallel with `purpose: 'vote'`, calls `onResult` for every result event (ledger hook), ignores seats that error or time out, tallies the rest.

- [ ] **Tests**: three fake seats voting easy/easy/hard → decision easy and three `onResult` calls; one seat throws → decision from the other two, `error` set; one seat sleeps past `timeoutMs: 50` → ignored, run finishes under 500 ms; seat with `costUsd: 0.2` → `overCeiling: true`.
- [ ] FAIL → implement → PASS → commit `feat(council): parallel seat runner`.

---

### Task 11: Worktree manager

**Files:** `server/src/worktrees/git.ts`, `server/src/worktrees/manager.ts`; test `worktrees.test.ts` (creates a temp repo with `git init`, one commit, user.name/email set locally).

**Interfaces:**
- `runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>`
- `slugify(title: string): string` — lowercase, `[a-z0-9]+` runs joined by `-`, max 40 chars, `task` when empty.
- `class WorktreeManager { constructor(projectRoot: string); defaultBranch(): Promise<string>; ensureExcluded(): Promise<void>; create(tabId: string, title: string): Promise<{ path: string; branch: string }>; commitAll(wtPath: string, message: string): Promise<{ committed: boolean; sha?: string }>; mainCheckoutState(): Promise<{ branch: string; clean: boolean; dirtyFiles: string[] }>; mergeInto(branch: string, target: string): Promise<{ kind: 'merged'; sha: string } | { kind: 'blocked'; reason: string; files?: string[] } | { kind: 'conflict'; files: string[] }>; hasUnmergedCommits(branch: string, target: string): Promise<boolean>; diffStat(wtPath: string): Promise<string>; remove(wtPath: string, opts: { keepBranch: boolean; branch: string }): Promise<void> }`

- [ ] **Tests**: `slugify('Fix: the Login/Bug 🚀')` → `fix-the-login-bug`; `create` makes `.worktrees/<leaf>` and branch `council/<slug>-<id>` matches `/^council\/[a-z0-9-]+-[a-z0-9]{6}$/` and `git check-ref-format` passes for a 200-char emoji title; `ensureExcluded` writes `.worktrees/` once (idempotent); `commitAll` on a worktree with a new file → `committed: true`, second call → `false`; `mergeInto` clean → `merged` and file present in main; dirty main → `blocked` listing the dirty file; conflicting edits → `conflict` listing the file and main has no `MERGE_HEAD`; `remove` deletes the dir and keeps the branch when asked; `defaultBranch` returns `master` in a repo initialised that way.
- [ ] FAIL → implement → PASS → commit `feat(worktrees): per-tab worktree lifecycle and merge`.

---

### Task 12: Tab state machine

**Files:** `server/src/tasks/state.ts`; test `state.test.ts`.

**Interfaces:** `type TabStatus = 'drafting'|'voting'|'awaiting-start'|'running'|'idle'|'handing-off'|'failed'|'merged'|'closed'`; `type TabEvent = 'submit-auto'|'submit-manual'|'vote-done'|'vote-done-autostart'|'start'|'worker-done'|'worker-failed'|'message'|'escalate'|'switch'|'handoff-ready'|'merge-done'|'close'`; `transition(s: TabStatus, e: TabEvent): TabStatus` throws `InvalidTransition` otherwise; `canEscalate(tier: Tier): boolean` (false for `hard`).

- [ ] **Tests**: the happy path `drafting →submit-auto→ voting →vote-done→ awaiting-start →start→ running →worker-done→ idle →message→ running`; `submit-manual` → running; `vote-done-autostart` → running; `worker-failed` → failed; `escalate` from idle and failed → handing-off; `handoff-ready` → running; `close` from every state → closed; `start` from `idle` throws `InvalidTransition`.
- [ ] FAIL → implement → PASS → commit `feat(tasks): tab state machine`.

---

### Task 13: Settings and tab store

**Files:** `server/src/config/settings.ts`, `server/src/tasks/store.ts`, `server/src/tasks/types.ts`; tests `settings.test.ts`, `store.test.ts`.

**Interfaces:**
- `interface Settings { budgets: Record<Provider, number>; warnPct: number; resetDay: number; seats: Seat[]; tierMap: TierMap; autoStart: boolean; autoEscalate: boolean; stallMinutes: number; seatTimeoutMs: number; voteCostCeiling: number; allowedCommands: string[]; models: Record<Provider, string[]>; recentProjects: string[]; projectOverrides: Record<string, Partial<Pick<Settings, 'allowedCommands' | 'autoStart' | 'autoEscalate'>>> }`; `DEFAULT_SETTINGS`; `loadSettings(file): Promise<Settings>` (missing → defaults; partial → merged); `saveSettings(file, s)`; `effectiveSettings(s: Settings, projectId: string): Settings` (applies the project's override).
- `interface TranscriptItem { id: string; ts: string; kind: 'user'|'assistant'|'tool'|'system'|'vote'|'result'; text?: string; tool?: { name: string; input: unknown; output?: string }; data?: unknown }`
- `interface Tab { id: string; projectId: string; projectRoot: string; title: string; status: TabStatus; tier: Tier | null; worker: { provider: Provider; model: string | null; sessionId: string | null } | null; previousWorkers: Tab['worker'][]; worktree: { path: string; branch: string } | null; vote: CouncilResult | null; routing: { shiftedFrom?: Tier; reason?: string } | null; transcript: TranscriptItem[]; costUsd: number; fullAuto: boolean; escalations: number; stalled: boolean; lastMerge: unknown | null; createdAt: string; updatedAt: string }`
- `class TabStore { constructor(projectsDir: string); projectId(root: string): string (sha1 of normalised path, 12 chars); save(tab): Promise<void>; load(projectId, tabId): Promise<Tab | null>; list(projectId): Promise<Tab[]> }`

- [ ] **Tests**: `loadSettings` on missing file equals `DEFAULT_SETTINGS`; partial file `{ budgets: { claude: 10 } }` keeps other defaults; save/load round trip; `TabStore` save → list returns it; `projectId` is stable across `/` vs `\` separators and case on win32.
- [ ] FAIL → implement → PASS → commit `feat(config): settings and tab store`.

---

### Task 14: Task engine

**Files:** `server/src/tasks/engine.ts`, `server/src/tasks/handoff.ts`; test `engine.test.ts` using `FakeAdapter` from Task 10's test helper (move it to `server/test/helpers/fakeAdapter.ts`) and a `FakeWorktrees` implementing the `WorktreeManager` surface in memory.

**Interfaces:**
- `buildHandoffPrompt(args: { task: string; summary: string; diffStat: string; fromWorker: string; reason: 'escalate'|'switch' }): string`
- `buildRebasePrompt(defaultBranch: string): string`
- `class TaskEngine extends EventEmitter` with deps `{ adapters; worktrees: (root) => WorktreeManager; store: TabStore; ledgerFile: string; settings: () => Settings; pricing: PriceTable; now?: () => Date }` and methods: `createTab(projectRoot, title): Promise<Tab>`; `submit(tabId, text, mode: { kind: 'auto' } | { kind: 'manual'; provider; model }, opts?: { fullAuto?: boolean }): Promise<Tab>`; `start(tabId, override?: { provider; model }): Promise<Tab>`; `send(tabId, text): Promise<Tab>`; `escalate(tabId): Promise<Tab>`; `switchWorker(tabId, provider, model): Promise<Tab>`; `merge(tabId): Promise<{ tab: Tab; result: ReturnType<WorktreeManager['mergeInto']> extends Promise<infer R> ? R : never }>`; `askRebase(tabId): Promise<Tab>`; `close(tabId, opts: { deleteWorktree: boolean }): Promise<Tab>`; `budgets(): Promise<Record<Provider, BudgetState>>`. Emits `'tab'` (full `Tab`) on every change and `'item'` (`{ tabId, item }`) per transcript item.

- [ ] **Tests**:
  - auto submit: fake seats vote easy → tab `awaiting-start`, `tab.tier === 'easy'`, `vote.seats.length === 3`, three ledger lines with `purpose: 'vote'`; `start()` → fake worker events stream into transcript → `idle`, one ledger line `purpose: 'work'`, `tab.costUsd > 0`, `worker.sessionId` set from the `session` event.
  - autoStart setting → `running` straight after vote.
  - manual submit skips the council: zero `vote` ledger lines, worker is the chosen provider.
  - `send()` passes `resumeId === worker.sessionId` to the adapter (assert on the fake's recorded `RunOptions`).
  - worker failure with `autoEscalate` → `handing-off` then `running` on the next tier, `previousWorkers` has the old one, handoff prompt contains the fake summariser's text and the diff stat, `escalations === 1`; a second failure does not escalate again → `failed`.
  - `switchWorker('claude', 'claude-sonnet-5-5')` from idle keeps the old session in `previousWorkers`; switching back resumes that session id.
  - same-provider model change via `switchWorker` keeps `sessionId` and passes the new model.
  - `close` while running → fake adapter observed `signal.aborted === true`; later events are not applied; status `closed`.
  - `merge` → `committed` then `merged`; with `FakeWorktrees` returning `conflict` → tab stays `idle` and the result is surfaced.
  - stall: with `stallMinutes: 0.001` and a fake worker that emits nothing for 200 ms, the engine emits `'stall'` `{ tabId }` once and sets `tab.stalled = true`; the next worker event clears it. No automatic escalation on stall.
- [ ] FAIL → implement → PASS (also run the whole suite) → commit `feat(tasks): task engine with council, escalation, switching, merge`.

---

### Task 15: HTTP API and WebSocket

**Files:** `server/src/http.ts`, `server/src/ws.ts`, `server/src/index.ts`; test `http.test.ts` (starts the server on port 0, uses `fetch` and `ws`).

**Interfaces (REST, JSON):**
- `GET /api/health` → `Record<Provider, CliHealth>`; `GET /api/settings`, `PUT /api/settings`; `GET /api/budgets`
- `GET /api/projects` (recent roots from settings store), `POST /api/projects { path }` → `{ projectId, root, defaultBranch }`
- `GET /api/tabs?projectId=`, `POST /api/tabs { projectRoot, title }`
- `POST /api/tabs/:id/{submit|start|send|escalate|switch|merge|rebase|close}` bodies per engine method
- `GET /api/pricing`, `PUT /api/pricing`
- WS `/ws` messages: `{ type: 'tab', tab }`, `{ type: 'item', tabId, item }`, `{ type: 'budgets', budgets }`
- Static: serves `client/dist` at `/` when present.

- [ ] **Tests**: health returns three providers; `POST /api/tabs` then `GET /api/tabs` lists it; a WS client receives a `tab` message after `POST /api/tabs`; unknown route → 404 JSON; invalid JSON body → 400.
- [ ] FAIL → implement → PASS → commit `feat(server): rest api and websocket stream`.

---

### Task 16: Client

**Files:** `client/src/{api.ts,useSocket.ts,App.tsx,styles.css}`, `client/src/components/{Sidebar,BudgetBars,TabView,VoteCard,Transcript,Composer,Settings,Health}.tsx`, `client/src/lib/format.ts`; test `client/src/lib/format.test.ts` (vitest in client workspace).

**Interfaces:** `formatUsd(n): string` (`$0.0123` under a cent, else 2 dp); `budgetTone(pct): 'ok'|'warn'|'over'`; `daysLeft(now, resetDay): number`; `workerLabel(w): string`.

- [ ] **Tests** for the four helpers (pure).
- [ ] **Build the UI** per the spec's Screens section: sidebar with project picker, budget bars (hover shows routing spend), tab list; tab view with header buttons, vote card with override dropdown and Start, transcript (tool items collapsed, `<details>`), composer with mode selector / model dropdown / Full-auto / Send; settings panel bound to `/api/settings` and `/api/pricing`; health panel. Light and dark via `prefers-color-scheme`. Keyboard: Enter sends, Shift+Enter newline.
- [ ] **Verify**: `npm run build` clean; `npm run dev`, open `http://localhost:4317`, create a tab, see vote card and stream.
- [ ] Commit — `feat(client): tabs, vote card, transcript, budgets, settings`.

---

### Task 17: Install Codex CLI, re-record fixture, end-to-end script

**Files:** `server/test/e2e.ts`, update `server/test/fixtures/codex-work.jsonl`, root `package.json` script `e2e`.

- [ ] `npm i -g @openai/codex` (pin the `win32-x64` optional package to the same version if the install complains); `codex --version`; authenticate with `CODEX_API_KEY` or `codex login --with-api-key`.
- [ ] Re-record `codex exec --json --sandbox workspace-write --skip-git-repo-check -m <default> "Create a file named hello.txt containing hi"` in a scratch dir → fixture; run Task 4 tests; fix any field drift.
- [ ] `e2e.ts`: create a temp git repo with a README; for each provider run `TaskEngine.submit` manual with "Append the line `council was here` to README.md", wait for `idle`, assert a ledger line with `costUsd > 0` (Claude) or `usage.outputTokens > 0` (others), `merge`, assert README contains the line, `close` with `deleteWorktree: true`, assert the worktree dir is gone. Print per-provider cost.
- [ ] Run `npm run e2e` → three green lines. Commit — `test: end-to-end run through all three workers`.

---

### Task 18: README and first-run polish

**Files:** `README.md`.

- [ ] Write: what Council is (two paragraphs), prerequisites (Node 24, the three CLIs with install commands, the three env vars `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `GEMINI_API_KEY`), `npm install && npm run build && npm start`, how a tab works (vote → start → stream → merge), how budgets are computed (ledger, pricing table, reset day), how to change the council and tier map, limitations (best-effort tool-less seats, Gemini resume per directory, no team server).
- [ ] Commit — `docs: README with setup and usage`.
