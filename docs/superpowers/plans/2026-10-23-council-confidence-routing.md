# Council Confidence-Based Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static Easy/Medium/Hard worker tiers with confidence-based council evaluation where configured council seats assess task complexity, self-score confidence, and the lowest-cost confident seat is assigned.

**Architecture:** Remove `tierMap` across settings, effective routing, and engine state. Update the council evaluation prompt and JSON schema to request `{ confidence: 0..1, complexity: 1..5, reason: string }`. Route by sorting candidate council seats by cost, selecting the lowest-cost seat with $\ge 80\%$ confidence (or falling back to the strongest reasoning seat), and escalations step up the ranked seats. Update client UI to display model confidence, complexity, and rationale without tier badges.

**Tech Stack:** TypeScript, Node.js 24, React 19, Vitest, Vite

**Spec:** `docs/superpowers/specs/2026-10-23-council-confidence-routing-design.md`

## Global Constraints

- No easy/medium/hard tier categorization.
- Seats are the worker candidate pool.
- Confidence threshold is 0.80 (80%).
- Complexity range is 1 to 5.
- Escalation steps up from lower-cost to higher-capability seats.
- Backward compatibility: legacy `settings.json` containing `tierMap` must load cleanly without throwing.

---

### Task 1: Update Vote Schema, Vote Parser & Vote Prompt

**Files:**
- Modify: `server/src/council/prompt.ts`
- Modify: `server/src/council/vote.ts`
- Test: `server/test/vote.test.ts`
- Test: `server/test/prompt.test.ts`

**Interfaces:**
- Produces:
  - `VOTE_JSON_SCHEMA`: `{ type: 'object', properties: { confidence, complexity, reason }, required: [...] }`
  - `Vote`: `{ confidence: number; complexity: number; reason: string }`
  - `extractVote(text: string): Vote | null`
  - `buildVotePrompt(task: string, snapshot: string): string`

- [ ] **Step 1: Write the failing tests in `server/test/vote.test.ts` and `server/test/prompt.test.ts`**

Update `server/test/vote.test.ts` to test confidence (0..1), complexity (1..5), and reason extraction:
```ts
import { test, expect } from 'vitest';
import { extractVote, VOTE_JSON_SCHEMA } from '../src/council/vote.js';

test('schema requires confidence, complexity, and reason', () => {
  expect(VOTE_JSON_SCHEMA).toMatchObject({
    type: 'object',
    required: expect.arrayContaining(['confidence', 'complexity', 'reason']),
  });
});

test('extracts valid vote from json', () => {
  const input = '{"confidence":0.95,"complexity":2,"reason":"simple test"}';
  expect(extractVote(input)).toEqual({ confidence: 0.95, complexity: 2, reason: 'simple test' });
});

test('clamps confidence 0..1 and complexity 1..5', () => {
  const input = '{"confidence":1.5,"complexity":8,"reason":"big"}';
  expect(extractVote(input)).toEqual({ confidence: 1, complexity: 5, reason: 'big' });
});
```

Update `server/test/prompt.test.ts`:
```ts
import { test, expect } from 'vitest';
import { buildVotePrompt } from '../src/council/prompt.js';

test('prompt requests confidence and complexity and does not mention easy/medium/hard tiers', () => {
  const prompt = buildVotePrompt('fix bug', 'tree');
  expect(prompt).toContain('"confidence"');
  expect(prompt).toContain('"complexity"');
  expect(prompt).not.toContain('easy:');
  expect(prompt).not.toContain('medium:');
  expect(prompt).not.toContain('hard:');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server -- vote.test.ts prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `server/src/council/vote.ts` and `server/src/council/prompt.ts`**

Implement the updated schema, interface, and prompt in `server/src/council/vote.ts`:
```ts
export const VOTE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    complexity: { type: 'integer', minimum: 1, maximum: 5 },
    reason: { type: 'string' },
  },
  required: ['confidence', 'complexity', 'reason'],
  additionalProperties: false,
};

export interface Vote {
  confidence: number;
  complexity: number;
  reason: string;
}
```

Implement `buildVotePrompt` in `server/src/council/prompt.ts` with instructions on evaluating complexity (1–5) and confidence (0–1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server -- vote.test.ts prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/council/vote.ts server/src/council/prompt.ts server/test/vote.test.ts server/test/prompt.test.ts
git commit -m "feat(council): update vote schema and prompt to confidence and complexity metrics"
```

