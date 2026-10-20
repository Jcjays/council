# Council

A local app that puts Claude Code, Codex CLI and Gemini CLI to work on one project at the same time. You type a task into a tab; a small council of cheap models votes on how hard it is; the task goes to the cheapest worker that can handle it (Gemini for easy, Codex for medium, Claude for hard). Each tab works in its own git worktree, and spend per provider is tracked against your monthly credit.

Design: `docs/superpowers/specs/2026-10-20-council-design.md`. Implementation plan: `docs/superpowers/plans/2026-10-20-council-implementation.md`.

Status: under construction. Full setup instructions land with the first usable build.

```bash
npm install
npm test
```
