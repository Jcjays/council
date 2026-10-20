/** Longest tool input/output string kept in a transcript. */
export const MAX_TOOL_TEXT = 20_000;

/** Keeps the head and tail of an oversized string and says how much was dropped. */
export function clipText(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text;
  const marker = `\n… [${text.length - max} characters omitted] …\n`;
  const budget = Math.max(0, max - marker.length);
  const head = Math.floor(budget * 0.7);
  const tail = budget - head;
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ''}`;
}

/** Clips every string inside a tool input (objects and arrays, to a sane depth). */
export function clipValue(value: unknown, max = MAX_TOOL_TEXT, depth = 0): unknown {
  if (typeof value === 'string') return clipText(value, max);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clipValue(v, max, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clipValue(v, max, depth + 1)]));
}