---

### Task 2: Implement Confidence-Based Council Routing & Selection Logic

**Files:**
- Modify: `server/src/council/routing.ts`
- Modify: `server/src/council/tally.ts`
- Modify: `server/src/council/council.ts`
- Test: `server/test/routing.test.ts`
- Test: `server/test/tally.test.ts`
- Test: `server/test/council.test.ts`

**Interfaces:**
- Consumes: `Vote`, `Seat`, `PriceTable`
- Produces:
  - `rankSeats(seats: Seat[], pricing: PriceTable): Seat[]`: sorts from lowest cost to highest capability.
  - `selectSeat(seats: SeatEvaluation[], pricing: PriceTable, budgets: Partial<Record<Provider, BudgetState>>, unavailable?: Provider[]): RoutingDecision`:
    ```ts
    export interface RoutingDecision {
      selectedSeat: Seat;
      confidence: number;
      complexity: number;
      reason: string;
      isFallback: boolean;
      exhaustedNotice?: string;
    }
    ```
  - `nextStrongerSeat(current: Seat, seats: Seat[], pricing: PriceTable): Seat | null`

- [ ] **Step 1: Write failing tests in `server/test/routing.test.ts` and `server/test/tally.test.ts`**

Cover:
1. When multiple seats are confident ($\ge 0.80$), the cheapest seat is selected.
2. When no seat is confident ($< 0.80$), the strongest seat is selected as fallback.
3. Rerouting when a provider is exhausted or unavailable.
4. `nextStrongerSeat` for escalation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server -- routing.test.ts tally.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `rankSeats`, `selectSeat`, and `nextStrongerSeat`**

In `server/src/council/routing.ts` and `server/src/council/tally.ts`, calculate estimated cost using `lookupPrice`, rank seats, filter by `confidence >= 0.80`, handle budget exclusions, and select winner.

Update `server/src/council/council.ts`:
Update `SeatResult` and `CouncilResult` to return `selectedSeat`, `confidence`, `complexity`, `reason`, `isFallback`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server -- routing.test.ts tally.test.ts council.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/council/routing.ts server/src/council/tally.ts server/src/council/council.ts server/test/routing.test.ts server/test/tally.test.ts server/test/council.test.ts
git commit -m "feat(council): implement confidence-based seat selection and escalation routing"
```

---

### Task 3: Remove `tierMap` from Settings, Detect, and Effective Routing

**Files:**
- Modify: `server/src/config/settings.ts`
- Modify: `server/src/config/detect.ts`
- Modify: `server/src/council/effective.ts`
- Test: `server/test/settings.test.ts`
- Test: `server/test/effective.test.ts`
- Test: `server/test/http.test.ts`

**Interfaces:**
- `Settings`: remove `tierMap: TierMap`. Keep `seats: Seat[]`.
- `EffectiveRouting`: remove `tierMap`. Expose `available: Provider[]`, `seats: Seat[]`, `notes: string[]`.
- `effectiveRouting(settings, availableProviders)`: filters `seats` by available providers.

- [ ] **Step 1: Update failing tests in `server/test/settings.test.ts` and `server/test/effective.test.ts`**

Assert `DEFAULT_SETTINGS` has `seats` and no `tierMap`.
Assert legacy settings JSON with `tierMap` loads smoothly without error.
Assert `effectiveRouting` returns active `seats`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server -- settings.test.ts effective.test.ts`
Expected: FAIL

- [ ] **Step 3: Remove `tierMap` from settings, detect, and effective**

Update `server/src/config/settings.ts`:
- Remove `tierMap` from `Settings` interface and `DEFAULT_SETTINGS`.
- In `patchSettings` and `validateSettings`, drop `tierMap` and ignore legacy key.

Update `server/src/config/detect.ts`:
- Remove `tierMap` adjustment.

Update `server/src/council/effective.ts`:
- Remove `tierMap` and `clone(map: TierMap)`.
- Return `{ available, seats, notes }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server -- settings.test.ts effective.test.ts http.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/config/settings.ts server/src/config/detect.ts server/src/council/effective.ts server/test/settings.test.ts server/test/effective.test.ts server/test/http.test.ts
git commit -m "refactor(config): remove tierMap and configure council seats directly"
```

---

