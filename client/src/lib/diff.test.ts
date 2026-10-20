import { expect, test } from 'vitest';
import { lineDiff } from './diff';

test('a replaced line shows as del then add with context around it', () => {
  const d = lineDiff('a\nb\nc\nd\ne\n', 'a\nb\nX\nd\ne\n');
  expect(d.added).toBe(1);
  expect(d.removed).toBe(1);
  expect(d.approximate).toBe(false);
  expect(d.lines.map((l) => `${l.t}:${l.text}`)).toEqual(['ctx:a', 'ctx:b', 'del:c', 'add:X', 'ctx:d', 'ctx:e']);
});

test('long unchanged runs fold into a gap line', () => {
  const before = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 10', 'changed');
  const d = lineDiff(before, after, 1);
  expect(d.lines[0]).toEqual({ t: 'gap', text: '… 9 unchanged lines …' });
  expect(d.lines.slice(1).map((l) => l.t)).toEqual(['ctx', 'del', 'add', 'ctx']);
});

test('a new file is all additions and an empty diff is empty', () => {
  const d = lineDiff('', 'one\ntwo');
  expect(d.lines.map((l) => l.t)).toEqual(['add', 'add']);
  expect(d.added).toBe(2);
  expect(lineDiff('', '').lines).toEqual([]);
});

test('identical inputs produce a single gap', () => {
  const d = lineDiff('a\nb\nc', 'a\nb\nc');
  expect(d.lines).toEqual([{ t: 'gap', text: '… 3 unchanged lines …' }]);
  expect(d.added + d.removed).toBe(0);
});

test('insertions and deletions are aligned', () => {
  const d = lineDiff('a\nc', 'a\nb\nc');
  expect(d.lines.map((l) => `${l.t}:${l.text}`)).toEqual(['ctx:a', 'add:b', 'ctx:c']);
  const e = lineDiff('a\nb\nc', 'a\nc');
  expect(e.lines.map((l) => `${l.t}:${l.text}`)).toEqual(['ctx:a', 'del:b', 'ctx:c']);
});

test('oversized inputs fall back to remove-all then add-all', () => {
  const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
  const d = lineDiff(big, `${big}\nmore`, 2, 400);
  expect(d.approximate).toBe(true);
  expect(d.removed).toBe(500);
  expect(d.added).toBe(501);
});
