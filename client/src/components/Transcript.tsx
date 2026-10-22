import { useMemo, useState, type ReactNode } from 'react';
import { groupActivity } from '../lib/activity';
import { costSource, formatTokens, formatUsd, shortTime, stripAnsi } from '../lib/format';
import { permissionVerb, ruleLabel } from '../lib/permissions';
import type { PermissionAnswer, PermissionItemData, Provider, TranscriptItem, Usage } from '../types';
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

/** A worker asking to do something: Allow once, Allow for this tab, or Deny; one line once answered. */
function PermissionCard({ item, onAnswer }: { item: TranscriptItem; onAnswer?: (requestId: string, answer: PermissionAnswer) => Promise<void> }) {
  const d = item.data as PermissionItemData;
  const [busy, setBusy] = useState(false);
  const answer = async (a: PermissionAnswer) => {
    if (!onAnswer) return;
    setBusy(true);
    try {
      await onAnswer(d.id, a);
    } finally {
      setBusy(false);
    }
  };
  if (d.status !== 'pending') {
    return (
      <div className={`item-permission done ${d.status === 'denied' ? 'denied' : 'allowed'}`}>
        <b>{permissionVerb(d.status)}</b>
        <span>{d.action}</span>
        <code title={d.detail}>{d.detail}</code>
        {d.status === 'allowed-tab' && <span className="muted xs">(and {ruleLabel(d.rule)} from now on)</span>}
      </div>
    );
  }
  return (
    <section className="card warn item-permission" role="alert" aria-label="Permission request">
      <div className="card-title">The worker wants to {d.action}</div>
      <pre className="perm-detail">{d.detail}</pre>
      <div className="row">
        <button className="primary" disabled={busy || !onAnswer} onClick={() => void answer('allow-once')}>
          Allow once
        </button>
        <button disabled={busy || !onAnswer} onClick={() => void answer('allow-tab')} title={`Allow ${ruleLabel(d.rule)} for the rest of this tab without asking`}>
          Allow {d.rule.includes('(') ? <code>{ruleLabel(d.rule)}</code> : d.toolName} for this tab
        </button>
        <button className="danger" disabled={busy || !onAnswer} onClick={() => void answer('deny')}>
          Deny
        </button>
      </div>
    </section>
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
  /** Answers a worker's permission request. */
  onPermission?: (requestId: string, answer: PermissionAnswer) => Promise<void>;
}

/** The tab's transcript: user bubbles, assistant markdown, folded tool-call runs, system lines, results and errors. */
export function Transcript({ items, provider, voteCard, pathBase, onPermission }: Props) {
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
          case 'permission':
            return <PermissionCard key={item.id} item={item} onAnswer={onPermission} />;
          default:
            return null;
        }
      })}
    </>
  );
}
