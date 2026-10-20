import { useRef, useState } from 'react';
import { api } from '../api';
import { useNow } from '../hooks/useNow';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { costSource, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { isStreaming, statusPhrase, tabChips, toneOf } from '../lib/lanes';
import { shouldAskAboutStall, stallMessage } from '../lib/stall';
import { PROVIDERS, type ProjectInfo, type Provider, type Settings, type SubmitMode, type Tab } from '../types';
import { Composer } from './Composer';
import { Details } from './Details';
import { Glyph } from './Glyph';
import { Steps } from './Home';
import { Transcript } from './Transcript';
import { VoteCard } from './VoteCard';

interface Props {
  tab: Tab;
  settings: Settings;
  project: ProjectInfo | null;
  /** Number of stall notices received for this tab. */
  stallSeq: number;
  details: boolean;
  onToggleDetails: () => void;
  onError: (message: string) => void;
}

export function TabView({ tab, settings, project, stallSeq, details, onToggleDetails, onError }: Props) {
  const [switching, setSwitching] = useState(false);
  const [switchProvider, setSwitchProvider] = useState<Provider>('claude');
  const [switchModel, setSwitchModel] = useState('');
  const [closing, setClosing] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dismissedStall, setDismissedStall] = useState<number | null>(null);
  const now = useNow(5_000);
  const streamRef = useRef<HTMLDivElement>(null);
  const last = tab.transcript[tab.transcript.length - 1];
  const { pinned, jump } = useStickToBottom(streamRef, `${tab.transcript.length}:${last?.text?.length ?? 0}:${last?.tool?.output?.length ?? 0}`);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settled = tab.status === 'idle' || tab.status === 'failed';
  const canEscalate = settled && tab.tier !== null && tab.tier !== 'hard';
  const conflict = tab.lastMerge?.kind === 'conflict';
  const askingAboutStall = shouldAskAboutStall(tab, stallSeq, dismissedStall);
  const chips = tabChips(tab);
  const target = project?.defaultBranch ?? 'the default branch';
  const drafting = tab.status === 'drafting' && tab.transcript.length === 0;

  return (
    <main className={`tabview${details ? ' with-details' : ''}`}>
      <div className="tab-main">
        <header className="tab-header">
          <div className="tab-heading">
            <h2>{tab.title || 'Untitled task'}</h2>
            <div className="tab-meta">
              <span className={`pill tone-${toneOf(tab)}`}>
                <span className={`sdot${isStreaming(tab) ? ' pulse' : ''}`} />
                {statusPhrase(tab, now)}
              </span>
              {tab.tier && <span className={`tier tier-${tab.tier}`}>{tab.tier}</span>}
              {tab.worker && (
                <span className="pill" title={tab.worker.sessionId ? `session ${tab.worker.sessionId}` : 'no session yet'}>
                  <Glyph provider={tab.worker.provider} />
                  {PROVIDER_NAMES[tab.worker.provider]} · {tab.worker.model ?? 'default model'}
                </span>
              )}
              {tab.worktree && (
                <code className="muted" title={tab.worktree.path}>
                  {tab.worktree.branch}
                </code>
              )}
              <span className="sec" title={`Spent on this tab, ${costSource(tab.worker?.provider)}`}>
                {formatUsd(tab.costUsd)}
              </span>
              {chips.map((c) => (
                <span key={c.label} className={`chip tone-${c.tone}`} title={c.title}>
                  {c.label}
                </span>
              ))}
            </div>
          </div>
          <div className="tab-actions">
            {canEscalate && (
              <button className="quiet" disabled={busy} onClick={() => void act(() => api.escalate(tab.id))} title="Hand the task to the next tier up with a summary">
                Escalate
              </button>
            )}
            {settled && (
              <button className="quiet" disabled={busy} onClick={() => setSwitching((s) => !s)} aria-expanded={switching}>
                Switch worker
              </button>
            )}
            {settled && tab.worktree && (
              <button disabled={busy} className="primary" onClick={() => void act(() => api.merge(tab.id))} title={`Commit the worktree and merge into ${target}`}>
                Merge
              </button>
            )}
            {tab.status !== 'closed' && (
              <button disabled={busy} className="quiet danger" onClick={() => setClosing((c) => !c)} aria-expanded={closing}>
                Close
              </button>
            )}
            <button className={`iconbtn${details ? ' selected' : ''}`} onClick={onToggleDetails} title={`${details ? 'Hide' : 'Show'} details (Alt+I)`} aria-label="Toggle details" aria-pressed={details}>
              ▥
            </button>
          </div>
        </header>

        <div className="stream" ref={streamRef}>
          <div className="alerts">
            {switching && settled && (
              <div className="card inline-form">
                <span>Hand this tab to</span>
                <select value={switchProvider} onChange={(e) => setSwitchProvider(e.target.value as Provider)} aria-label="Switch provider">
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_NAMES[p]}
                    </option>
                  ))}
                </select>
                <input list="switch-models" value={switchModel} onChange={(e) => setSwitchModel(e.target.value)} placeholder="default model" aria-label="Switch model" />
                <datalist id="switch-models">
                  {settings.models[switchProvider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.switchWorker(tab.id, switchProvider, switchModel || null);
                      setSwitching(false);
                    })
                  }
                >
                  {tab.worker?.provider === switchProvider ? 'Change model' : 'Switch'}
                </button>
                <button className="quiet" onClick={() => setSwitching(false)}>
                  Cancel
                </button>
                <span className="muted sm">
                  {tab.worker?.provider === switchProvider ? 'Same provider: the session continues with the new model.' : 'A summary of the work so far is handed to the new worker in the same worktree.'}
                </span>
              </div>
            )}

            {closing && (
              <div className="card danger inline-form">
                <span>Close this tab?</span>
                <label>
                  <input type="checkbox" checked={deleteWorktree} onChange={(e) => setDeleteWorktree(e.target.checked)} /> remove the worktree (the branch is kept if it has unmerged commits)
                </label>
                <button
                  className="danger primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.close(tab.id, deleteWorktree);
                      setClosing(false);
                    })
                  }
                >
                  Close tab
                </button>
                <button className="quiet" onClick={() => setClosing(false)}>
                  Cancel
                </button>
              </div>
            )}

            {askingAboutStall && (
              <div className="card warn inline-form" role="status">
                <span>{stallMessage(settings.stallMinutes)}. The worker may be stuck.</span>
                {tab.tier !== null && tab.tier !== 'hard' && (
                  <button disabled={busy} className="primary" onClick={() => void act(() => api.escalate(tab.id))} title="Stop this worker and hand the task to the next tier up">
                    Escalate
                  </button>
                )}
                <button disabled={busy} onClick={() => setDismissedStall(stallSeq)}>
                  Keep waiting
                </button>
              </div>
            )}

            {tab.lastMerge && tab.lastMerge.kind !== 'merged' && (
              <div className={`card ${tab.lastMerge.kind === 'conflict' ? 'danger' : 'warn'}`}>
                <div>
                  {tab.lastMerge.kind === 'conflict'
                    ? `Merge conflict in ${tab.lastMerge.files.join(', ')}. Ask the worker to rebase, or resolve it yourself.`
                    : `Merge blocked: ${tab.lastMerge.reason}${tab.lastMerge.files ? ` (${tab.lastMerge.files.join(', ')})` : ''}`}
                </div>
                <div className="row wrap">
                  {settled && conflict && (
                    <button disabled={busy} onClick={() => void act(() => api.rebase(tab.id))} title="Ask the worker to rebase onto the default branch and resolve conflicts">
                      Ask worker to rebase
                    </button>
                  )}
                  {tab.lastMerge.kind === 'blocked' && tab.worktree && (
                    <>
                      <span className="sm">{tab.ready ? 'Ready: the branch is committed and yours to merge.' : 'Or leave the branch for yourself to merge:'}</span>
                      <code>{tab.worktree.branch}</code>
                      <button className="link sm" onClick={() => void navigator.clipboard?.writeText(tab.worktree?.branch ?? '')} title="Copy the branch name">
                        copy
                      </button>
                      {settled && tab.ready === false && (
                        <button className="sm" disabled={busy} onClick={() => void act(() => api.markReady(tab.id))} title="Keep the branch as it is and mark this tab ready for you to merge by hand">
                          Mark ready
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {drafting && (
            <div className="draft-intro">
              <h3>What should the council work on?</h3>
              <p className="sec">Describe the task below. Auto lets three cheap seats rate it and route it; or pick a provider to skip the vote.</p>
              <Steps />
            </div>
          )}

          <VoteCard tab={tab} settings={settings} onStart={(pick) => act(() => api.start(tab.id, pick))} />

          <Transcript items={tab.transcript} provider={tab.worker?.provider ?? null} decision={tab.vote?.decision ?? null} />

          {!pinned && (
            <div className="stream-anchor">
              <button className="sm" onClick={jump}>
                Jump to latest ↓
              </button>
            </div>
          )}
        </div>

        <Composer
          tab={tab}
          settings={settings}
          onSubmit={(text: string, mode: SubmitMode, fullAuto: boolean) => act(() => api.submit(tab.id, text, mode, fullAuto))}
          onSend={(text: string) => act(() => api.send(tab.id, text))}
          onSwitch={(provider: Provider, model: string | null) => act(() => api.switchWorker(tab.id, provider, model))}
        />
      </div>

      {details && (
        <Details
          tab={tab}
          project={project}
          busy={busy}
          onMerge={() => void act(() => api.merge(tab.id))}
          onRebase={() => void act(() => api.rebase(tab.id))}
          onMarkReady={() => void act(() => api.markReady(tab.id))}
        />
      )}
    </main>
  );
}
