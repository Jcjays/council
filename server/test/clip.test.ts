import { expect, test } from 'vitest';
import { clipText, clipValue, MAX_TOOL_TEXT } from '../src/tasks/clip.js';

test('short text is returned unchanged', () => {
  expect(clipText('hello')).toBe('hello');
});

test('long text keeps its head and tail and says how much was dropped', () => {
  const long = `${'a'.repeat(30_000)}MIDDLE${'z'.repeat(30_000)}`;
  const clipped = clipText(long, 20_000);
  expect(clipped.length).toBeLessThan(20_500);
  expect(clipped.startsWith('aaaa')).toBe(true);
  expect(clipped.endsWith('zzzz')).toBe(true);
  expect(clipped).not.toContain('MIDDLE');
  expect(clipped).toMatch(/characters omitted/);
});

test('clipValue clips strings nested inside tool inputs and leaves other values alone', () => {
  const input = { file_path: 'a.ts', content: 'x'.repeat(MAX_TOOL_TEXT + 100), nested: { lines: [1, 2, 'y'.repeat(MAX_TOOL_TEXT + 1)] }, n: 3 };
  const out = clipValue(input) as typeof input;
  expect(out.file_path).toBe('a.ts');
  expect(out.content.length).toBeLessThan(MAX_TOOL_TEXT + 100);
  expect((out.nested.lines[2] as string).length).toBeLessThan(MAX_TOOL_TEXT + 1);
  expect(out.n).toBe(3);
});
