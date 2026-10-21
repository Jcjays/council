import { useMemo, useState } from 'react';
import { lineDiff } from '../lib/diff';
import { shortenPath } from '../lib/format';
import { classifyTool } from '../lib/tools';
import type { TranscriptItem } from '../types';
import { DiffView } from './DiffView';

function pretty(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** One tool call: a one-line row by kind, expandable to the diff, the command output or the raw input. */
export function ToolCall({ item, pathBase }: { item: TranscriptItem; pathBase?: string | null }) {
  const tool = item.tool;
  const view = useMemo(() => (tool ? classifyTool(tool) : null), [tool]);
  const subject = view ? shortenPath(view.subject, pathBase) : '';
  const [manual, setManual] = useState<boolean | null>(null);
  if (!tool || !view) return null;

  const running = tool.output === undefined;
  const failed = Boolean(tool.isError);
  const counts = view.edits.reduce(
    (acc, e) => {
      const d = lineDiff(e.before, e.after, 0);
      return { added: acc.added + d.added, removed: acc.removed + d.removed };
    },
    { added: 0, removed: 0 },
  );
  const hasBody = view.kind === 'edit' || view.kind === 'write' || view.kind === 'command' || view.kind === 'file-change' || Boolean(tool.output) || tool.input !== null;
  const open = manual ?? ((view.kind === 'command' && (running || failed)) || failed);

  return (
    <div className={`tool${failed ? ' error' : ''}`}>
      <div className="tool-line">
        <span className="k" aria-hidden>
          {view.glyph}
        </span>
        <span className="verb">{view.verb}</span>
        <span className="subject" title={view.subject}>
          {subject || <span className="muted">(no details)</span>}
        </span>
        {(view.kind === 'edit' || view.kind === 'write') && (counts.added > 0 || counts.removed > 0) && (
          <span className="pm">
            {counts.added > 0 && <span className="add">+{counts.added}</span>}
            {counts.removed > 0 && <span className="del">−{counts.removed}</span>}
          </span>
        )}
        {view.kind === 'command' && (
          <span className={`state ${failed ? 'danger-text' : running ? 'muted' : 'ok-text'}`}>{running ? 'running…' : failed ? 'failed' : 'done'}</span>
        )}
        {view.kind !== 'command' && running && <span className="state muted">running…</span>}
        {view.kind !== 'command' && failed && <span className="state danger-text">failed</span>}
        {hasBody && (
          <button className="quiet sm toggle" onClick={() => setManual(!open)} aria-expanded={open} title={open ? 'Hide details' : 'Show details'}>
            {open ? '▾' : '▸'}
          </button>
        )}
      </div>
      {open && (
        <>
          {(view.kind === 'edit' || view.kind === 'write') && view.edits.map((e, i) => <DiffView key={i} before={e.before} after={e.after} />)}
          {view.kind === 'file-change' && (
            <div className="files">
              {view.changes.map((c, i) => (
                <div key={i} className="file">
                  <span className="muted">{c.kind}</span>
                  <span className="name">{c.path}</span>
                </div>
              ))}
            </div>
          )}
          {view.kind === 'command' && <pre className="out">{tool.output === undefined ? '…' : tool.output || '(no output)'}</pre>}
          {view.kind !== 'edit' && view.kind !== 'write' && view.kind !== 'command' && view.kind !== 'file-change' && tool.input !== null && tool.input !== undefined && (
            <pre className="small">{pretty(tool.input)}</pre>
          )}
          {view.kind !== 'command' && tool.output && <pre className="out">{tool.output}</pre>}
        </>
      )}
    </div>
  );
}
