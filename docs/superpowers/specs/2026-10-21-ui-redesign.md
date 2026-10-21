# Council UI redesign

Date: 2026-10-21. Builder: Claude (session silly-bohr). Status: proposal, built on while Chris reviews.

Chris asked: "work on its UI. Get ideas from these projects: Hydra and agent-orchestrator." This file records
which ideas transfer and why, the design that follows from them, and what stays as it is.

Reference material: a static mockup of the proposed screens in light and dark is next to this file,
`2026-10-21-ui-redesign-mockup.html` (open it in a browser). The earlier product design is
`2026-10-20-council-design.md`; nothing here changes the server, its REST API or WebSocket messages.

Revised later the same day after two pieces of feedback from Chris:

- **No worktrees, branches or merges in the UI.** Workers edit the project checkout directly, commit nothing, and
  follow the project's CLAUDE.md / AGENTS.md / GEMINI.md; the developer reviews the changes in their editor or git.
  The branch chips, Merge and rebase buttons, the "remove the worktree" option and the details pane's Branch section
  are gone (the mockup still shows them; it predates this). The third step reads "Review".
- **Settings is one simple page.** Monthly budgets, who does what, council seats and the two toggles; everything else
  (warn %, reset day, seat timeout, cost ceiling, stall minutes, allowed commands, model lists, prices, CLI health)
  sits behind a collapsed Advanced section. The save bar shows "Unsaved changes" and tints amber until Save.

## What the two projects do, in one line each

- **Hydra** (mikecubed/Hydra, fork of PrimeLocus/Hydra): an event-sourced daemon that routes prompts to Gemini, Codex,
  Claude Code and Copilot CLIs with per-task worktrees and token budgets. Its main UX is a terminal REPL with a status
  bar; the web UI is a dark-only, inline-styled "operator surface" (React 19, no CSS files, no component library).
- **agent-orchestrator** (OrchestratorInc): a desktop control plane for 30+ coding agents. Go daemon, Electron + React 19,
  Tailwind v4 + shadcn, a four-column board (Working / Needs you / In review / Ready to merge), an inspector pane,
  a written DESIGN.md with explicit rules, and a large keyboard map.

Council sits between them: a single developer, three CLIs, a handful of tabs. It needs the "many agents at a glance"
clarity of agent-orchestrator and the per-agent cost and identity signals Hydra puts in its status bar, without a
board (Council tabs are not a backlog) and without a component library.

## Ideas that transfer, and why

### From agent-orchestrator

1. **Two signals on one dot: colour is the lane, pulse is activity.** AO's sidebar dot takes its colour from the board
   column and pulses only while the agent is producing output. Council's tab list gets the same split: colour says
   *whose turn it is* (working / needs you / done / failed / draft), the pulse says *the CLI is streaming right now*.
   Why: with three tabs running, the question is "which one needs me", not "which one is running".
