import { useEffect, useRef } from 'react';
import { formatUsd, shortTime } from '../lib/format';
import type { TranscriptItem, Usage } from '../types';

function pretty(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ResultLine({ item }: { item: TranscriptItem }) {
  const d = (item.data ?? {}) as { usage?: Usage; costUsd?: number; exitCode?: number; isError?: boolean };
  return (
    <div className={`item item-result ${d.isError ? 'item-error' : ''}`}>
      <span>{d.isError ? 'Worker failed' : 'Worker finished'}</span>
      <span className="muted small">
        {d.usage ? ` ${d.usage.inputTokens + d.usage.cachedInputTokens} in / ${d.usage.outputTokens} out` : ''}
        {typeof d.costUsd === 'number' ? ` · ${formatUsd(d.costUsd)}` : ''}
        {typeof d.exitCode === 'number' && d.exitCode !== 0 ? ` · exit ${d.exitCode}` : ''}
      </span>
      {d.isError && item.text && <pre className="small">{item.text}</pre>}
    </div>
  );
}

export function Transcript({ items }: { items: TranscriptItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length, items.at(-1)?.text]);

  return (
    <div className="transcript">
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} className="item item-user">
                <div className="bubble">{item.text}</div>
                <span className="muted small">{shortTime(item.ts)}</span>
              </div>
            );
          case 'assistant':
            return (
              <div key={item.id} className="item item-assistant">
                <pre className="prose">{item.text}</pre>
              </div>
            );
          case 'tool':
            return (
              <details key={item.id} className={`item item-tool ${item.tool?.isError ? 'item-error' : ''}`}>
                <summary>
                  <code>{item.tool?.name}</code>
                  {item.tool?.output === undefined ? <span className="muted small"> running…</span> : null}
                </summary>
                <pre className="small">{pretty(item.tool?.input)}</pre>
                {item.tool?.output !== undefined && <pre className="small output">{item.tool.output}</pre>}
              </details>
            );
          case 'vote':
            return (
              <div key={item.id} className="item item-system">
                Council voted.
              </div>
            );
          case 'system':
            return (
              <div key={item.id} className="item item-system">
                {item.text}
              </div>
            );
          case 'error':
            return (
              <div key={item.id} className="item item-error">
                {item.text}
              </div>
            );
          case 'result':
            return <ResultLine key={item.id} item={item} />;
          default:
            return null;
        }
      })}
      <div ref={endRef} />
    </div>
  );
}
