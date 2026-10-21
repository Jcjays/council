import { useMemo, type ReactNode } from 'react';
import { groupActivity } from '../lib/activity';
import { costSource, formatTokens, formatUsd, shortTime, stripAnsi } from '../lib/format';
import type { Provider, TranscriptItem, Usage } from '../types';
import { ActivityRun } from './ActivityRun';
import { Markdown } from './Markdown';

function ResultLine({ item, provider }: { item: TranscriptItem; provider: Provider | null }) {
  const d = (item.data ?? {}) as { usage?: Usage; costUsd?: number; exitCode?: number; isError?: boolean };
  return (
    <div className={`item-result${d.isError ? ' error' : ''}`}>
      <b>{d.isError ? 'Worker failed' : 'Finished'}</b>
      {d.usage && (
        <span title={`${d.usage.inputTokens} input, ${d.usage.cachedInputTokens} cached input, ${d.usage.outputTokens} output tokens`}>
          {formatTokens(d.usage.inputTokens + d.usage.cachedInputTokens)} in · {formatTokens(d.usage.outputTokens)} out
        </span>
      )}
      {typeof d.costUsd === 'number' && (
        <>
          <span className="muted">·</span>
          <span title={costSource(provider)}>{formatUsd(d.costUsd)}</span>
        </>
      )}
      {typeof d.exitCode === 'number' && d.exitCode !== 0 && (
        <>
          <span className="muted">·</span>
          <span className="danger-text">exit {d.exitCode}</span>
        </>
      )}
      {d.isError && item.text && <pre className="small">{stripAnsi(item.text)}</pre>}
    </div>
  );
}

interface Props {
  items: TranscriptItem[];
  /** The tab's worker provider, for cost tooltips. */
  provider: Provider | null;
  /** The vote card, rendered where the council voted (or first, when the transcript has no vote item). */
  voteCard?: ReactNode;
  /** The project checkout; tool paths inside it are shown relative to it. */
  pathBase?: string | null;
}

/** The tab's transcript: user bubbles, assistant markdown, folded tool-call runs, system lines, results and errors. */
export function Transcript({ items, provider, voteCard, pathBase }: Props) {
  const blocks = useMemo(() => groupActivity(items), [items]);
  const hasVoteItem = items.some((i) => i.kind === 'vote');
  return (
    <>
      {voteCard && !hasVoteItem && voteCard}
      {blocks.map((b) => {
        if (b.kind === 'run') return <ActivityRun key={b.id} block={b} pathBase={pathBase} />;
        const item = b.item;
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.id} className="item-user">
                <div className="bubble">{item.text}</div>
                <span className="ts">{shortTime(item.ts)}</span>
              </div>
            );
          case 'assistant':
            return (
              <div key={item.id} className="item-assistant">
                <Markdown text={item.text ?? ''} />
              </div>
            );
          case 'vote':
            return voteCard ? (
              <div key={item.id}>{voteCard}</div>
            ) : (
              <div key={item.id} className="item-system">
                Council voted.
              </div>
            );
          case 'system':
            return (
              <div key={item.id} className="item-system">
                {item.text}
              </div>
            );
          case 'error':
            return (
              <div key={item.id} className="item-error" role="alert">
                {item.text}
              </div>
            );
          case 'result':
            return <ResultLine key={item.id} item={item} provider={provider} />;
          default:
            return null;
        }
      })}
    </>
  );
}
