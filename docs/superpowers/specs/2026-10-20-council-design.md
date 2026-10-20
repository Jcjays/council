# Council — design

A local router that puts Claude, Codex and Gemini to work on one project. Approved 2026-10-20.

## Context

Each developer at the company gets monthly API credit per provider: $40 Anthropic, $30 OpenAI (Codex), $30 Google (Gemini). Today developers use a mix of the three CLIs and the chat apps and switch between them by hand, and the strongest (most expensive) model ends up doing trivial work.

Council is a local app a developer runs next to a project checkout. They type a task into a tab. A small council of cheap agents votes on difficulty. The task goes to the cheapest worker that can handle it: Gemini for easy, Codex for medium, Claude for hard. Each tab works in its own git worktree, so several agents work on the same project at once without colliding. Spend per provider is tallied against the monthly credit and shown on screen.

Outcome: less spend on the strongest models, and developers stay in one window instead of switching tools.

## Decisions made with Chris

- **Local, per developer.** Node/TypeScript server plus a local web UI in the browser. Runs on Windows and macOS.
- **Drives the CLIs, not the APIs.** Claude Code, Codex CLI and Gemini CLI run headless under the developer's own API keys. No separate API budget.
- **Tab = one task, sticky worker.** The council votes once on the first message. The chosen worker owns the tab; follow-up messages resume that worker's CLI session. Escalation hands the tab to a stronger worker with a summary of what was tried.
- **Council = three cheap seats by default,** one per vendor: Gemini Flash, a small OpenAI model via Codex, Claude Haiku. Majority wins. Every seat is configurable (any provider, any model, 1 to 5 seats). The developer can skip the council and pick the worker and model directly.
- **Council scope: routing only.** Escalation is triggered by worker failure or the developer clicking Escalate. No council review of the diff.
- **Git worktree per tab.** Each tab gets a branch and worktree. The developer merges when done; the app offers a merge button.
- **Budget tracking** per provider against $40 / $30 / $30 per month. Warn when near the cap; route around an exhausted provider.
- **Automatic or manual.** The composer has a mode selector: Auto (council) or a specific agent, with a model dropdown. On the first message it decides whether the council votes. On follow-ups it reads as the current worker; changing it is the same as the header's Switch worker button.

## Builder's calls (vetoable)

