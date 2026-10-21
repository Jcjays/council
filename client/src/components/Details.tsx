import { useMemo } from 'react';
import { costSource, formatUsd, PROVIDER_NAMES, shortenPath } from '../lib/format';
import { filesTouched } from '../lib/tools';
import type { ProjectInfo, Tab, TabWorker } from '../types';
import { Glyph } from './Glyph';
import { tally } from './VoteCard';

interface Props {
  tab: Tab;
  project: ProjectInfo | null;
  busy: boolean;
  onMerge: () => void;
  onRebase: () => void;
  onMarkReady: () => void;
}

function Worker({ w }: { w: TabWorker }) {
  return (
    <span className="row gap-sm">
      <Glyph provider={w.provider} />
      {PROVIDER_NAMES[w.provider]} · {w.model ?? 'default'}
    </span>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

/** The right-hand pane: worker, routing, branch, cost and the files the transcript touched. */
export function Details({ tab, project, busy, onMerge, onRebase, onMarkReady }: Props) {
  const files = useMemo(() => filesTouched(tab.transcript), [tab.transcript]);
  const voteCost = tab.vote ? tab.vote.seats.reduce((s, x) => s + x.costUsd, 0) : 0;
  const settled = tab.status === 'idle' || tab.status === 'failed';
  const merge = tab.lastMerge;
  const target = project?.defaultBranch ?? 'the default branch';
  const mergeState = !tab.worktree
    ? 'no worktree'
    : tab.status === 'merged' || merge?.kind === 'merged'
      ? `merged${merge?.kind === 'merged' ? ` (${merge.sha.slice(0, 7)})` : ''}`
      : merge?.kind === 'conflict'
        ? `conflict in ${merge.files.join(', ')}`
        : merge?.kind === 'blocked'
          ? `blocked: ${merge.reason}`
          : tab.ready
            ? 'ready for you to merge'
            : 'not merged yet';

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
          <span className="k">Mode</span>
          <span className="v">{tab.fullAuto ? <span className="danger-text">full auto</span> : 'edits allowed, commands restricted'}</span>
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
        <h5>Branch</h5>
        {tab.worktree ? (
          <>
            <div className="kv">
              <span className="k">Branch</span>
              <span className="v mono">{tab.worktree.branch}</span>
              <span className="k">Worktree</span>
              <span className="v mono xs muted" title={tab.worktree.path}>
                {tab.worktree.path}
              </span>
              <span className="k">Merge</span>
              <span className={`v${merge?.kind === 'conflict' ? ' danger-text' : merge?.kind === 'blocked' ? ' warn-text' : ''}`}>{mergeState}</span>
            </div>
            <div className="row wrap">
              {settled && tab.status !== 'merged' && (
                <button className="primary sm" disabled={busy} onClick={onMerge} title={`Commit the worktree and merge into ${target}`}>
                  Merge into {project?.defaultBranch ?? 'default'}
                </button>
              )}
              {settled && merge?.kind === 'conflict' && (
                <button className="sm" disabled={busy} onClick={onRebase} title="Ask the worker to rebase onto the default branch and resolve conflicts">
                  Ask worker to rebase
                </button>
              )}
              {settled && merge?.kind === 'blocked' && tab.ready === false && (
                <button className="sm" disabled={busy} onClick={onMarkReady} title="Keep the branch as it is and mark this tab ready for you to merge by hand">
                  Mark ready
                </button>
              )}
              <button className="quiet sm" onClick={() => copy(tab.worktree?.branch ?? '')} title="Copy the branch name">
                Copy branch
              </button>
            </div>
          </>
        ) : (
          <span className="muted sm">A branch and worktree are created when the worker starts.</span>
        )}
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
                <span className="name">{shortenPath(f.path, tab.worktree?.path)}</span>
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
