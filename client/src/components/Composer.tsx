import { useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { DEFAULT_PERMISSION, followUpSelection, fullAutoFor, selectionChangesWorker, type PermissionChoice } from '../lib/composerMode';
import { PROVIDER_NAMES } from '../lib/format';
import { autoLabel, isSetUp, notSetUpTitle, type Availability } from '../lib/routing';
import { PROVIDERS, type PlanInfo, type Provider, type Settings, type SkillInfo, type SubmitMode, type Tab } from '../types';
import { Glyph } from './Glyph';

interface Props {
  tab: Tab;
  settings: Settings;
  available: Availability;
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
    case 'closed':
      return 'This tab is closed.';
    default:
      return '';
  }
}

export function Composer({ tab, settings, available, onSubmit, onSend, onSwitch }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto' | Provider>('auto');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [allowedCommands, setAllowedCommands] = useState(() => (settings.allowedCommands ?? []).join('\n'));
  const [showCommands, setShowCommands] = useState(false);

  const alwaysKey = `council:always-allow:${tab.projectId}`;
  const [permission, setPermission] = useState<PermissionChoice>(() => {
    try {
      return localStorage.getItem(alwaysKey) === 'true' ? 'always' : DEFAULT_PERMISSION;
    } catch {
      return DEFAULT_PERMISSION;
    }
  });

  const drafting = tab.status === 'drafting';
  const canSend = drafting || tab.status === 'idle' || tab.status === 'failed';
  const current = followUpSelection(tab);
  const [followModel, setFollowModel] = useState(current?.model ?? '');

  useEffect(() => {
    if (drafting) {
      api.plans(tab.projectId)
        .then((res) => {
          setPlans(res.plans);
          setSkills(res.skills);
        })
        .catch(() => {});
    }
  }, [drafting, tab.projectId]);

  // The selector reads as the current worker; keep the model field in step when the worker changes.
  useEffect(() => setFollowModel(current?.model ?? ''), [current?.provider, current?.model]);
  const modelChanged = current !== null && selectionChangesWorker(current, current.provider, followModel);
  const hint = hintFor(tab);

  const setPerm = (p: PermissionChoice) => {
    setPermission(p);
    try {
      if (p === 'always') {
        localStorage.setItem(alwaysKey, 'true');
      } else {
        localStorage.removeItem(alwaysKey);
      }
    } catch {
      /* ignore */
    }
  };

  const go = async () => {
    const t = text.trim();
    if (!t || !canSend || busy) return;
    setBusy(true);
    try {
      if (drafting) {
        const m: SubmitMode = mode === 'auto' ? { kind: 'auto' } : { kind: 'manual', provider: mode, model: model || null };
        const isFullAuto = fullAutoFor(permission);
        if (!isFullAuto) {
          const parsed = allowedCommands.split('\n').map((l) => l.trim()).filter(Boolean);
          if (JSON.stringify(parsed) !== JSON.stringify(settings.allowedCommands)) {
            try {
              await api.saveSettings({ allowedCommands: parsed });
            } catch {
              /* ignore */
            }
          }
        }
        await onSubmit(t, m, isFullAuto);
      } else {
        await onSend(t);
      }
      setText('');
      setPlanNotice(null);
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

  const providerButton = (p: Provider, on: boolean, onClick: () => void, onTitle: string) => {
    const ok = isSetUp(available, p);
    return (
      <button key={p} className={on ? 'on' : ''} onClick={onClick} role="radio" aria-checked={on} disabled={busy || (!ok && !on)} title={ok ? onTitle : notSetUpTitle(p)}>
        <Glyph provider={p} />
        {PROVIDER_NAMES[p]}
        {!ok && <span className="muted xs">not set up</span>}
      </button>
    );
  };

  const onSelectPlan = (planPath: string) => {
    const p = plans.find((x) => x.path === planPath);
    if (!p) return;
    const planText = `Execute the approved plan at ${p.path} using executing-plans`;
    setText(text.trim() ? `${text.trim()}\n\n${planText}` : planText);
    setPlanNotice(`Approved plan selected: ${p.title || p.name}.`);
  };

  const onSelectSkill = (skillName: string) => {
    if (!skillName) return;
    const prefix = text.trim() ? `${text.trim()}\n\n` : '';
    setText(`${prefix}Use the \`${skillName}\` skill for this task.`);
  };

  return (
    <div className="composer">
      {drafting && (
        <>
          {(plans.length > 0 || skills.length > 0) && (
            <div className="composer-row" style={{ paddingBottom: '4px', gap: '8px' }}>
              {plans.length > 0 && (
                <select
                  className="sm"
                  value=""
                  onChange={(e) => onSelectPlan(e.target.value)}
                  aria-label="Approved plans"
                  title="Insert an approved plan"
                >
                  <option value="" disabled>📋 Approved Plans ({plans.length})</option>
                  {plans.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.title || p.name}
                    </option>
                  ))}
                </select>
              )}
              {skills.length > 0 && (
                <select
                  className="sm"
                  value=""
                  onChange={(e) => onSelectSkill(e.target.value)}
                  aria-label="Agent skills"
                  title="Insert an agent skill into the task prompt"
                >
                  <option value="" disabled>⚡ Skills ({skills.length})</option>
                  {skills.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.source})
                    </option>
                  ))}
                </select>
              )}
              {planNotice && (
                <span className="chip" style={{ '--c': 'var(--ok)', fontSize: 'var(--fs-xs)' } as React.CSSProperties}>
                  {planNotice}
                </span>
              )}
            </div>
          )}

          <div className="composer-row">
            <span className="seg" role="radiogroup" aria-label="Routing">
              <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')} role="radio" aria-checked={mode === 'auto'} title="Council decides, from the providers that are set up">
                {autoLabel(available)}
              </button>
              {PROVIDERS.map((p) => providerButton(p, mode === p, () => setMode(p), `Skip the vote and send to ${PROVIDER_NAMES[p]}`))}
            </span>
            {mode !== 'auto' && (
              <select
                className="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model"
              >
                <option value="">Default model</option>
                {settings.models[mode]?.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <span className="spacer" />

            {/* Intuitive command execution permission prompt */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="muted xs">Commands:</span>
              <span className="seg" role="radiogroup" aria-label="Command execution permission">
                <button
                  type="button"
                  className={permission === 'restricted' ? 'on' : ''}
                  aria-checked={permission === 'restricted'}
                  role="radio"
                  onClick={() => {
                    setPerm('restricted');
                    setShowCommands(true);
                  }}
                  title="Edits are auto-approved; shell commands are held to the allow-list and Codex keeps its sandbox"
                >
                  🛡️ Restricted
                </button>
                <button
                  type="button"
                  className={permission === 'full-auto' ? 'on' : ''}
                  aria-checked={permission === 'full-auto'}
                  role="radio"
                  onClick={() => {
                    setPerm('full-auto');
                    setShowCommands(false);
                  }}
                  title="Full auto for this task: no sandbox and no approvals — the worker can run any command"
                >
                  ⚡ Full auto
                </button>
                <button
                  type="button"
                  className={permission === 'always' ? 'on' : ''}
                  aria-checked={permission === 'always'}
                  role="radio"
                  onClick={() => {
                    setPerm('always');
                    setShowCommands(false);
                  }}
                  title="Full auto for every task in this project, until you change it back"
                >
                  ⚡ Always full auto
                </button>
              </span>
            </div>
          </div>

          {permission === 'restricted' && showCommands && (
            <div
              className="card"
              style={{
                margin: '4px 0 8px',
                padding: '8px 10px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, margin: 0 }}>
                  Allowed commands for restricted Claude workers (one per line)
                </label>
                <button
                  type="button"
                  className="link xs"
                  onClick={() => setShowCommands(false)}
                  title="Hide allowed commands input"
                >
                  ✕ close
                </button>
              </div>
              <textarea
                rows={3}
                value={allowedCommands}
                onChange={(e) => setAllowedCommands(e.target.value)}
                placeholder="Bash(npm test*)"
                aria-label="Allowed commands for restricted Claude workers (one per line)"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-xs)',
                  width: '100%',
                  background: 'var(--surface)',
                }}
              />
            </div>
          )}
        </>
      )}

      {!drafting && canSend && current && (
        <div className="composer-row">
          <span className="seg" role="radiogroup" aria-label="Follow-up worker">
            {PROVIDERS.map((p) =>
              providerButton(
                p,
                current.provider === p,
                () => {
                  if (selectionChangesWorker(current, p, '')) void onSwitch(p, null);
                },
                current.provider === p ? 'The current worker' : `Hand the tab to ${PROVIDER_NAMES[p]}, like Switch worker`,
              ),
            )}
          </span>
          <select
            className="model"
            value={followModel}
            onChange={(e) => setFollowModel(e.target.value)}
            aria-label="Follow-up model"
          >
            <option value="">Default model</option>
            {settings.models[current.provider]?.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {modelChanged && (
            <button className="link sm" disabled={busy} onClick={() => void onSwitch(current.provider, followModel.trim() || null)} title="The session continues with this model from the next message">
              use this model
            </button>
          )}
          <span className="spacer" />
          {tab.fullAuto ? (
            <span className="chip" style={{ '--c': 'var(--ok)' } as React.CSSProperties} title="Commands allowed for this tab">
              ⚡ commands allowed
            </span>
          ) : (
            <span className="chip" style={{ '--c': 'var(--warn)' } as React.CSSProperties} title="Commands restricted for this tab">
              🛡️ commands restricted
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
