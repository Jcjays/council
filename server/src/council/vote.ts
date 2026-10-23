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

function toVote(value: unknown): Vote | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)) return null;
  if (typeof v.complexity !== 'number' || !Number.isFinite(v.complexity)) return null;
  const rawConfidence = v.confidence;
  const rawComplexity = Math.round(v.complexity);
  return {
    confidence: Math.min(1, Math.max(0, rawConfidence)),
    complexity: Math.min(5, Math.max(1, rawComplexity)),
    reason: typeof v.reason === 'string' ? v.reason : '',
  };
}

/** Index of the brace closing the object that opens at `start`, or -1. Skips string literals. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function* jsonCandidates(text: string): Generator<string> {
  const trimmed = text.trim();
  if (trimmed !== '') yield trimmed;
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    if (m[1]) yield m[1].trim();
  }
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const end = matchBrace(text, i);
    if (end > i) yield text.slice(i, end + 1);
  }
}

/** Finds a vote in raw JSON, fenced JSON, or JSON embedded in prose. */
export function extractVote(text: string): Vote | null {
  for (const candidate of jsonCandidates(text)) {
    try {
      const vote = toVote(JSON.parse(candidate));
      if (vote) return vote;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
