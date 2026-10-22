import { useMemo } from 'react';
import { askModeNote, AUTO_NOTE, ruleLabel } from '../lib/permissions';
import { basename, costSource, formatUsd, PROVIDER_NAMES, shortenPath } from '../lib/format';
import { filesTouched } from '../lib/tools';
import type { Tab, TabWorker } from '../types';
import { Glyph } from './Glyph';
import { tally } from './VoteCard';

function Worker({ w }: { w: TabWorker }) {
  return (
    <span className="row gap-sm">
      <Glyph provider={w.provider} />
      {PROVIDER_NAMES[w.provider]} · {w.model ?? 'default'}
    </span>
  );
}

/** The right-hand pane: worker, routing, the checkout being edited, cost and the files the transcript touched. */
export function Details({ tab }: { tab: Tab }) {
  const files = useMemo(() => filesTouched(tab.transcript), [tab.transcript]);
  const voteCost = tab.vote ? tab.vote.seats.reduce((s, x) => s + x.costUsd, 0) : 0;

  return (
    <aside className="details" aria-label="Tab details">
      <section>
        <h5>Worker</h5>
        <div className="kv">
          <span className="k">Current</span>
          <span className="v">{tab.worker ? <Worker w={tab.worker} /> : <span className="muted">none yet</span>}</span>
          {tab.worker?.sessionId && (
            <>
              <span className="k">Session</span>
              <span className="v mono" title={tab.worker.sessionId}>
                {tab.worker.sessionId.length > 14 ? `${tab.worker.sessionId.slice(0, 12)}…` : tab.worker.sessionId}
              </span>
            </>
          )}
          <span className="k">Permissions</span>
          <span className="v" title={tab.fullAuto ? AUTO_NOTE : tab.worker ? askModeNote(tab.worker.provider) : undefined}>
            {tab.fullAuto ? <span className="danger-text">Auto</span> : 'Ask me'}
          </span>
          {(tab.allowedTools ?? []).length > 0 && (
            <>
              <span className="k">Allowed here</span>
              <span className="v">{(tab.allowedTools ?? []).map(ruleLabel).join(', ')}</span>
            </>
          )}
        </div>
      </section>

      <section>
        <h5>Routing</h5>
        <div className="kv">
          <span className="k">Tier</span>
          <span className="v">{tab.tier ? <span className={`tier tier-${tab.tier}`}>{tab.tier}</span> : <span className="muted">not voted</span>}</span>
          {tab.vote && (
            <>
              <span className="k">Vote</span>
              <span className="v">
                {tally(tab.vote)}
                {tab.vote.tie ? ', tie broken' : ''} · {formatUsd(voteCost)}
              </span>
            </>
          )}
          {tab.routing?.shiftedFrom && (
            <>
              <span className="k">Shifted</span>
              <span className="v warn-text">from {tab.routing.shiftedFrom}</span>
            </>
          )}
          <span className="k">Hand-offs</span>
          <span className="v">
            {tab.previousWorkers.length === 0 ? (
              <span className="muted">none</span>
            ) : (
              <span className="history">
                {tab.previousWorkers.map((w, i) => (
                  <span key={i} className="h-row">
                    <Worker w={w} />
                    <span className="muted">→</span>
                  </span>
                ))}
                {tab.worker && <Worker w={tab.worker} />}
              </span>
            )}
          </span>
          {tab.escalations > 0 && (
            <>
              <span className="k">Escalated</span>
              <span className="v">{tab.escalations} time{tab.escalations === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
      </section>

      <section>
        <h5>Checkout</h5>
        <div className="kv">
          <span className="k">Project</span>
          <span className="v">{basename(tab.projectRoot)}</span>
          <span className="k">Path</span>
          <span className="v mono xs muted" title={tab.projectRoot}>
            {tab.projectRoot}
          </span>
        </div>
        <span className="muted xs">The worker edits this checkout in place and commits nothing. Review the changes in your editor or with git.</span>
      </section>

      <section>
        <h5>Cost</h5>
        <div className="kv">
          <span className="k">This tab</span>
          <span className="v">{formatUsd(tab.costUsd)}</span>
          <span className="k">Work</span>
          <span className="v" title={costSource(tab.worker?.provider)}>
            {formatUsd(Math.max(0, tab.costUsd - voteCost))}
          </span>
          <span className="k">Council</span>
          <span className="v" title="Votes and hand-off summaries">
            {formatUsd(voteCost)}
          </span>
        </div>
        <span className="muted xs">Claude costs are reported by Claude Code; Codex and Gemini are estimated from the price table.</span>
      </section>

      <section>
        <h5>Files touched · {files.length}</h5>
        {files.length === 0 ? (
          <span className="muted sm">{tab.transcript.length === 0 ? 'Nothing yet.' : 'No file edits in the transcript.'}</span>
        ) : (
          <div className="files">
            {files.map((f) => (
              <div key={f.path} className="file" title={`${f.path} (${f.label})`}>
                <span className="muted">{f.label === 'written' || f.label === 'added' ? '+' : f.label === 'deleted' ? '−' : '✎'}</span>
                <span className="name">{shortenPath(f.path, tab.projectRoot)}</span>
                {(f.added > 0 || f.removed > 0) && (
                  <span className="pm">
                    {f.added > 0 && <span className="add">+{f.added}</span>}
                    {f.removed > 0 && <span className="del">−{f.removed}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