- **Location:** `C:\Users\Chris\Desktop\council`, fresh git repo.
- **Tier to worker mapping (configurable):** easy → Gemini `flash`; medium → Codex default model from `~/.codex/config.toml`; hard → `claude-sonnet-5-5`. Opus/Fable stay available in the manual dropdown.
- **Follow-ups and switching.** After the vote, Auto on a follow-up means "keep the current worker"; there is no re-vote. Picking a different provider on a follow-up, or clicking Switch worker, hands the tab over exactly like an escalation: summary written, new CLI session started in the same worktree, old session id kept so the developer can switch back and resume it. Changing only the model within the same provider resumes the existing session with the new `--model`. One `handing-off` state serves both escalate and switch.
- **Commits and merge.** Workers are not asked to commit. A tab branch is cut from the local tip of the default branch. Merge button: (1) commit any uncommitted changes in the worktree as the developer's git identity with message `council(<tab-id>): <tab title>`; (2) if the main checkout is on the default branch and clean, `git merge --no-ff <branch>` there; if it is dirty or on another branch, refuse and list the blocking files or branch, with a "Mark ready" option that leaves the branch for the developer. On conflict: `git merge --abort`, list conflicting files, and offer "Ask worker to rebase", which sends a canned prompt to the tab's worker to rebase its worktree onto the default branch and resolve conflicts. Closing a tab with unmerged commits asks before deleting the worktree and keeps the branch.
- **Seats are best-effort tool-less.** Only Claude has a real no-tools flag. The seat prompt says to answer from the task text and snapshot only, each seat has a 60-second timeout, and the app never sends file contents itself. A seat whose run exceeds the per-vote cost ceiling (default $0.05) is flagged on the vote card.
- **Ledger tags purpose.** Every ledger line carries `purpose: vote | work | summarize`, so budget bars can show routing spend separately on hover.
- **Tie rules:** majority of seats. Three-way split → medium. Even number of seats and a tie → the higher tier.
- **Vote shown before work starts.** The vote card shows each seat's tier, confidence and one-line reason, plus the decision and a "Start with …" dropdown to override. A per-project toggle "auto-start after vote" skips the pause.
- **Permissions for workers (default: edits yes, shell restricted).** Claude: `--permission-mode acceptEdits` plus a per-project allowed-commands list passed as `--allowedTools`. Gemini: `--approval-mode auto_edit`. Codex: `--sandbox workspace-write`. A per-tab "Full auto" toggle switches to `--dangerously-skip-permissions` / `--approval-mode yolo` / `--yolo`. Denied actions show up in the transcript as denials.
- **Council seats run capped.** Claude seat: `--tools "" --no-session-persistence --max-budget-usd 0.05 --json-schema <vote schema>`. Codex seat: `--sandbox read-only --output-schema`. Gemini seat: `-o json`, response parsed as JSON. Seats get the task text and a compact repo snapshot (top-level tree, languages, file counts), never file contents.
- **Escalation:** on hard failure (non-zero exit, Claude `is_error`, Codex `turn.failed`, Gemini exit 1/53) the app escalates one tier automatically, once, with a toggle to turn that off. On a stall (no output for 10 minutes, configurable) it asks the developer. The hand-off summary is written by the cheapest configured seat from the tab transcript plus `git diff --stat` of the worktree.
- **Budget behaviour:** warn at 80%. At 100% the provider is marked exhausted; auto routing shifts to the next tier up (or down if that is the only one left) and says so in the vote card. Manual selection of an exhausted provider is allowed with a warning.
- **Cost computation:** Claude reports `total_cost_usd` in its result event; used as is. Codex and Gemini report tokens only; the app multiplies by a pricing table (`~/.council/pricing.json`, seeded at install, editable in Settings).
- **Storage:** everything under `~/.council/` (override with `COUNCIL_HOME`): `settings.json`, `pricing.json`, `ledger.jsonl`, `projects/<hash>/tabs/<tab-id>.json`. Worktrees live at `<project>/.worktrees/<branch>`, excluded via `.git/info/exclude`.
- **Monthly reset:** ledger is summed from the 1st of the month; reset day configurable.
- **Stack:** Node 24, TypeScript, Vitest. Server: built-in `http` + `ws` + `child_process.spawn`. Client: Vite + React + TypeScript, no component library. npm workspaces.

## Goals, non-goals, anti-goals

Goals: route by difficulty; keep three agents working concurrently without collisions; one window; visible spend.

Non-goals (this version): shared team server, multi-user, auth; council reviewing or voting on diffs; automatic merge or PR creation; IDE integration; supporting developers who only use the chat apps; sandboxing beyond what the CLIs provide.

Anti-goals: spending Sonnet/Opus-class budget on routing (the capped Haiku seat is the agreed exception); two agents editing the same working copy; any CLI run that does not land in the ledger; the developer having to open a terminal to see what an agent did.

## CLI facts (checked 2026-10-20)

