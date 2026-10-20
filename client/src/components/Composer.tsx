import { useEffect, useState, type KeyboardEvent } from 'react';
import { followUpSelection, selectionChangesWorker } from '../lib/composerMode';
import { PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type Provider, type Settings, type SubmitMode, type Tab } from '../types';
import { Glyph } from './Glyph';

interface Props {
  tab: Tab;
  settings: Settings;
  onSubmit: (text: string, mode: SubmitMode, fullAuto: boolean) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  /** A change of worker from the follow-up selector; behaves like the header's Switch worker. */
  onSwitch: (provider: Provider, model: string | null) => Promise<void>;
}

function hintFor(tab: Tab): string {
  switch (tab.status) {
    case 'running':
      return 'The worker is busy; your message can go once it is idle.';
    case 'voting':
      return 'The council is voting…';
    case 'awaiting-start':
      return 'Start the worker from the vote card above.';
    case 'handing-off':
      return 'Handing the task over…';
    case 'merged':
      return 'This tab is merged. Open a new tab for more work.';
    case 'closed':
      return 'This tab is closed.';
    default:
      return '';
  }
}

export function Composer({ tab, settings, onSubmit, onSend, onSwitch }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto' | Provider>('auto');
  const [model, setModel] = useState('');
  const [fullAuto, setFullAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const drafting = tab.status === 'drafting';
  const canSend = drafting || tab.status === 'idle' || tab.status === 'failed';
  const current = followUpSelection(tab);
  const [followModel, setFollowModel] = useState(current?.model ?? '');
  // The selector reads as the current worker; keep the model field in step when the worker changes.
  useEffect(() => setFollowModel(current?.model ?? ''), [current?.provider, current?.model]);
  const modelChanged = current !== null && selectionChangesWorker(current, current.provider, followModel);
  const hint = hintFor(tab);

  const go = async () => {
    const t = text.trim();
    if (!t || !canSend || busy) return;
    setBusy(true);
    try {
      if (drafting) {
        const m: SubmitMode = mode === 'auto' ? { kind: 'auto' } : { kind: 'manual', provider: mode, model: model || null };
        await onSubmit(t, m, fullAuto);
      } else {
        await onSend(t);
      }
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void go();
    }
  };

  const modelList = (provider: Provider, id: string) => (
    <datalist id={id}>
      {settings.models[provider].map((m) => (
        <option key={m} value={m} />
      ))}
    </datalist>
  );

  return (
    <div className="composer">
      {drafting && (
        <div className="composer-row">
          <span className="seg" role="radiogroup" aria-label="Routing">
            <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')} role="radio" aria-checked={mode === 'auto'} title="The council votes and routes the task">
              Auto
            </button>
            {PROVIDERS.map((p) => (
              <button key={p} className={mode === p ? 'on' : ''} onClick={() => setMode(p)} role="radio" aria-checked={mode === p} title={`Skip the vote and send to ${PROVIDER_NAMES[p]}`}>
                <Glyph provider={p} />
                {PROVIDER_NAMES[p]}
              </button>
            ))}
          </span>
          {mode !== 'auto' && (
            <>
              <input className="model" list="composer-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default model" aria-label="Model" />
              {modelList(mode, 'composer-models')}
            </>
          )}
          <span className="spacer" />
          <label className="switch" title="Let the worker run shell commands without the allow-list (Claude --dangerously-skip-permissions, Gemini yolo, Codex no sandbox)">
            <input type="checkbox" checked={fullAuto} onChange={(e) => setFullAuto(e.target.checked)} />
            Full auto
          </label>
        </div>
      )}
      {!drafting && canSend && current && (
        <div className="composer-row">
          <span className="seg" role="radiogroup" aria-label="Follow-up worker">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                className={current.provider === p ? 'on' : ''}
                role="radio"
                aria-checked={current.provider === p}
                disabled={busy}
                onClick={() => {
                  if (selectionChangesWorker(current, p, '')) void onSwitch(p, null);
                }}
                title={current.provider === p ? 'The current worker' : `Hand the tab to ${PROVIDER_NAMES[p]}, like Switch worker`}
              >
                <Glyph provider={p} />
                {PROVIDER_NAMES[p]}
              </button>
            ))}
          </span>
          <input className="model" list="followup-models" value={followModel} onChange={(e) => setFollowModel(e.target.value)} placeholder="default model" aria-label="Follow-up model" />
          {modelList(current.provider, 'followup-models')}
          {modelChanged && (
            <button className="link sm" disabled={busy} onClick={() => void onSwitch(current.provider, followModel.trim() || null)} title="The session continues with this model from the next message">
              use this model
            </button>
          )}
          <span className="spacer" />
          {tab.fullAuto && (
            <span className="chip tone-danger" title="This tab runs without the command allow-list">
              full auto
            </span>
          )}
        </div>
      )}
      <div className="composer-box">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={!canSend || busy}
          rows={drafting ? 4 : 2}
          placeholder={drafting ? 'Describe the task…' : hint || `Follow-up for ${current ? PROVIDER_NAMES[current.provider] : 'the worker'}…`}
          aria-label="Message"
        />
        <button className="primary" onClick={() => void go()} disabled={!canSend || busy || !text.trim()}>
          {drafting ? (mode === 'auto' ? 'Ask the council' : `Send to ${PROVIDER_NAMES[mode]}`) : 'Send'}
        </button>
      </div>
      <div className="composer-hint">
        <span>{!canSend && hint ? hint : ''}</span>
        <span>
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line
        </span>
      </div>
    </div>
  );
}
