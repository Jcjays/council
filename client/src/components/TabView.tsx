import { useRef, useState } from 'react';
import { api } from '../api';
import { useNow } from '../hooks/useNow';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { costSource, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { isStreaming, statusPhrase, tabChips, toneOf } from '../lib/lanes';
import { firstSetUp, noneSetUp, type Availability } from '../lib/routing';
import { shouldAskAboutStall, stallMessage } from '../lib/stall';
import type { Provider, Settings, SubmitMode, Tab } from '../types';
import { Composer } from './Composer';
import { Details } from './Details';
import { Glyph } from './Glyph';
import { Steps } from './Home';
import { ProviderSelect } from './ProviderSelect';
import { Transcript } from './Transcript';
import { VoteCard } from './VoteCard';

interface Props {
  tab: Tab;
  settings: Settings;
  available: Availability;
  /** Number of stall notices received for this tab. */
  stallSeq: number;
  details: boolean;
  onToggleDetails: () => void;
  onError: (message: string) => void;
}

export function TabView({ tab, settings, available, stallSeq, details, onToggleDetails, onError }: Props) {
  const [switching, setSwitching] = useState(false);
  const [switchProvider, setSwitchProvider] = useState<Provider>(() => firstSetUp(available, 'claude'));
  const [switchModel, setSwitchModel] = useState('');
  const [closing, setClosing] = useState(false);
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
  const askingAboutStall = shouldAskAboutStall(tab, stallSeq, dismissedStall);
  const chips = tabChips(tab);
  const drafting = tab.status === 'drafting' && tab.transcript.length === 0;
  const nothingSetUp = noneSetUp(available);

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

        <div className="alerts">
          {switching && settled && (
            <div className="card inline-form">
              <span>Hand this tab to</span>
              <ProviderSelect value={switchProvider} onChange={setSwitchProvider} available={available} ariaLabel="Switch provider" />
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
                {tab.worker?.provider === switchProvider ? 'Same provider: the session continues with the new model.' : 'A summary of the work so far is handed to the new worker; it carries on in the same checkout.'}
              </span>
            </div>
          )}

          {closing && (
            <div className="card danger inline-form">
              <span>Close this tab? A running worker is stopped. Changes already made to your checkout stay as they are.</span>
              <button
                className="danger primary"
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
        </div>

        <div className="stream" ref={streamRef}>
          {drafting && (
            <div className="draft-intro">
              <h3>What should the council work on?</h3>
              <p className="sec">
                Describe the task below. Auto lets the council rate it and route it; or pick a provider to skip the vote. The worker edits this checkout directly and follows its CLAUDE.md, AGENTS.md or GEMINI.md.
              </p>
              <Steps />
            </div>
          )}

          <Transcript
            items={tab.transcript}
            provider={tab.worker?.provider ?? null}
            pathBase={tab.projectRoot}
            voteCard={tab.vote ? <VoteCard tab={tab} settings={settings} available={available} onStart={(pick) => act(() => api.start(tab.id, pick))} /> : undefined}
          />

          {!pinned && (
            <div className="stream-anchor">
              <button className="sm" onClick={jump}>
                Jump to latest ↓
              </button>
            </div>
          )}
        </div>

        {nothingSetUp && tab.status !== 'closed' ? (
          <div className="setup" role="status">
            <h3>No coding CLI is set up</h3>
            <p className="sec sm">Council drives Claude Code, Codex CLI and Gemini CLI. Install one, sign in, and this tab can take a task. The details are under Settings › CLI health.</p>
          </div>
        ) : (
          <Composer
            tab={tab}
            settings={settings}
            available={available}
            onSubmit={(text: string, mode: SubmitMode, fullAuto: boolean) => act(() => api.submit(tab.id, text, mode, fullAuto))}
            onSend={(text: string) => act(() => api.send(tab.id, text))}
            onSwitch={(provider: Provider, model: string | null) => act(() => api.switchWorker(tab.id, provider, model))}
          />
        )}
      </div>

      {details && <Details tab={tab} />}
    </main>
  );
}
