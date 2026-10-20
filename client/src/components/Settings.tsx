import { useEffect, useState } from 'react';
import { api } from '../api';
import { PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, TIERS, type CliHealth, type PriceTable, type Provider, type Seat, type Settings as SettingsT } from '../types';
import { Health } from './Health';

interface Props {
  settings: SettingsT;
  onSaved: (s: SettingsT) => void;
  health: Record<Provider, CliHealth> | null;
  onError: (m: string) => void;
}

function SeatRow({ seat, models, onChange, onRemove }: { seat: Seat; models: Record<Provider, string[]>; onChange: (s: Seat) => void; onRemove?: () => void }) {
  return (
    <div className="row">
      <select value={seat.provider} onChange={(e) => onChange({ ...seat, provider: e.target.value as Provider })} aria-label="Seat provider">
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_NAMES[p]}
          </option>
        ))}
      </select>
      <input
        list={`seat-models-${seat.provider}`}
        value={seat.model ?? ''}
        onChange={(e) => onChange({ ...seat, model: e.target.value || null })}
        placeholder="default model"
        aria-label="Seat model"
      />
      <datalist id={`seat-models-${seat.provider}`}>
        {models[seat.provider].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {onRemove && (
        <button className="link" onClick={onRemove}>
          remove
        </button>
      )}
    </div>
  );
}

export function Settings({ settings, onSaved, health, onError }: Props) {
  const [s, setS] = useState<SettingsT>(settings);
  const [pricing, setPricing] = useState<PriceTable | null>(null);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    api.pricing().then(setPricing).catch((e: Error) => onError(e.message));
  }, [onError]);

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.saveSettings(s);
      onSaved(saved);
      if (pricing) await api.savePricing(pricing);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="settings">
      <header className="tab-header">
        <h2>Settings</h2>
        <div className="row">
          {savedAt && <span className="muted small">saved {savedAt}</span>}
          <button className="primary" onClick={() => void save()} disabled={saving}>
            Save
          </button>
        </div>
      </header>

      <Health health={health} />

      <section className="card">
        <header className="card-title">Monthly budgets (USD)</header>
        <div className="grid3">
          {PROVIDERS.map((p) => (
            <label key={p}>
              {PROVIDER_NAMES[p]}
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
        <p className="muted small">0 disables tracking for a provider. Claude Code reports its own cost; Codex and Gemini are priced from the table below.</p>
      </section>

      <section className="card">
        <header className="card-title">Council seats</header>
        {s.seats.map((seat, i) => (
          <SeatRow
            key={i}
            seat={seat}
            models={s.models}
            onChange={(ns) => setS({ ...s, seats: s.seats.map((x, j) => (j === i ? ns : x)) })}
            onRemove={s.seats.length > 1 ? () => setS({ ...s, seats: s.seats.filter((_, j) => j !== i) }) : undefined}
          />
        ))}
        {s.seats.length < 5 && (
          <button className="link" onClick={() => setS({ ...s, seats: [...s.seats, { provider: 'gemini', model: 'flash' }] })}>
            + add seat
          </button>
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
        <p className="muted small">Seats are asked not to open files or run tools; only Claude can be forced tool-less, so this is best effort.</p>
      </section>

      <section className="card">
        <header className="card-title">Who does what</header>
        {TIERS.map((t) => (
          <div key={t} className="row">
            <span className={`tier tier-${t}`}>{t}</span>
            <SeatRow seat={s.tierMap[t]} models={s.models} onChange={(ns) => setS({ ...s, tierMap: { ...s.tierMap, [t]: ns } })} />
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

      <section className="card">
        <header className="card-title">Allowed commands for Claude workers (one per line)</header>
        <textarea rows={6} value={s.allowedCommands.join('\n')} onChange={(e) => setS({ ...s, allowedCommands: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })} />
        <p className="muted small">Claude Code `--allowedTools` patterns. Gemini auto-approves edits only; Codex runs in a workspace-write sandbox. Full auto on a tab bypasses all of this.</p>
      </section>

      <section className="card">
        <header className="card-title">Model choices offered in menus</header>
        <div className="grid3">
          {PROVIDERS.map((p) => (
            <label key={p}>
              {PROVIDER_NAMES[p]}
              <textarea rows={4} value={s.models[p].join('\n')} onChange={(e) => setS({ ...s, models: { ...s.models, [p]: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) } })} />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
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
                      <input type="number" min={0} step={0.001} value={price[f]} onChange={(e) => setPricing({ ...pricing, [key]: { ...price, [f]: num(e.target.value, 0) } })} />
                    </td>
                  ))}
                  <td>
                    <button
                      className="link"
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
            className="link"
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
        <p className="muted small">Removing a row here only removes it from the saved table on Save; the defaults are restored if the file is deleted.</p>
      </section>
    </main>
  );
}
