import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { PROVIDER_NAMES } from '../lib/format';
import { type Availability } from '../lib/routing';
import { editableSettings } from '../lib/settingsPatch';
import { PROVIDERS, TIERS, type CliHealth, type PriceTable, type Provider, type Seat, type Settings as SettingsT, type Tier } from '../types';
import { Glyph } from './Glyph';
import { Health } from './Health';
import { ProviderSelect } from './ProviderSelect';

interface Props {
  settings: SettingsT;
  onSaved: (s: SettingsT) => void;
  health: Record<Provider, CliHealth> | null;
  available: Availability;
  onError: (m: string) => void;
}

const TIER_WORDS: Record<Tier, string> = { easy: 'Easy tasks', medium: 'Medium tasks', hard: 'Hard tasks' };

function SeatRow({ seat, models, available, onChange, onRemove, label }: { seat: Seat; models: Record<Provider, string[]>; available: Availability; onChange: (s: Seat) => void; onRemove?: () => void; label: string }) {
  const listId = `seat-models-${label.replace(/\W+/g, '-')}-${seat.provider}`;
  return (
    <div className="seat-row">
      <Glyph provider={seat.provider} />
      <ProviderSelect value={seat.provider} onChange={(p) => onChange({ ...seat, provider: p })} available={available} ariaLabel={`${label}: provider`} />
      <input list={listId} value={seat.model ?? ''} onChange={(e) => onChange({ ...seat, model: e.target.value || null })} placeholder="default model" aria-label={`${label}: model`} />
      <datalist id={listId}>
        {models[seat.provider].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {onRemove && (
        <button className="link sm" onClick={onRemove}>
          remove
        </button>
      )}
    </div>
  );
}

function healthProblems(health: Record<Provider, CliHealth> | null): string[] {
  if (!health) return [];
  return PROVIDERS.flatMap((p) => {
    const h = health[p];
    if (!h) return [];
    if (!h.installed) return [`${PROVIDER_NAMES[p]} is not installed`];
    if (!h.authed) return [`${PROVIDER_NAMES[p]} is not signed in`];
    return [];
  });
}

/**
 * The simple page holds what a developer actually changes: budgets, who does
 * what, the council seats and two toggles. Everything else sits behind
 * "Advanced" with defaults that most people never touch.
 */
export function Settings({ settings, onSaved, health, available, onError }: Props) {
  const [s, setS] = useState<SettingsT>(settings);
  const [pricing, setPricing] = useState<PriceTable | null>(null);
  const [loadedPricing, setLoadedPricing] = useState<PriceTable | null>(null);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    api
      .pricing()
      .then((p) => {
        setPricing(p);
        setLoadedPricing(p);
      })
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const dirtySettings = useMemo(() => JSON.stringify(editableSettings(s)) !== JSON.stringify(editableSettings(settings)), [s, settings]);
  const dirtyPricing = useMemo(() => pricing !== null && loadedPricing !== null && JSON.stringify(pricing) !== JSON.stringify(loadedPricing), [pricing, loadedPricing]);
  const dirty = dirtySettings || dirtyPricing;
  const problems = healthProblems(health);

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);
  const lines = (v: string) =>
    v
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      if (dirtySettings) onSaved(await api.saveSettings(editableSettings(s)));
      if (dirtyPricing && pricing) setLoadedPricing(await api.savePricing(pricing));
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setS(settings);
    setPricing(loadedPricing);
  };

  return (
    <main className="settings">
      <div className="settings-body">
        <header className="settings-head">
          <h2>Settings</h2>
          <p className="sec">Council works out of the box. These are the few things worth changing; the rest is under Advanced.</p>
        </header>

        {problems.length > 0 && (
          <div className="card warn sm" role="status">
            <span>
              {problems.join(' · ')}. Auto routing avoids a provider that cannot run.{' '}
              <button className="link sm" onClick={() => setAdvanced(true)}>
                See CLI health
              </button>
            </span>
          </div>
        )}

        <section className="card" id="s-budgets">
          <header className="card-title">Monthly budgets</header>
          <div className="money-row">
            {PROVIDERS.map((p) => (
              <label key={p}>
                <span className="row gap-sm">
                  <Glyph provider={p} />
                  {PROVIDER_NAMES[p]}
                </span>
                <span className="money">
                  <i>$</i>
                  <input type="number" min={0} step={1} value={s.budgets[p]} onChange={(e) => setS({ ...s, budgets: { ...s.budgets, [p]: num(e.target.value, 0) } })} aria-label={`${PROVIDER_NAMES[p]} monthly budget in USD`} />
                </span>
              </label>
            ))}
          </div>
          <p className="muted sm">Per month, in USD. The bar turns amber at {Math.round(s.warnPct * 100)}%; at 100% the provider is skipped by auto routing. 0 means untracked.</p>
        </section>

        <section className="card" id="s-routing">
          <header className="card-title">Who does what</header>
          {TIERS.map((t) => (
            <div key={t} className="seat-row">
              <span className={`tier tier-${t} tier-wide`}>{t}</span>
              <span className="sec tier-word">{TIER_WORDS[t]} →</span>
              <SeatRow label={TIER_WORDS[t]} seat={s.tierMap[t]} models={s.models} available={available} onChange={(ns) => setS({ ...s, tierMap: { ...s.tierMap, [t]: ns } })} />
            </div>
          ))}
          <div className="toggles">
            <label>
              <input type="checkbox" checked={s.autoStart} onChange={(e) => setS({ ...s, autoStart: e.target.checked })} /> Start the worker right after the vote
            </label>
            <label>
              <input type="checkbox" checked={s.autoEscalate} onChange={(e) => setS({ ...s, autoEscalate: e.target.checked })} /> If a worker fails, hand the task up one tier once
            </label>
          </div>
        </section>

        <section className="card" id="s-seats">
          <header className="card-title">Council seats</header>
          <p className="muted sm">The models that rate each task easy, medium or hard. Every task pays for every seat, so keep them cheap.</p>
          {s.seats.map((seat, i) => (
            <SeatRow
              key={i}
              label={`Seat ${i + 1}`}
              seat={seat}
              models={s.models}
              available={available}
              onChange={(ns) => setS({ ...s, seats: s.seats.map((x, j) => (j === i ? ns : x)) })}
              onRemove={s.seats.length > 1 ? () => setS({ ...s, seats: s.seats.filter((_, j) => j !== i) }) : undefined}
            />
          ))}
          {s.seats.length < 5 && (
            <div>
              <button className="link sm" onClick={() => setS({ ...s, seats: [...s.seats, { provider: 'gemini', model: 'flash' }] })}>
                + add seat
              </button>
            </div>
          )}
        </section>

        <section className="advanced">
          <button className="advanced-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            <span className="caret">{advanced ? '▾' : '▸'}</span>
            Advanced
            <span className="muted sm">budget rules, council limits, permissions, models, prices, CLI health</span>
          </button>

          {advanced && (
            <div className="advanced-body">
              <section className="card" id="s-budget-rules">
                <header className="card-title">Budget rules</header>
                <div className="grid3">
                  <label>
                    Warn at (% of budget)
                    <input type="number" min={0} max={100} step={5} value={Math.round(s.warnPct * 100)} onChange={(e) => setS({ ...s, warnPct: num(e.target.value, 80) / 100 })} />
                  </label>
                  <label>
                    Reset on day of month
                    <input type="number" min={1} max={31} value={s.resetDay} onChange={(e) => setS({ ...s, resetDay: num(e.target.value, 1) })} />
                  </label>
                </div>
                <p className="muted sm">Claude Code reports its own cost. Codex and Gemini are priced from the table below.</p>
              </section>

              <section className="card" id="s-limits">
                <header className="card-title">Council and worker limits</header>
                <div className="grid3">
                  <label>
                    Seat timeout (seconds)
                    <input type="number" min={5} value={s.seatTimeoutMs / 1000} onChange={(e) => setS({ ...s, seatTimeoutMs: num(e.target.value, 60) * 1000 })} />
                  </label>
                  <label>
                    Per-vote cost ceiling (USD)
                    <input type="number" min={0} step={0.01} value={s.voteCostCeiling} onChange={(e) => setS({ ...s, voteCostCeiling: num(e.target.value, 0.05) })} />
                  </label>
                  <label>
                    Stall after (minutes of silence)
                    <input type="number" min={1} value={s.stallMinutes} onChange={(e) => setS({ ...s, stallMinutes: num(e.target.value, 10) })} />
                  </label>
                </div>
                <p className="muted sm">Seats are asked not to open files or run tools; only Claude can be forced tool-less, so the ceiling is a flag, not a hard stop.</p>
              </section>

              <section className="card" id="s-permissions">
                <header className="card-title">Commands Claude workers may run</header>
                <textarea rows={5} value={s.allowedCommands.join('\n')} onChange={(e) => setS({ ...s, allowedCommands: lines(e.target.value) })} aria-label="Allowed commands, one per line" />
                <p className="muted sm">
                  One Claude Code <code>--allowedTools</code> pattern per line, like <code>Bash(npm test*)</code>. Gemini auto-approves edits only; Codex runs in a workspace-write sandbox. Full auto on a tab lifts all of this.
                </p>
              </section>

              <section className="card" id="s-models">
                <header className="card-title">Models offered in menus</header>
                <div className="grid3">
                  {PROVIDERS.map((p) => (
                    <label key={p}>
                      <span className="row gap-sm">
                        <Glyph provider={p} />
                        {PROVIDER_NAMES[p]}
                      </span>
                      <textarea rows={4} value={s.models[p].join('\n')} onChange={(e) => setS({ ...s, models: { ...s.models, [p]: lines(e.target.value) } })} aria-label={`${PROVIDER_NAMES[p]} models, one per line`} />
                    </label>
                  ))}
                </div>
                <p className="muted sm">One per line. Any model name can still be typed into a model field.</p>
              </section>

              <section className="card" id="s-prices">
                <header className="card-title">Prices (USD per million tokens)</header>
                {pricing ? (
                  <table className="plain">
                    <thead>
                      <tr>
                        <th>Model or prefix</th>
                        <th>Input</th>
                        <th>Cached input</th>
                        <th>Output</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(pricing).map(([key, price]) => (
                        <tr key={key}>
                          <td>
                            <code>{key}</code>
                          </td>
                          {(['inputPerM', 'cachedInputPerM', 'outputPerM'] as const).map((f) => (
                            <td key={f}>
                              <input type="number" min={0} step={0.001} value={price[f]} onChange={(e) => setPricing({ ...pricing, [key]: { ...price, [f]: num(e.target.value, 0) } })} aria-label={`${key} ${f}`} />
                            </td>
                          ))}
                          <td>
                            <button
                              className="link sm"
                              onClick={() => {
                                const next = { ...pricing };
                                delete next[key];
                                setPricing(next);
                              }}
                            >
                              remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <span className="muted">loading…</span>
                )}
                <div className="row">
                  <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="model name, prefix, or provider:default" aria-label="New price key" />
                  <button
                    className="sm"
                    disabled={!newKey.trim() || !pricing}
                    onClick={() => {
                      if (!pricing) return;
                      setPricing({ ...pricing, [newKey.trim()]: { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 } });
                      setNewKey('');
                    }}
                  >
                    + add row
                  </button>
                </div>
                <p className="muted sm">A row can be an exact model name, a prefix, or provider:default. Save writes the whole table to ~/.council/pricing.json; delete that file to get the defaults back.</p>
              </section>

              <Health health={health} id="s-health" />
            </div>
          )}
        </section>

        <div className={`savebar${dirty ? ' is-dirty' : ''}`} role="status">
          {dirty ? <span className="dirty">Unsaved changes</span> : savedAt ? <span>Saved at {savedAt}</span> : <span>Everything is saved</span>}
          <button className="quiet" onClick={revert} disabled={!dirty || saving}>
            Revert
          </button>
          <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </main>
  );
}