| Tool | Status | Notes |
|---|---|---|
| Node | v24.11.1 | |
| Claude Code | 2.1.302 at `~/.local/bin/claude.exe` | `-p --output-format stream-json`, `--resume <id>`, `--model`, `--permission-mode`, `--allowedTools`, `--tools ""`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence` |
| Gemini CLI | 0.15.3 (npm shim) | `-p`, `-o json\|stream-json`, `-m` (aliases `flash`, `flash-lite`, `pro`, `auto`), `--approval-mode default\|auto_edit\|yolo`, `--resume latest\|<index>\|<session-id>` (session id from stream-json `init`; sessions listed per project directory), exit codes 0 / 1 / 42 / 53 |
| Codex CLI | not installed | `npm i -g @openai/codex`; `codex exec --json -C <dir> -m <model> --sandbox workspace-write\|read-only [--yolo] -` (prompt on stdin), `codex exec resume <SESSION_ID>`, `-o <file>`, `--output-schema`; `turn.completed.usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}`; thread id in `thread.started`; key via `CODEX_API_KEY` or `codex login --with-api-key` |

Gemini `stats` shape: `models[<model>].tokens.{prompt,candidates,total,cached,thoughts,tool}`, `tools.totalCalls`, `files.totalLinesAdded/Removed`.

Known risks: Windows npm shims are `.cmd`/`.ps1`; Codex native Windows install may fail on the optional `win32-x64` package (pin both to one version); Gemini `--resume` is per directory, which the per-tab worktree makes workable; Google is moving some tiers from Gemini CLI to Antigravity CLI, so the adapter boundary must keep that a one-file swap.

## Architecture

```
client (Vite + React)  <--WebSocket/JSON-->  server (Node)
                                              ├─ adapters/   claude.ts  codex.ts  gemini.ts   (one interface)
                                              ├─ council/    seats, vote prompt, tally, routing
                                              ├─ tasks/      tab state machine, transcript, escalation
                                              ├─ worktrees/  git worktree add / remove / merge
                                              ├─ ledger/     append runs, monthly sums, pricing, budget state
                                              └─ store/      ~/.council files
```

```ts
interface Adapter {
  provider: 'claude' | 'codex' | 'gemini';
  check(): Promise<{ installed: boolean; version?: string; authed: boolean; error?: string }>;
  run(opts: {
    cwd: string; prompt: string; model: string | null;
    purpose: 'vote' | 'work' | 'summarize';
    resumeId?: string; fullAuto: boolean; allowedCommands: string[];
    signal?: AbortSignal;
  }): AsyncIterable<AdapterEvent>;
}
type AdapterEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: unknown; output?: string }
  | { type: 'result'; usage: Usage; costUsd?: number; exitCode: number; isError: boolean; text?: string }
  | { type: 'error'; message: string };
```

Tab states: `drafting → voting → awaiting-start → running ⇄ idle → (handing-off → running) | failed | merged | closed`.

Vote schema: `{ "tier": "easy" | "medium" | "hard", "confidence": 0..1, "reason": string }`.

## Screens

1. **Sidebar:** project picker, three budget bars (spent / limit, days left, 80% warning colour, routing spend on hover), tab list with status dots and worker icons, "New tab".
2. **Tab:** header with title, tier badge, worker + model, branch, cost of this tab, buttons Escalate / Switch worker / Merge / Close. Vote card. Transcript stream (assistant text, tool calls collapsed, diffs expandable). Composer: mode selector Auto | Gemini | Codex | Claude, model dropdown, Full-auto toggle, Send.
3. **Settings:** council seats editor, tier → worker map, budgets, reset day, pricing table, allowed commands per project, toggles (auto-start, auto-escalate, stall minutes), CLI health panel with install hints.

## Acceptance

- Unit tests: adapter parsers against recorded fixtures, ledger math, tally and tie rules, worktree lifecycle on a temp repo, state machine transitions.
- Integration (`npm run e2e`): a trivial task through each of the three workers in a scratch repo; a branch per tab, a ledger line per run with non-zero cost, merge succeeds, worktree removed.
- Manual: three tabs with an easy, a medium and a hard task route to three different workers, stream concurrently, one escalates, one merges, budget bars match `ledger.jsonl`.

## Left to the builder

Exact vote prompt wording; repo-snapshot format; CSS; the seeded allowed-commands list; retry/backoff on CLI rate limits; how diffs are rendered in the transcript.
