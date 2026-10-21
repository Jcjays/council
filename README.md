# Council

Council is a small local app that puts **Claude Code**, **Codex CLI** and **Gemini CLI** to work on the same project at the same time, and spends the expensive one only when it has to.

You open a project, create a tab and describe a task. A *council* of cheap models votes on how hard the task is. The task goes to the cheapest worker that can handle it: Gemini for easy, Codex for medium, Claude for hard (all configurable). The worker edits your checkout directly, follows the project's own `CLAUDE.md`, `AGENTS.md` or `GEMINI.md`, and commits nothing; you review the result in your editor or git. Spend per provider is tallied against your monthly credit and shown on screen.

Everything runs on your machine and talks to the CLIs you already have installed and signed in. Nothing leaves your machine except what those CLIs send to their vendors.

## How a tab works

1. **Describe** the task in a new tab. Pick *Auto* to let the council route it, or pick a specific provider and model yourself.
2. **Vote.** Each council seat (by default Gemini Flash, a small Codex model and Claude Haiku) is asked, without tools, to classify the task as easy, medium or hard. Majority wins; a three-way split lands on medium; a two-way tie goes to the higher tier. The vote card shows every seat's answer, confidence, reason and cost.
3. **Start.** The task is routed to the worker for that tier. If that provider's budget is exhausted, or its CLI is missing or not signed in, routing shifts to the nearest tier and says so. You can override the pick before starting, or turn on *auto-start* in Settings.
4. **Work.** The worker runs in your project checkout. Its output, tool calls and cost stream into the tab. Follow-up messages resume the same CLI session. Nothing is committed; the changes sit in your working copy like edits you made yourself. Two tabs editing the same files at the same time can collide, so give parallel tabs separate areas of the code.
5. **Escalate or switch.** If the worker fails, the task is handed one tier up with a short summary of what was tried and the uncommitted diff so far (once, automatically; after that it is your call). *Switch worker* does the same to any provider you choose; switching back resumes the earlier session.
6. **Review and close.** Look at the changes in your editor or `git diff`, keep or discard them, and close the tab. Closing stops a running worker and leaves the checkout as it is.

## Requirements

- Node 24 or newer.
- git.
- The CLIs you want to use, installed and signed in on this machine:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then set `ANTHROPIC_API_KEY` or run `claude` once and sign in.
  - Codex CLI: `npm install -g @openai/codex`, then set `CODEX_API_KEY` (or `OPENAI_API_KEY`) or run `codex login`.
  - Gemini CLI: `npm install -g @google/gemini-cli`, then set `GEMINI_API_KEY` or run `gemini` once and sign in. Google Workspace accounts also need `GOOGLE_CLOUD_PROJECT`.

The Settings page has a health panel that shows what Council can see of each CLI.

## Install and run

```bash
npm install
npm run build
npm start
```

Then open <http://localhost:4317>. Set `PORT` to use another port. During development `npm run dev` runs the server with reload and the client with Vite on <http://localhost:5173>.

Council keeps its data in `~/.council` (`settings.json`, `pricing.json`, `ledger.jsonl`, and one folder per project with its tabs). Set `COUNCIL_HOME` to put it elsewhere.

## Budgets and prices

Each provider has a monthly limit (defaults: Claude $40, Codex $30, Gemini $30, reset on the 1st). Every CLI run, including votes and hand-off summaries, is appended to `ledger.jsonl` and summed for the current period. At 80% a budget bar turns amber; at 100% the provider counts as exhausted and auto routing avoids it. Picking it by hand still works.

Claude Code reports its own cost per run and that number is used as is. If you run Claude on a subscription rather than an API key, it is the list-price equivalent, not money leaving your account. Codex and Gemini report tokens only, so Council multiplies them by the price table in Settings. The seeded prices come from public price pages and are meant to be checked and edited; prices are per million tokens and a row can be an exact model name, a prefix, or `<provider>:default`.

## Settings worth knowing

- **Council seats** – any number of seats from 1 to 5, each any provider and model. Keep them cheap: every task pays for every seat.
- **Who does what** – the worker for each tier. Defaults: easy → Gemini `flash`, medium → Codex default model, hard → Claude Sonnet.
- **Allowed commands** – Claude Code `--allowedTools` patterns for workers. Gemini workers auto-approve edits only; Codex workers run in a workspace-write sandbox. The *Full auto* toggle on a tab lifts all of these for that tab.
- **Auto-start / auto-escalate / stall minutes** – whether to skip the pause after a vote, whether a failed worker escalates once by itself, and how long silence counts as a stall.

## Known limits

- Council seats are tool-less only on Claude. Codex and Gemini seats are *asked* not to read files and are cut off after 60 seconds, but a chatty seat can still spend more than the per-vote ceiling; the vote card flags it.
- Sign-in detection is a heuristic (API key in the environment, or a stored login file). A provider can look signed in and still fail; the failure shows in the transcript and escalation takes over.
- Gemini CLI resumes sessions per directory, so two Gemini tabs on the same project share a session list; very old Gemini CLIs may not accept the prompt on stdin.
- The Codex and Gemini stream parsers were written from the documented event shapes; if a CLI release changes them, the transcript goes quiet while the cost is still recorded. Fixtures live in `server/test/fixtures`.
- One developer, one machine. There is no team server.

## Development

```bash
npm test          # server and client unit tests
npm run e2e       # real run through every installed, signed-in CLI (costs a few cents)
npm run e2e -- --providers=claude
```

Design: [docs/superpowers/specs/2026-10-20-council-design.md](docs/superpowers/specs/2026-10-20-council-design.md). Implementation plan: [docs/superpowers/plans/2026-10-20-council-implementation.md](docs/superpowers/plans/2026-10-20-council-implementation.md).
