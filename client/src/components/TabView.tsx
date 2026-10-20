import { useState } from 'react';
import { api } from '../api';
import { formatUsd, PROVIDER_NAMES, statusLabel, workerLabel } from '../lib/format';
import { PROVIDERS, type ProjectInfo, type Provider, type Settings, type SubmitMode, type Tab } from '../types';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { VoteCard } from './VoteCard';

interface Props {
  tab: Tab;
  settings: Settings;
  project: ProjectInfo | null;
  onError: (message: string) => void;
}

export function TabView({ tab, settings, project, onError }: Props) {
  const [switching, setSwitching] = useState(false);
  const [switchProvider, setSwitchProvider] = useState<Provider>('claude');
  const [switchModel, setSwitchModel] = useState('');
  const [closing, setClosing] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [busy, setBusy] = useState(false);

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

  return (
    <main className="tabview">
      <header className="tab-header">
        <div className="tab-heading">
          <h2>{tab.title || 'Untitled task'}</h2>
          <div className="row wrap small">
            <span className={`status-pill status-${tab.status}`}>{statusLabel(tab.status)}</span>
            {tab.tier && <span className={`tier tier-${tab.tier}`}>{tab.tier}</span>}
            <span>{workerLabel(tab.worker)}</span>
            {tab.worktree && (
              <code title={tab.worktree.path} className="muted">
                {tab.worktree.branch}
              </code>
            )}
            <span className="muted">{formatUsd(tab.costUsd)}</span>
            {tab.fullAuto && <span className="warn-text">full auto</span>}
            {tab.stalled && <span className="warn-text">no output for a while</span>}
          </div>
        </div>
        <div className="row wrap actions">
          {canEscalate && (
            <button disabled={busy} onClick={() => void act(() => api.escalate(tab.id))} title="Hand the task to the next tier up with a summary">
              Escalate
            </button>
          )}
          {settled && (
            <button disabled={busy} onClick={() => setSwitching((s) => !s)}>
              Switch worker
            </button>
          )}
          {settled && tab.worktree && (
            <button disabled={busy} className="primary" onClick={() => void act(() => api.merge(tab.id))} title={`Commit the worktree and merge into ${project?.defaultBranch ?? 'the default branch'}`}>
              Merge
            </button>
          )}
          {settled && conflict && (
            <button disabled={busy} onClick={() => void act(() => api.rebase(tab.id))} title="Ask the worker to rebase onto the default branch and resolve conflicts">
              Ask worker to rebase
            </button>
          )}
          {tab.status !== 'closed' && (
            <button disabled={busy} className="danger" onClick={() => setClosing((c) => !c)}>
              Close
            </button>
          )}
        </div>
      </header>

      {switching && settled && (
        <div className="card row wrap">
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
          <span className="muted small">
            {tab.worker?.provider === switchProvider
              ? 'Same provider: the session continues with the new model.'
              : 'A summary of the work so far is handed to the new worker in the same worktree.'}
          </span>
        </div>
      )}

      {closing && (
        <div className="card row wrap">
          <span>Close this tab?</span>
          <label>
            <input type="checkbox" checked={deleteWorktree} onChange={(e) => setDeleteWorktree(e.target.checked)} /> remove the worktree (the branch is kept if it has unmerged commits)
          </label>
          <button
            className="danger"
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
          <button onClick={() => setClosing(false)}>Cancel</button>
        </div>
      )}

      {tab.lastMerge && tab.lastMerge.kind !== 'merged' && (
        <div className="card warn">
          {tab.lastMerge.kind === 'conflict'
            ? `Merge conflict in ${tab.lastMerge.files.join(', ')}. Ask the worker to rebase, or resolve it yourself.`
            : `Merge blocked: ${tab.lastMerge.reason}${tab.lastMerge.files ? ` (${tab.lastMerge.files.join(', ')})` : ''}`}
        </div>
      )}

      <VoteCard tab={tab} settings={settings} onStart={(pick) => act(() => api.start(tab.id, pick))} />

      <Transcript items={tab.transcript} />

      <Composer
        tab={tab}
        settings={settings}
        onSubmit={(text: string, mode: SubmitMode, fullAuto: boolean) => act(() => api.submit(tab.id, text, mode, fullAuto))}
        onSend={(text: string) => act(() => api.send(tab.id, text))}
      />
    </main>
  );
}
