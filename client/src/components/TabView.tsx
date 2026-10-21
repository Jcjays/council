import { useState } from 'react';
import { api } from '../api';
import { formatUsd, PROVIDER_NAMES, statusLabel, workerLabel } from '../lib/format';
import { PROVIDERS, type Provider, type Settings, type SubmitMode, type Tab } from '../types';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { VoteCard } from './VoteCard';

interface Props {
  tab: Tab;
  settings: Settings;
  onError: (message: string) => void;
  available?: Provider[];
}

export function TabView({ tab, settings, onError, available }: Props) {
  const providers = PROVIDERS.filter((p) => !available || available.includes(p));
  const [switching, setSwitching] = useState(false);
  const [switchProvider, setSwitchProvider] = useState<Provider>(providers[0] ?? 'claude');
  const [switchModel, setSwitchModel] = useState('');
  const [closing, setClosing] = useState(false);
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

  return (
    <main className="tabview">
      <header className="tab-header">
        <div className="tab-heading">
          <h2>{tab.title || 'Untitled task'}</h2>
          <div className="row wrap small">
            <span className={`status-pill status-${tab.status}`}>{statusLabel(tab.status)}</span>
            {tab.tier && <span className={`tier tier-${tab.tier}`}>{tab.tier}</span>}
            <span>{workerLabel(tab.worker)}</span>
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
            {providers.map((p) => (
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
              : 'A summary of the work so far is handed to the new worker in the same checkout.'}
          </span>
        </div>
      )}

      {closing && (
        <div className="card row wrap">
          <span>Close this tab? A running worker is stopped; whatever it changed stays in your checkout.</span>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api.close(tab.id);
                setClosing(false);
              })
            }
          >
            Close tab
          </button>
          <button onClick={() => setClosing(false)}>Cancel</button>
        </div>
      )}

      <VoteCard tab={tab} settings={settings} available={available} onStart={(pick) => act(() => api.start(tab.id, pick))} />

      <Transcript items={tab.transcript} />

      <Composer
        tab={tab}
        settings={settings}
        available={available}
        onSubmit={(text: string, mode: SubmitMode, fullAuto: boolean) => act(() => api.submit(tab.id, text, mode, fullAuto))}
        onSend={(text: string) => act(() => api.send(tab.id, text))}
      />
    </main>
  );
}
