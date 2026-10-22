import { useMemo } from 'react';
import { lineDiff } from '../lib/diff';

/** The old/new strings of an edit tool as a unified diff. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const d = useMemo(() => lineDiff(before, after), [before, after]);
  if (d.lines.length === 0) return <div className="muted xs">No change.</div>;
  return (
    <div className="diff" role="figure" aria-label={`${d.added} added, ${d.removed} removed`}>
      {d.approximate && <div className="h">(too large to align; shown as removed then added)</div>}
      {d.lines.map((l, i) => (
        <div key={i} className={l.t === 'add' ? 'a' : l.t === 'del' ? 'd' : l.t === 'gap' ? 'gap' : ''}>
          {l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : l.t === 'gap' ? '' : '  '}
          {l.text}
        </div>
      ))}
    </div>
  );
}
