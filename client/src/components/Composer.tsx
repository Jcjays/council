import { useState, type KeyboardEvent } from 'react';
import { PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type Provider, type Settings, type SubmitMode, type Tab } from '../types';

interface Props {
  tab: Tab;
  settings: Settings;
  onSubmit: (text: string, mode: SubmitMode, fullAuto: boolean) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  available?: Provider[];
}

export function Composer({ tab, settings, onSubmit, onSend, available }: Props) {
  const providers = PROVIDERS.filter((p) => !available || available.includes(p));
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto' | Provider>('auto');
  const [model, setModel] = useState('');
  const [fullAuto, setFullAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const drafting = tab.status === 'drafting';
  const canSend = drafting || tab.status === 'idle' || tab.status === 'failed';
  const hint =
    tab.status === 'running'
      ? 'The worker is busy; your message can go once it is idle.'
      : tab.status === 'voting'
        ? 'The council is voting…'
        : tab.status === 'awaiting-start'
          ? 'Start the worker from the vote card above.'
          : tab.status === 'handing-off'
            ? 'Handing the task over…'
            : tab.status === 'closed'
              ? 'This tab is closed.'
              : '';

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

  return (
    <div className="composer">
      {drafting && (
        <div className="row wrap small">
          <label>
            Route:
            <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | Provider)} aria-label="Routing mode">
              <option value="auto">{providers.length > 1 ? 'Auto (council votes)' : 'Auto (pick the model for me)'}</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_NAMES[p]}
                </option>
              ))}
            </select>
          </label>
          {mode !== 'auto' && (
            <>
              <input list="composer-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default model" aria-label="Model" />
              <datalist id="composer-models">
                {settings.models[mode].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
          <label title="Let the worker run shell commands without the allow-list (Claude --dangerously-skip-permissions, Gemini yolo, Codex no sandbox)">
            <input type="checkbox" checked={fullAuto} onChange={(e) => setFullAuto(e.target.checked)} /> Full auto
          </label>
        </div>
      )}
      <div className="row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={!canSend || busy}
          rows={drafting ? 4 : 2}
          placeholder={drafting ? 'Describe the task. Enter sends, Shift+Enter for a new line.' : hint || 'Follow-up for the worker…'}
          aria-label="Message"
        />
        <button className="primary" onClick={() => void go()} disabled={!canSend || busy || !text.trim()}>
          {drafting ? (mode === 'auto' ? 'Ask the council' : `Send to ${PROVIDER_NAMES[mode]}`) : 'Send'}
        </button>
      </div>
      {!drafting && hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