2. **Attention zones instead of a flat list.** AO groups by "Needs you" first. Council's sidebar groups tabs into
   *Needs you* (vote ready to start, worker idle after a turn, failed, stalled, merge blocked or conflicted),
   *Working* (voting, running, handing off), *Drafts* and *Done* (merged). Closed tabs collapse into a bottom
   "Closed · N" bar (AO's archive bar) instead of a "show closed" checkbox.
3. **Derived status phrases.** AO renders "Awaiting PR", "Fixing CI failures" rather than raw enum names. Council tab
   rows show "Council voting…", "Ready to start", "Working for 2m", "Your turn", "No output for 10 min", "Merged".
4. **Attention pulse on cards.** A slow background tint pulse on rows in *Needs you*; subtle, 3.5 s, no motion of layout.
5. **Collapsed activity runs.** AO folds consecutive tool calls into one line ("Explored 4 tool calls · 2 files changed
   +12 −3") that auto-opens while output streams. Council's transcript does the same for runs of `tool` items between
   assistant text, with a per-run summary (files edited, commands run, failures) and the diff totals.
6. **Tool calls rendered by kind, not as JSON.** Commands show the command line and a streaming output pane; file
   edits show the path and an inline unified diff; reads and searches are quiet one-liners. Council's three CLIs emit
   different tool names (`Edit`/`Write`/`Bash` from Claude, `replace`/`write_file`/`run_shell_command` from Gemini,
   `command_execution`/`file_change` from Codex); a pure classifier maps all of them to one vocabulary.
7. **Inspector pane.** AO keeps the chat clean and puts branch, PR, files and usage in a collapsible right pane. Council
   gets a *Details* pane: worker and session, routing (tier, shifted-from, hand-off history), branch and worktree with
   the last merge outcome and the merge actions, cost of the tab (work vs. council votes), and files touched (derived
   from the transcript's edit tools; the server has no diff endpoint and this version does not add one).
8. **Keyboard map and a help overlay.** Alt is the modifier, because a web page cannot override the Ctrl chords
   browsers keep for themselves (Ctrl+N, Ctrl+Shift+I). Alt+N new tab, Alt+S settings, Alt+↓ / ↑ next and previous
   tab, Alt+Shift+↓ / ↑ next and previous tab that needs you, Alt+1…9 jump to a tab, Alt+I toggle details,
   Alt+/ shortcut help, Esc closes overlays, Enter sends and Shift+Enter breaks a line (unchanged). The URL hash
   (`#tab=<id>`, `#settings`) follows the selection so a reload lands on the same place.
9. **Visual rules from DESIGN.md.** Colour is semantic and never the only signal; one status slot per row; sentence
   case; 1 px hairlines; no gradients or glass; tabular numbers; weights 500/600 only; 4 px spacing scale;
   120–150 ms motion. Light and dark as first-class themes with a manual override (system / light / dark).
10. **Honest cost copy.** AO labels estimates "calculated using published API list prices". Council's Codex and Gemini
    costs are table-priced, so the cost chips say "estimated from the price table" on hover; Claude's say "reported by
    Claude Code".
11. **Empty states that explain.** A "Get started" home (open a checkout, recent projects as rows with relative time)
    and a "What should the council work on?" draft view with the three steps (vote → route → worktree) spelled out.

### From Hydra

1. **Agent identity: brand colour plus glyph.** Hydra's terminal paints Gemini cyan ✦, Codex green ֎, Claude orange ❋.
   Council uses one glyph and colour per provider everywhere a worker appears: tab rows, header, vote seats, budget
   bars, composer route picker, settings. The design spec asked for "worker icons"; this is them, with no icon library.
2. **Per-agent elapsed time and counts in the status line.** Hydra's status bar shows each agent's elapsed timer and
   step counter. Council shows "Working for 2m 14s" on running tabs and a tool-call count on the activity run.
3. **Cost and tokens side by side.** Hydra shows `$cost` with `K`/`M` token counts; Council's result line becomes
   "Finished · 12.3K in · 480 out · $0.021" and the budget bars keep dollars.
4. **Risk-signal chips.** Hydra attaches typed chips (budget / health / waiting / stale × severity) to queue cards.
   Council's tab rows and header carry chips for *stalled*, *conflict*, *blocked*, *full auto*, *routed around* (budget
   or health shifted the tier), each with a tone.
5. **Every empty panel says why.** Hydra's empty-state card distinguishes loading, daemon unavailable, idle and no
   matches. Council's sidebar, transcript and details pane each say which of "no project", "no tabs", "reconnecting"
   or "nothing yet" applies, and the reconnect banner appears only when the socket is down.
6. **Budget bars split work from routing.** Hydra shows used/limit with a normal/warning/exceeded badge. Council keeps
   its bars and draws the council-vote share as a lighter segment, with the exact split in the tooltip.

### Considered and not taken

- A kanban board (AO). Council tabs are conversations, not cards in a backlog; grouping the list is enough.
- Fourteen colour palettes (AO). One light and one dark theme.
- Markdown with syntax highlighting and mermaid (AO uses react-markdown, lowlight, mermaid). Council renders a small,
  safe subset itself (headings, lists, paragraphs, inline code, bold, fenced code) to keep the stack dependency-free.
- A diff library (AO uses @pierre/diffs). Council has no server diff endpoint; the inline diffs are the edit tool's
  old/new strings, which a short line-diff helper handles.
- Token budgets and a council-of-critique mode (Hydra). Out of scope; Council budgets dollars and the council only routes.
- Approval prompt cards (Hydra). Council's workers run with the CLIs' own permission modes; denials arrive as system lines.

## The design

### Layout

Three columns at ≥1200 px: **sidebar** (272 px) · **main** · **details** (300 px, collapsible, remembered).
Below 1200 px the details pane overlays; below 800 px the sidebar stacks above the main pane.

**Sidebar**, top to bottom: brand row (wordmark, connection dot, theme toggle, settings); project picker (name,
default branch, "change" reveals the path field and recent projects); "New tab" button; the grouped tab list;
budget bars; a footer line "2 working · 1 needs you".

**Tab view**: header (title, status pill, tier badge, worker chip, branch, cost, chips) with actions
(Merge primary when settled with a worktree; Escalate, Switch, Close quiet; Details toggle). Alerts (stall,
merge outcome) as one card each with their actions inline. Vote card: expanded while awaiting start; a one-line
summary that expands afterwards. Transcript with the rendering above; auto-scroll only while the reader is at the
bottom, with a "Jump to latest" pill otherwise. Composer with a segmented route picker (Auto · ✦ Gemini · ֎ Codex ·
❋ Claude), a model field, a Full-auto switch with a warning tone, and the status hint when sending is not possible.

**Settings**: a left section nav (Health, Budgets, Council seats, Routing, Permissions, Models, Prices), one card per
section, a sticky save bar that says when there are unsaved changes. Health as three provider cards with
installed / version / auth badges and the install or sign-in hint in a copyable code line.

### Visual system

Tokens in `styles.css` on `:root`, light values first and dark through `light-dark()` so a `data-theme` attribute
(system / light / dark, stored in localStorage) or the OS preference selects the scheme.
Type: Inter when installed, else the system UI font; 13 px base; 11/12/13/15/18 px scale; 500/600 weights;
tabular numerals; a monospace stack for code, branches and paths. Radii 4/6/8/12 px. Spacing 4 px.
Semantic colours: accent blue, ok green, warn amber, danger red, merged violet; tiers easy/medium/hard reuse
green/amber/red; providers Gemini blue, Codex green, Claude terracotta.

### What stays

Every capability of the current client: project picker; tabs; vote card with override before start; streaming
transcript; collapsible tool calls; budgets with the routing-spend tooltip; settings with seats, tier map, pricing
table and health; the stall prompt with Escalate / Keep waiting and the follow-up worker selector that the
concurrent review-fix branch adds (its pure helpers are reused as they are). `api.ts`, `useSocket.ts`, `types.ts` keep
their shapes; `format.ts` keeps its functions.

### Pure helpers (each with Vitest tests)

- `lib/lanes.ts` — tab → lane (needs-you / working / draft / done / closed), status phrase, attention chips,
  grouping and ordering, next/previous tab needing attention.
- `lib/tools.ts` — tool name + input → kind (command / edit / write / read / search / file-change / web / mcp / other),
  title, path, command; files touched by a transcript.
- `lib/diff.ts` — line diff of old/new strings → unified hunks with add/del counts.
- `lib/activity.ts` — transcript → blocks (single items and runs of tool calls with a summary).
- `lib/markdown.ts` — text → block list (heading, paragraph, list, code, with inline code/bold/italic/link spans).
- `lib/shortcuts.ts` — keyboard event → action name.
- `lib/format.ts` — adds `formatTokens`, `relativeTime`, `elapsed`.
- `lib/theme.ts` — preference read/write and resolution.

### Implementation order (one commit each)

1. Tokens, theme switch, type scale, base controls; app shell with the three columns.
2. Sidebar: project picker, grouped tab list with lanes, chips and relative time, budgets with the split bar, footer.
3. Transcript: markdown-lite, tool classifier, diffs, activity runs, result line, scroll pinning.
4. Tab view: header, alerts, vote card with collapsed summary, composer with segmented routing, details pane.
5. Settings and health.
6. Keyboard shortcuts, help overlay, home and empty states.
7. Browser verification and screenshots in both themes; final notes.

### Verification

`npm test` (server 176, client tests grow with the helpers) and `npm -w client run build` stay green. The app is
driven in the browser pane against a server on port 4318 with an isolated `COUNCIL_HOME` and a scratch git repo:
home, draft, vote card, streaming transcript with tool calls, settings, in light and dark, at 1440 px and 1000 px.
