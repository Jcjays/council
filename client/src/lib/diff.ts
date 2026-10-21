/**
 * A small line diff for the edit tools' old/new strings. Council has no diff
 * endpoint on the server; what the transcript shows is what the worker asked
 * the CLI to change, which is enough to review an edit at a glance.
 */
export interface DiffLine {
  t: 'ctx' | 'add' | 'del' | 'gap';
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the inputs were too large for a real diff and the whole text is shown as removed then added. */
  approximate: boolean;
}

function splitLines(s: string): string[] {
  if (s === '') return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Op = { t: 'ctx' | 'add' | 'del'; text: string };

/** Longest-common-subsequence alignment of two line arrays. */
function align(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i]!;
    const next = lcs[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ t: 'del', text: a[i]! });
      i++;
    } else {
      ops.push({ t: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ t: 'del', text: a[i++]! });
  while (j < m) ops.push({ t: 'add', text: b[j++]! });
  return ops;
}

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs into one gap line. */
function fold(ops: Op[], context: number): DiffLine[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.t === 'ctx') return;
    for (let d = -context; d <= context; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < ops.length) keep[idx] = true;
    }
  });
  const out: DiffLine[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden > 0) out.push({ t: 'gap', text: `… ${hidden} unchanged line${hidden === 1 ? '' : 's'} …` });
    hidden = 0;
  };
  ops.forEach((op, k) => {
    if (keep[k]) {
      flush();
      out.push({ t: op.t, text: op.text });
    } else hidden++;
  });
  flush();
  return out;
}

/**
 * Diff `before` against `after` line by line. Inputs beyond `maxLines` lines
 * on either side are shown as a whole removal followed by a whole addition.
 */
export function lineDiff(before: string, after: string, context = 2, maxLines = 400): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  let ops: Op[];
  let approximate = false;
  if (a.length > maxLines || b.length > maxLines) {
    approximate = true;
    ops = [...a.map((text): Op => ({ t: 'del', text })), ...b.map((text): Op => ({ t: 'add', text }))];
  } else {
    ops = align(a, b);
  }
  const added = ops.filter((o) => o.t === 'add').length;
  const removed = ops.filter((o) => o.t === 'del').length;
  return { lines: fold(ops, context), added, removed, approximate };
}
