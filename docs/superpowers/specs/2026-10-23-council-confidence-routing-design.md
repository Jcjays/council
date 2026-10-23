# Council — Confidence-Based Routing & Worker Seats Design

Date: 2026-10-23
Status: Approved design, ready for implementation planning

## Context & Motivation

Council previously mapped tasks into three static difficulty tiers: **Easy**, **Medium**, and **Hard**, which were assigned to workers via a fixed `tierMap` setting ("Who does what (Worker Tiers)").

This design had major flaws:
1. **Bias & Rigidity:** Hardcoded definitions of what counts as easy/medium/hard biased routing decisions regardless of the actual capabilities and nuance of modern models.
2. **Redundant Configurations:** Users had to configure two separate things: council voting seats (models that evaluate the task) AND worker tiers (`tierMap`: easy → model A, medium → model B, hard → model C).
3. **Artificial Categorization:** Models were forced to pick a coarse bucket ("easy", "medium", "hard") rather than analyzing the task directly and reporting their own confidence and estimated complexity.

This specification replaces fixed difficulty tiers with **Confidence-Based Council Routing**:
- Configured council seats serve as both the evaluators and the worker pool.
- Each model analyzes the task text and repo snapshot, returning quantitative metrics (`confidence`: 0..1, `complexity`: 1..5, `reason`: string).
- The router selects the **cheapest seat that is confident** ($\ge 80\%$) in its ability to execute the task. If no model reaches 80% confidence, the task routes to the **strongest reasoning seat**.

---

## Core Architectural Changes

### 1. Data Models & Schemas

#### Settings Schema (`Settings`)
- **Remove:** `tierMap: TierMap`
- **Retain & Elevate:** `seats: Seat[]` (default 3 seats across available providers)
- Legacy migration: existing `settings.json` files with `tierMap` will ignore the field on load without error.

#### Seat Vote Schema (`Vote`)
Instead of `{ "tier": "easy" | "medium" | "hard", "confidence": number, "reason": string }`, seats emit:
```json
{
  "type": "object",
  "properties": {
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "complexity": { "type": "integer", "minimum": 1, "maximum": 5 },
    "reason": { "type": "string" }
  },
  "required": ["confidence", "complexity", "reason"],
  "additionalProperties": false
}
```

#### Council Result (`CouncilResult`)
```ts
export interface SeatEvaluation {
  seat: Seat;
  vote: Vote | null;
  costUsd: number;
  durationMs: number;
  error?: string;
  overCeiling: boolean;
  text?: string;
}

export interface CouncilResult {
  seats: SeatEvaluation[];
  selectedSeat: Seat;
  confidence: number;
  complexity: number;
  reason: string;
  isFallback: boolean; // true if no seat reached 80% confidence
}
```

#### Tab State (`Tab`)
- **Remove:** `tab.tier: 'easy' | 'medium' | 'hard' | null`
- **Add:**
  - `tab.complexity?: number` (assessed task complexity, 1–5)
  - `tab.confidence?: number` (winner's confidence score, 0..1)
  - `tab.worker`: winning seat (`{ provider, model, sessionId }`)

---

## Routing & Escalation Logic

### 1. Model Evaluation Prompt (`buildVotePrompt`)
The prompt no longer defines easy/medium/hard tiers. Instead:
- Informs the seat that it is evaluating whether it can handle the given task efficiently and accurately.
- Rules: tool-less, evaluate solely from `<snapshot>` and `<task>`.
- Complexity scale:
  - `1`: simple query, docs lookup, single-file copy/typo/config fix, trivial test.
  - `2`: minor feature or targeted bug fix in 1–2 files with known cause.
  - `3`: multi-file feature, module refactoring, standard API endpoint.
  - `4`: cross-cutting multi-file changes, tricky debugging, concurrent flows.
  - `5`: major system redesign, obscure architectural overhaul, security/concurrency critical.
- Required JSON output: `{ "confidence": 0.0..1.0, "complexity": 1..5, "reason": "one sentence" }`.

### 2. Candidate Seat Ranking & Selection (`route`)
Council seats are ranked from **cheapest to strongest**:
1. Ranking by model token pricing (from `pricing.ts` lookup or provider default costs). If prices are identical, provider order defaults to `['gemini', 'codex', 'claude']`.
2. Filter seats:
   - Must be installed and signed in (`availableProviders`).
   - Budget must not be exhausted (`!budgets[p]?.exhausted`).
3. Selection algorithm:
   - Identify candidate seats whose self-reported `confidence >= 0.80`.
   - If one or more confident seats exist: pick the **lowest-cost confident seat**.
   - If no seat reached 0.80 confidence: pick the **strongest/highest-capacity seat** among available seats (flagged with `isFallback: true`).
   - If all providers are exhausted: keep the cheapest available seat with an explicit exhaustion warning.

### 3. Escalation Ladder
When a worker encounters a hard error, stalls, or the user clicks "Escalate":
- Escalation steps to the next **stronger seat** in the sorted council pool.
- `canEscalate` is `true` as long as there is a stronger seat remaining in the council roster.

---

## User Interface & Experience

### 1. Settings View (`Settings.tsx`)
- Remove the **"Who does what (Worker Tiers)"** card.
- Retain the **"Council Seats"** section: users directly choose which seats constitute their council and worker pool.
- Retain Auto-Detected Model Ladders and Health cards for model discovery.

### 2. Vote Card (`VoteCard.tsx`)
- Remove colored tier tags (`tier-easy`, `tier-medium`, `tier-hard`) and "Consensus: [tier]" badges.
- Display each seat's assessment:
  - Model name & provider glyph
  - Confidence percentage (e.g., `92% confident`)
  - Complexity indicator (e.g., `Complexity 2/5`)
  - One-line technical justification (`reason`)
- Display the selection summary banner:
  - E.g.: `Selected Gemini Flash — confident (92% ≥ 80%) at lowest cost`
  - E.g.: `Selected Claude Sonnet — no seat reached 80% confidence, routed to deep reasoning model`

### 3. Tab View & Inspector (`TabView.tsx`, `Details.tsx`, `Sidebar.tsx`)
- Replace the tier tag with:
  - Selected worker model chip.
  - Complexity indicator chip (`C:2` or `Complexity 2/5`).
- Keep the Escalate button active whenever a stronger council seat is available.

---

## Testing & Verification Plan

1. **Vote Extraction (`vote.test.ts`):**
   - Verify parsing of `{ confidence, complexity, reason }` in raw JSON, markdown fences, and embedded prose.
   - Verify clamping of confidence (`0..1`) and complexity (`1..5`).
2. **Routing & Selection (`routing.test.ts`):**
   - Verify lowest-cost seat selected when multiple seats have $\ge 0.80$ confidence.
   - Verify strongest seat selected when all seats have $< 0.80$ confidence.
   - Verify budget exhaustion rerouting and fallback.
   - Verify escalation picks the next stronger seat.
3. **Effective Routing (`effective.test.ts`):**
   - Verify available seats filtering when CLIs are missing or signed out.
4. **Engine Lifecycle (`engine.test.ts`):**
   - Verify full council voting, selection, worker execution, and escalation in mock environment.
5. **Settings Validation (`settings.test.ts`):**
   - Verify saving and loading without `tierMap`, backward compatibility with legacy settings.
6. **Client Build & Tests (`client/`):**
   - Run Vitest suite on client helpers and compile with `npm run build`.
