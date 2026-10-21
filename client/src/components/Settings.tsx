import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { PROVIDER_NAMES } from '../lib/format';
import { editableSettings } from '../lib/settingsPatch';
import { PROVIDERS, TIERS, type CliHealth, type PriceTable, type Provider, type Seat, type Settings as SettingsT } from '../types';
import { Glyph } from './Glyph';
import { Health } from './Health';

interface Props {
  settings: SettingsT;
  onSaved: (s: SettingsT) => void;
  health: Record<Provider, CliHealth> | null;
  onError: (m: string) => void;
}

const SECTIONS: { id: string; label: string }[] = [
  { id: 's-health', label: 'Health' },
  { id: 's-budgets', label: 'Budgets' },
  { id: 's-seats', label: 'Council seats' },
  { id: 's-routing', label: 'Routing' },
  { id: 's-permissions', label: 'Permissions' },
  { id: 's-models', label: 'Models' },
  { id: 's-prices', label: 'Prices' },
];

function SeatRow({ seat, models, onChange, onRemove, label }: { seat: Seat; models: Record<Provider, string[]>; onChange: (s: Seat) => void; onRemove?: () => void; label: string }) {
  const listId = `seat-models-${label.replace(/\W+/g, '-')}-${seat.provider}`;
  return (
    <div className="seat-row">
      <Glyph provider={seat.provider} />
      <select value={seat.provider} onChange={(e) => onChange({ ...seat, provider: e.target.value as Provider })} aria-label={`${label} provider`}>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_NAMES[p]}
          </option>
        ))}
      </select>
      <input list={listId} value={seat.model ?? ''} onChange={(e) => onChange({ ...seat, model: e.target.value || null })} placeholder="default model" aria-label={`${label} model`} />
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

export function Settings({ settings, onSaved, health, onError }: Props) {
  const [s, setS] = useState<SettingsT>(settings);
  const [pricing, setPricing] = useState<PriceTable | null>(null);
  const [loadedPricing, setLoadedPricing] = useState<PriceTable | null>(null);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

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

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const lines = (v: string) =>
    v
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  return (
    <main className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {SECTIONS.map((sec) => (
          <a key={sec.id} href={`#${sec.id}`} onClick={jump(sec.id)}>
            {sec.label}
          </a>
        ))}
      </nav>

      <div className="settings-body">
        <Health health={health} id="s-health" />

        <section className="card" id="s-budgets">
          <header className="card-title">Monthly budgets (USD)</header>
          <div className="grid3">
            {PROVIDERS.map((p) => (
              <label key={p}>
                <span className="row gap-sm">
                  <Glyph provider={p} />
                  {PROVIDER_NAMES[p]}
                </span>
                <input type="number" min={0} step={1} value={s.budgets[p]} onChange={(e) => setS({ ...s, budgets: { ...s.budgets, [p]: num(e.target.value, 0) } })} />
              </label>
            ))}
            <label>
              Warn at (fraction)
              <input type="number" min={0} max={1} step={0.05} value={s.warnPct} onChange={(e) => setS({ ...s, warnPct: num(e.target.value, 0.8) })} />
            </label>
            <label>
              Reset day of month
              <input type="number" min={1} max={31} value={s.resetDay} onChange={(e) => setS({ ...s, resetDay: num(e.target.value, 1) })} />
            </label>
          </div>
          <p className="muted sm">0 disables tracking for a provider. Claude Code reports its own cost; Codex and Gemini are priced from the table below.</p>
        </section>

        <section className="card" id="s-seats">
          <header className="card-title">Council seats</header>
          {s.seats.map((seat, i) => (
            <SeatRow
              key={i}
              label={`Seat ${i + 1}`}
              seat={seat}
              models={s.models}
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
          <div className="grid3">
            <label>
              Seat timeout (seconds)
              <input type="number" min={5} value={s.seatTimeoutMs / 1000} onChange={(e) => setS({ ...s, seatTimeoutMs: num(e.target.value, 60) * 1000 })} />
            </label>
            <label>
              Per-vote cost ceiling (USD)
              <input type="number" min={0} step={0.01} value={s.voteCostCeiling} onChange={(e) => setS({ ...s, voteCostCeiling: num(e.target.value, 0.05) })} />
            </label>
          </div>
          <p className="muted sm">Every task pays for every seat, so keep them cheap. Seats are asked not to open files or run tools; only Claude can be forced tool-less, so this is best effort.</p>
        </section>

        <section className="card" id="s-routing">
          <header className="card-title">Who does what</header>
          {TIERS.map((t) => (
            <div key={t} className="seat-row">
              <span className={`tier tier-${t}`} style={{ width: 60, textAlign: 'center' }}>
                {t}
              </span>
              <SeatRow label={`${t} tier`} seat={s.tierMap[t]} models={s.models} onChange={(ns) => setS({ ...s, tierMap: { ...s.tierMap, [t]: ns } })} />
            </div>
          ))}
          <div className="row wrap">
            <label>
              <input type="checkbox" checked={s.autoStart} onChange={(e) => setS({ ...s, autoStart: e.target.checked })} /> start the worker right after the vote
            </label>
            <label>
              <input type="checkbox" checked={s.autoEscalate} onChange={(e) => setS({ ...s, autoEscalate: e.target.checked })} /> escalate once automatically when a worker fails
            </label>
            <label>
              Stall after (minutes)
              <input type="number" min={1} value={s.stallMinutes} onChange={(e) => setS({ ...s, stallMinutes: num(e.target.value, 10) })} />
            </label>
          </div>
        </section>

        <section className="card" id="s-permissions">
          <header className="card-title">Allowed commands for Claude workers</header>
          <textarea rows={6} value={s.allowedCommands.join('\n')} onChange={(e) => setS({ ...s, allowedCommands: lines(e.target.value) })} aria-label="Allowed commands, one per line" />
          <p className="muted sm">
            One Claude Code <code>--allowedTools</code> pattern per line, such as <code>Bash(npm test*)</code>. Gemini auto-approves edits only; Codex runs in a workspace-write sandbox. Full auto on a tab bypasses all of this.
          </p>
        </section>

        <section className="card" id="s-models">
          <header className="card-title">Model choices offered in menus</header>
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
          <p className="muted sm">One model per line. Any model name can still be typed into a model field.</p>
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
          <p className="muted sm">A row can be an exact model name, a prefix, or provider:default. Save writes this whole table to ~/.council/pricing.json, so a removed row stays removed. Delete that file to get the defaults back.</p>
        </section>

        <div className="savebar" role="status">
          {dirty ? <span className="dirty">Unsaved changes</span> : savedAt ? <span>Saved at {savedAt}</span> : <span>No changes</span>}
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
