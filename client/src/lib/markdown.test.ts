import { expect, test } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

test('inline code, bold, italic and links become spans; the rest stays text', () => {
  expect(parseInline('use `npm test` and **be bold**, *lean*, see [docs](https://x.test/a)')).toEqual([
    { t: 'text', s: 'use ' },
    { t: 'code', s: 'npm test' },
    { t: 'text', s: ' and ' },
    { t: 'strong', s: 'be bold' },
    { t: 'text', s: ', ' },
    { t: 'em', s: 'lean' },
    { t: 'text', s: ', see ' },
    { t: 'link', s: 'docs', href: 'https://x.test/a' },
  ]);
  expect(parseInline('snake_case_name stays and 2 * 3 * 4 too')).toEqual([{ t: 'text', s: 'snake_case_name stays and 2 * 3 * 4 too' }]);
  expect(parseInline('[not a link](javascript:alert(1))')).toEqual([{ t: 'text', s: '[not a link](javascript:alert(1))' }]);
});

test('paragraphs keep their line breaks and split on blank lines', () => {
  expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
    { t: 'p', spans: [{ t: 'text', s: 'one\ntwo' }] },
    { t: 'p', spans: [{ t: 'text', s: 'three' }] },
  ]);
});

test('headings, bullet and numbered lists', () => {
  const blocks = parseMarkdown('## Plan\n- a\n- b `c`\n  continued\n\n3. x\n4. y');
  expect(blocks).toEqual([
    { t: 'h', level: 2, spans: [{ t: 'text', s: 'Plan' }] },
    { t: 'ul', items: [[{ t: 'text', s: 'a' }], [{ t: 'text', s: 'b ' }, { t: 'code', s: 'c' }, { t: 'text', s: '\ncontinued' }]] },
    { t: 'ol', start: 3, items: [[{ t: 'text', s: 'x' }], [{ t: 'text', s: 'y' }]] },
  ]);
});

test('fenced code keeps its text verbatim, with the language, even unterminated', () => {
  expect(parseMarkdown('before\n```ts\nconst a = **1**;\n\n# not a heading\n```\nafter')).toEqual([
    { t: 'p', spans: [{ t: 'text', s: 'before' }] },
    { t: 'code', lang: 'ts', text: 'const a = **1**;\n\n# not a heading' },
    { t: 'p', spans: [{ t: 'text', s: 'after' }] },
  ]);
  expect(parseMarkdown('```\nstill open')).toEqual([{ t: 'code', lang: '', text: 'still open' }]);
});

test('windows line endings and empty input', () => {
  expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2);
  expect(parseMarkdown('')).toEqual([]);
});
