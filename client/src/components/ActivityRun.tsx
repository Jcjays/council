import { useState } from 'react';
import { runLabel, type ActivityBlock } from '../lib/activity';
import { ToolCall } from './ToolCall';

interface Props {
  block: Extract<ActivityBlock, { kind: 'run' }>;
  pathBase?: string | null;
}

/** A run of consecutive tool calls folded behind one summary line; opens itself while a call is still running or after a failure. */
export function ActivityRun({ block, pathBase }: Props) {
  const [manual, setManual] = useState<boolean | null>(null);
  const s = block.summary;
  if (block.items.length === 1 && block.items[0]) {
    return (
      <div className="run">
        <ToolCall item={block.items[0]} pathBase={pathBase} />
      </div>
    );
  }
  const open = manual ?? (s.running > 0 || s.failed > 0);
  return (
    <div className="run">
      <button className="run-head" onClick={() => setManual(!open)} aria-expanded={open}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="n">{runLabel(s)}</span>
        {(s.added > 0 || s.removed > 0) && (
          <span className="mono">
            {s.added > 0 && <span className="add">+{s.added}</span>} {s.removed > 0 && <span className="del">−{s.removed}</span>}
          </span>
        )}
        {s.running > 0 && (
          <span className="spin" title="A tool call is still running">
            ●
          </span>
        )}
      </button>
      {open && block.items.map((it) => <ToolCall key={it.id} item={it} pathBase={pathBase} />)}
    </div>
  );
}
