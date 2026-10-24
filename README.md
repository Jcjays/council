# Council

Council is a small local app that puts **Claude Code**, **Codex CLI** and **Gemini CLI** to work on the same project at the same time, and spends the expensive one only when it has to.

You open a project, create a tab and describe a task. A *council* of cheap models votes on how hard the task is. The task goes to the cheapest worker that can handle it: Gemini for easy, Codex for medium, Claude for hard (all configurable). The worker edits your checkout directly, follows the project's own `CLAUDE.md`, `AGENTS.md` or `GEMINI.md`, and commits nothing; you review the result in your editor or git. Council works out by itself how each CLI is paid for (a subscription or an API key), shows the usage windows a subscription reports and what each provider has cost this month, and keeps model prices up to date from public price lists.

Everything runs on your machine and talks to the CLIs you already have installed and signed in. Nothing leaves your machine except what those CLIs send to their vendors.

## How a tab works

1. **Describe** the task in a new tab. Pick *Auto* to let the council route it, or pick a model yourself from the model picker (each provider's models, cheapest first, with their prices). Choose *Ask me* or *Auto* for permissions (see below).
2. **Vote.** Each council seat (by default Gemini Flash, a small Codex model and Claude Haiku) is asked, without tools, to rate the task's complexity and name the cheapest model on the ladder of set-up models that it is confident can do it. The model most seats named wins, a tie goes to the stronger one, and unsure seats move the pick one rung up. The vote card shows every seat's pick, complexity rating, confidence, reason and cost.
3. **Start.** The task goes to the chosen model. If that provider's subscription has used up a usage window (or, for an API key, an optional monthly cap is reached), or its CLI is missing or not signed in, the pick moves to the nearest usable rung and the card says so. You can override the pick before starting, or turn on *auto-start* in Settings.
4. **Work.** The worker runs in your project checkout. Its output, tool calls and cost stream into the tab. In *Ask me* mode a Claude worker stops before running a command and the tab shows an approval card (see Permissions). Follow-up messages resume the same CLI session. Nothing is committed; the changes sit in your working copy like edits you made yourself. Two tabs editing the same files at the same time can collide, so give parallel tabs separate areas of the code.
5. **Escalate or switch.** If the worker fails, the task is handed one rung up the ladder with a short summary of what was tried and the uncommitted diff so far (once, automatically; after that it is your call). *Switch worker* does the same to any provider you choose; switching back resumes the earlier session.
6. **Review and close.** Look at the changes in your editor or `git diff`, keep or discard them, and close the tab. Closing stops a running worker and leaves the checkout as it is.

## Requirements

- Node 24 or newer.
- git.
- The CLIs you want to use, installed and signed in on this machine:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then set `ANTHROPIC_API_KEY` or run `claude` once and sign in.
  - Codex CLI: `npm install -g @openai/codex`, then set `CODEX_API_KEY` (or `OPENAI_API_KEY`) or run `codex login`.
  - Gemini CLI: `npm install -g @google/gemini-cli`, then set `GEMINI_API_KEY` or run `gemini` once and sign in. Google Workspace accounts also need `GOOGLE_CLOUD_PROJECT`.

Settings › Advanced has a CLI health panel that shows what Council can see of each CLI.

## Install and run

```bash
npm install
npm run build
npm start
```

Then open <http://localhost:4317>. Set `PORT` to use another port. During development `npm run dev` runs the server with reload and the client with Vite on <http://localhost:5173>.

Council keeps its data in `~/.council` (`settings.json` with only what you changed, `pricing.json` with the fetched prices and any overrides, `usage.json` with each provider's detected plan and last usage windows, `ledger.jsonl`, and one folder per project with its tabs). Set `COUNCIL_HOME` to put it elsewhere.

## One, two or three CLIs

Council works with whatever is installed and signed in. The models of every set-up provider form one ladder, cheapest first (prices from the fetched table; the per-provider lists are curated in `server/src/config/models.ts`). There is no fixed "easy goes to X" table: each council seat sees the task and that ladder, rates the complexity, and names the cheapest model it is confident can do the job. The model most seats named wins, a tie goes to the stronger one, and if the seats were unsure on average the pick moves one rung up. Escalation climbs the same ladder one rung at a time. With one provider its cheapest model votes alone and the ladder is that provider's own models (for Claude: Haiku, Sonnet, Opus, Fable); with none, the app shows the setup panel instead of a composer. The vote card shows every seat's pick, confidence and reason, and the pickers only offer providers that are set up.

## Plans, usage and prices

Nothing here needs entering. Council detects, per provider:

- **How it is paid for.** Claude: the `apiKeySource` of each run's init event (`none` means the signed-in subscription), and before any run, `ANTHROPIC_API_KEY` in the environment or a sign-in. Codex: `codex login status` (ChatGPT plan or API key) and the plan named in its rate-limit snapshots. Gemini: `GEMINI_API_KEY` / `GOOGLE_API_KEY` or Vertex settings mean pay per use; a Google sign-in means the account's Gemini Code Assist quota.
- **Usage windows.** Claude Code reports the five-hour and seven-day windows in every run; Codex attaches rate-limit snapshots. They show in the sidebar and in Settings › Plan & usage with the time to reset. A subscription turns amber at 80% of its fullest window and, at 100%, auto routing goes around it until the window resets. Gemini CLI reports no quota, so only its spend shows.
- **Spend this month.** Every CLI run, votes and hand-off summaries included, is appended to `ledger.jsonl`. Claude Code reports its own cost; on a subscription that is the list-price equivalent, not money leaving your account. Codex and Gemini report tokens, which Council prices.

*Refresh usage* in Settings sends one tiny request to Claude and to Codex (each capped, a fraction of a cent, ledgered as `probe`) to read fresh windows without waiting for the next task.

**Prices** come from two public, keyless lists: LiteLLM's `model_prices_and_context_window.json` first, OpenRouter's model list for anything LiteLLM lacks. They are fetched at startup when the cached copy is older than seven days, and on *Refresh prices* in Settings; offline, the prices seeded in the code (October 2026) apply. Council's short names (`flash`, `pro`, `flash-lite`, provider defaults) follow the real model they stand for. A wrong or missing price can be overridden under Settings › Advanced.

An API key has no remaining-credit figure to read, so for those Settings › Advanced has an optional **monthly spend cap** per provider; when reached, auto routing goes around that provider. It does not apply to a subscription.

## Permissions: Ask me or Auto

Each tab runs in one of two modes, chosen in the composer; new tabs start in the mode set in Settings (default *Ask me*).

- **Ask me.** Claude workers edit files freely and ask before anything else: Council passes Claude Code a small MCP permission tool (`server/src/mcp/permission-tool.ts`, via `--permission-prompt-tool`), which forwards each request to the tab. The tab moves to *Needs you* and shows an approval card: *Allow once*, *Allow for this tab* (remembers the command's program and subcommand, such as `npm test …`, or the tool), or *Deny*, which tells Claude why. Codex and Gemini cannot ask when headless: Codex edits and runs commands inside its workspace-write sandbox, Gemini applies edits and skips anything else that needs approval.
- **Auto.** No prompts and no sandbox: Claude `--dangerously-skip-permissions`, Codex without its sandbox, Gemini `--approval-mode yolo`. Switching a tab to Auto also answers a waiting request.

## Settings worth knowing

The page keeps to what is yours to decide; everything else is detected or sits under *Advanced*.

- **Council seats** – one to nine cheap models that judge each task and name the worker. Every task pays for every seat. The ladder they pick from is shown underneath.
- **Permissions for new tabs** – *Ask me* or *Auto*, as above.
- **Auto-start / auto-escalate** – whether to skip the pause after a vote, and whether a failed worker escalates once by itself.
- **Plan & usage** and the **prices** line – what was detected, with *Refresh usage* and *Refresh prices*.
- **Advanced** – spend caps for API-key accounts, the warning threshold and month start, seat timeout, per-vote ceiling, stall minutes, price overrides, CLI health.

## Known limits

- Council seats are tool-less only on Claude. Codex and Gemini seats are *asked* not to read files and are cut off after 60 seconds, but a chatty seat can still spend more than the per-vote ceiling; the vote card flags it.
- Sign-in detection is a heuristic (API key in the environment, a stored login file, `codex login status`). A provider can look signed in and still fail, for example a Google Workspace account without `GOOGLE_CLOUD_PROJECT`; the failure shows in the transcript and escalation takes over.
- Plan detection is exact for Claude once a run has happened (before that it is a guess from the sign-in). For Codex it relies on `codex login status` wording and on the rate-limit snapshot naming the plan; for Gemini it reads the environment and the auth type in `~/.gemini/settings.json`, and a Google sign-in may be a free or a paid Code Assist tier, which the CLI does not say.
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
