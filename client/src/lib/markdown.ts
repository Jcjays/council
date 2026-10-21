/**
 * A small, safe subset of Markdown for assistant text: fenced code, headings,
 * bullet and numbered lists, paragraphs; inline code, bold, italic and
 * http(s) links. Everything is parsed into data and rendered as React
 * elements, so no HTML from a model ever reaches the DOM.
 */
export type Span = { t: 'text'; s: string } | { t: 'code'; s: string } | { t: 'strong'; s: string } | { t: 'em'; s: string } | { t: 'link'; s: string; href: string };

export type Block =
  | { t: 'p'; spans: Span[] }
  | { t: 'h'; level: number; spans: Span[] }
  | { t: 'ul'; items: Span[][] }
  | { t: 'ol'; start: number; items: Span[][] }
  | { t: 'code'; lang: string; text: string };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) spans.push({ t: 'text', s: text.slice(last, idx) });
    const [whole, code, strong, em, linkText, href] = m;
    if (code) spans.push({ t: 'code', s: code.slice(1, -1) });
    else if (strong) spans.push({ t: 'strong', s: strong.slice(2, -2) });
    else if (em) spans.push({ t: 'em', s: em.slice(1, -1) });
    else if (linkText && href) spans.push({ t: 'link', s: linkText, href });
    last = idx + whole.length;
  }
  if (last < text.length) spans.push({ t: 'text', s: text.slice(last) });
  return spans;
}

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) blocks.push({ t: 'p', spans: parseInline(para.join('\n')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) body.push(lines[i] ?? ''), i++;
      blocks.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ t: 'h', level: heading[1]?.length ?? 1, spans: parseInline(heading[2] ?? '') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const items: string[] = [];
      let start = numbered ? Number(numbered[1]) : 1;
      const isOl = Boolean(numbered);
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const b = isOl ? NUMBERED.exec(l) : BULLET.exec(l);
        if (b) {
          items.push((isOl ? b[2] : b[1]) ?? '');
          if (isOl && items.length === 1) start = Number(b[1]);
        } else if (l.trim() !== '' && /^\s+/.test(l) && items.length > 0) {
          items[items.length - 1] += `\n${l.trim()}`;
        } else break;
        i++;
      }
      i--;
      const parsed = items.map(parseInline);
      blocks.push(isOl ? { t: 'ol', start, items: parsed } : { t: 'ul', items: parsed });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}