### Task 4: Update Engine Lifecycle, State & Escalation

**Files:**
- Modify: `server/src/tasks/types.ts`
- Modify: `server/src/tasks/state.ts`
- Modify: `server/src/tasks/store.ts`
- Modify: `server/src/tasks/engine.ts`
- Test: `server/test/state.test.ts`
- Test: `server/test/engine.test.ts`

**Interfaces:**
- `Tab`:
  - Replace `tier: Tier | null` with `complexity?: number; confidence?: number`.
- `prepareHandoff(tab, 'escalate')`:
  - Escalates to `nextStrongerSeat(tab.worker, eff.seats, pricing)`.

- [ ] **Step 1: Update failing tests in `server/test/state.test.ts` and `server/test/engine.test.ts`**

Update tests to check `tab.complexity`, `tab.confidence`, and escalation without `TIER_ORDER`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server -- state.test.ts engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Update engine and tab state**

In `server/src/tasks/types.ts`, `server/src/tasks/state.ts`, and `server/src/tasks/store.ts`:
- Remove `tier`. Add `complexity?: number; confidence?: number`.

In `server/src/tasks/engine.ts`:
- In `runVote`: use `runCouncil` result, assign winner directly to `tab.worker`, set `tab.complexity` and `tab.confidence`.
- In `prepareHandoff`: call `nextStrongerSeat`.

- [ ] **Step 4: Run all server test suites to verify they pass**

Run: `npm test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/tasks/types.ts server/src/tasks/state.ts server/src/tasks/store.ts server/src/tasks/engine.ts server/test/state.test.ts server/test/engine.test.ts
git commit -m "feat(engine): wire confidence-based routing and seat escalation into tab engine"
```

---

### Task 5: Client Types, VoteCard & Settings UI

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/components/VoteCard.tsx`
- Modify: `client/src/components/TabView.tsx`
- Modify: `client/src/components/Details.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/Home.tsx`
- Modify: `client/src/styles.css`
- Test: `client/src/lib/lanes.test.ts`

**Interfaces:**
- Client types matching server's updated `Vote`, `CouncilResult`, `Tab`, `Settings`, `EffectiveRouting`.
- Settings UI: remove "Who does what (Worker Tiers)" card.
- VoteCard UI: display seat confidence %, complexity (1–5), reason, and selected winner banner.

- [ ] **Step 1: Update `client/src/types.ts`**

Remove `Tier`, `TIERS`, `tierMap`.
Update `Vote` to `{ confidence: number; complexity: number; reason: string }`.
Update `CouncilResult` with `selectedSeat`, `confidence`, `complexity`, `reason`, `isFallback`.
Update `Tab` with `complexity?: number; confidence?: number`.

- [ ] **Step 2: Update Settings Component**

In `client/src/components/Settings.tsx`:
- Remove the "Who does what (Worker Tiers)" section.
- Keep "Council Seats" configuration where users select model per seat.

- [ ] **Step 3: Update VoteCard, TabView, Details, and Sidebar**

In `client/src/components/VoteCard.tsx`:
- Show each seat's confidence %, complexity (1–5), and reason.
- Show clear selection banner ("Selected [Model] — confident (XX% ≥ 80%) at lowest cost").

In `client/src/components/TabView.tsx`, `Details.tsx`, `Sidebar.tsx`:
- Show worker model chip and complexity badge instead of tier chip.

- [ ] **Step 4: Run client tests and verify build**

Run: `npm test -w client; npm run build -w client`
Expected: PASS and clean build with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/types.ts client/src/components/Settings.tsx client/src/components/VoteCard.tsx client/src/components/TabView.tsx client/src/components/Details.tsx client/src/components/Sidebar.tsx client/src/components/Home.tsx client/src/styles.css client/src/lib/lanes.test.ts
git commit -m "feat(client): update settings, vote card and tab view for confidence routing"
```

---

### Task 6: Full Integration & End-to-End Verification

**Files:**
- Test: `server/test/e2e.ts`
- Run: whole workspace build & test suites

- [ ] **Step 1: Run full server tests**

Run: `npm test -w server`
Expected: ALL PASS

- [ ] **Step 2: Run full client tests & build**

Run: `npm test -w client; npm run build -w client`
Expected: ALL PASS

- [ ] **Step 3: Verification gate & final commit**

Verify zero compile errors, clean git status, and working build.
