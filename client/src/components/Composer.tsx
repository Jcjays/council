import { useState, type KeyboardEvent } from 'react';
import { followUpSelection } from '../lib/composerMode';
import { PROVIDER_NAMES } from '../lib/format';
import { sameWorker, type Pick } from '../lib/models';
import { askModeNote, AUTO_NOTE } from '../lib/permissions';
import { autoLabel, type Availability } from '../lib/routing';
import type { ModelCatalog, PermissionMode, Provider, Settings, SubmitMode, Tab } from '../types';
import { ModelPicker } from './ModelPicker';

interface Props {
  tab: Tab;
  settings: Settings;
  catalog: ModelCatalog | null;
  available: Availability;
  onSubmit: (text: string, mode: SubmitMode, fullAuto: boolean) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  /** A change of worker from the follow-up picker; behaves like the header's Switch worker. */
  onSwitch: (provider: Provider, model: string | null) => Promise<void>;
  /** Ask me or Auto for this tab, after the first message. */
  onPermissionMode: (mode: PermissionMode) => Promise<void>;
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
    case 'closed':
      return 'This tab is closed.';
    default:
      return '';
  }
}

function PermissionSwitch({ mode, onChange, disabled, provider }: { mode: PermissionMode; onChange: (m: PermissionMode) => void; disabled?: boolean; provider: Provider | null }) {
  const askTitle = provider ? askModeNote(provider) : 'Claude asks before running commands; Codex and Gemini stay in their sandboxes.';
  return (
    <span className="seg" role="radiogroup" aria-label="Permissions for this tab">
      <button className={mode === 'ask' ? 'on' : ''} role="radio" aria-checked={mode === 'ask'} disabled={disabled} onClick={() => onChange('ask')} title={askTitle}>
        Ask me
      </button>
      <button className={mode === 'auto' ? 'on danger-on' : ''} role="radio" aria-checked={mode === 'auto'} disabled={disabled} onClick={() => onChange('auto')} title={AUTO_NOTE}>
        Auto
      </button>
    </span>
  );
}

export function Composer({ tab, catalog, available, onSubmit, onSend, onSwitch, onPermissionMode }: Props) {
  const [text, setText] = useState('');
  /** null = Auto: the council votes. */
  const [pick, setPick] = useState<Pick | null>(null);
  const [permission, setPermission] = useState<PermissionMode>(tab.fullAuto ? 'auto' : 'ask');
  const [busy, setBusy] = useState(false);

  const drafting = tab.status === 'drafting';
  const canSend = drafting || tab.status === 'idle' || tab.status === 'failed';
  const current = followUpSelection(tab);
  const hint = hintFor(tab);
  const tabMode: PermissionMode = tab.fullAuto ? 'auto' : 'ask';

  const go = async () => {
    const t = text.trim();
    if (!t || !canSend || busy) return;
    setBusy(true);
    try {
      if (drafting) {
        const m: SubmitMode = pick ? { kind: 'manual', provider: pick.provider, model: pick.model } : { kind: 'auto' };
        await onSubmit(t, m, permission === 'auto');
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
        <div className="composer-row">
          <span className="seg" role="radiogroup" aria-label="Routing">
            <button className={pick === null ? 'on' : ''} onClick={() => setPick(null)} role="radio" aria-checked={pick === null} title="The council rates the task and routes it, among the CLIs that are set up">
              {autoLabel(available)}
            </button>
          </span>
          <ModelPicker value={pick} onChange={setPick} catalog={catalog} available={available} ariaLabel="Send to a model directly" placeholder="or pick a model" disabled={busy} up />
          <span className="spacer" />
          <PermissionSwitch mode={permission} onChange={setPermission} disabled={busy} provider={pick?.provider ?? null} />
        </div>
      )}
      {!drafting && canSend && current && (
        <div className="composer-row">
          <ModelPicker
            value={current}
            onChange={(next) => {
              if (!sameWorker(next, current)) void onSwitch(next.provider, next.model);
            }}
            catalog={catalog}
            available={available}
            ariaLabel="Follow-up worker"
            disabled={busy}
            up
          />
          <span className="muted xs">another provider gets a hand-off summary; another model keeps the session</span>
          <span className="spacer" />
          <PermissionSwitch mode={tabMode} onChange={(m) => void onPermissionMode(m)} disabled={busy} provider={current.provider} />
        </div>
      )}
      {!drafting && !canSend && tab.status === 'running' && (
        <div className="composer-row">
          <span className="spacer" />
          <PermissionSwitch mode={tabMode} onChange={(m) => void onPermissionMode(m)} disabled={busy} provider={current?.provider ?? null} />
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
          {drafting ? (pick ? `Send to ${PROVIDER_NAMES[pick.provider]}` : 'Ask the council') : 'Send'}
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
