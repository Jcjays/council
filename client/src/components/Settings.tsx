import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { PROVIDER_NAMES } from '../lib/format';
import { priceBadge, priceTitle, modelLabel } from '../lib/models';
import { askModeNote, AUTO_NOTE } from '../lib/permissions';
import { pricesLine } from '../lib/plan';
import { isSetUp, type Availability } from '../lib/routing';
import {
  PROVIDERS,
  type BudgetState,
  type CliHealth,
  type EffectiveRouting,
  type ModelCatalog,
  type PriceTable,
  type PricingStatus,
  type Provider,
  type Settings as SettingsT,
} from '../types';
import { Glyph } from './Glyph';
import { Health } from './Health';
import { ModelPicker } from './ModelPicker';
import { PlanUsage } from './PlanUsage';

interface Props {
  settings: SettingsT;
  onSaved: (s: SettingsT) => void;
  health: Record<Provider, CliHealth> | null;
  available: Availability;
  routing: EffectiveRouting | null;
  budgets: Record<Provider, BudgetState> | null;
  onBudgets: (b: Record<Provider, BudgetState>) => void;
  catalog: ModelCatalog | null;
  /** Prices changed: re-read the model catalog so its price badges follow. */
  onPricesChanged: () => void;
  onError: (m: string) => void;
}

/** The fields this page edits; nothing else is sent on Save. */
const EDITABLE = ['seats', 'permissionMode', 'autoStart', 'autoEscalate', 'spendCaps', 'warnPct', 'resetDay', 'seatTimeoutMs', 'voteCostCeiling', 'stallMinutes'] as const;
type Editable = Pick<SettingsT, (typeof EDITABLE)[number]>;

function editable(s: SettingsT): Editable {
  return Object.fromEntries(EDITABLE.map((k) => [k, s[k]])) as Editable;
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

const num = (v: string, fallback: number) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Hand-set price rows, under Advanced. */
function PriceOverrides({ overrides, onChange }: { overrides: PriceTable; onChange: (t: PriceTable) => void }) {
  const [key, setKey] = useState('');
  const rows = Object.entries(overrides);
  return (
    <>
      {rows.length > 0 && (
        <table className="plain">
          <thead>
            <tr>
              <th>Model</th>
              <th>Input</th>
              <th>Cached input</th>
              <th>Output</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, price]) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                {(['inputPerM', 'cachedInputPerM', 'outputPerM'] as const).map((f) => (
                  <td key={f}>
                    <input type="number" min={0} step={0.001} value={price[f]} onChange={(e) => onChange({ ...overrides, [k]: { ...price, [f]: num(e.target.value, 0) } })} aria-label={`${k} ${f}`} />
                  </td>
                ))}
                <td>
                  <button
                    className="link sm"
                    onClick={() => {
                      const next = { ...overrides };
                      delete next[k];
                      onChange(next);
                    }}
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="model name, prefix, or provider:default" aria-label="Model to price by hand" />
        <button
          className="sm"
          disabled={!key.trim()}
          onClick={() => {
            onChange({ ...overrides, [key.trim()]: { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 } });
            setKey('');
          }}
        >
          + override
        </button>
      </div>
    </>
  );
}

/**
 * What a developer actually decides: who does what, the council, whether
 * workers ask first, and two flow toggles. Plans, usage and prices are
 * detected and shown here; everything else sits under Advanced.
 */
export function Settings({ settings, onSaved, health, available, routing, budgets, onBudgets, catalog, onPricesChanged, onError }: Props) {
  const [s, setS] = useState<SettingsT>(settings);
  const [pricing, setPricing] = useState<PricingStatus | null>(null);
  const [overrides, setOverrides] = useState<PriceTable>({});
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    api
      .pricing()
      .then((p) => {
        setPricing(p);
        setOverrides(p.overrides);
      })
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const dirtySettings = useMemo(() => JSON.stringify(editable(s)) !== JSON.stringify(editable(settings)), [s, settings]);
  const dirtyPrices = pricing !== null && JSON.stringify(overrides) !== JSON.stringify(pricing.overrides);
  const dirty = dirtySettings || dirtyPrices;
  const problems = healthProblems(health);

  const save = async () => {
    setSaving(true);
    try {
      if (dirtySettings) onSaved(await api.saveSettings(editable(s)));
      if (dirtyPrices) {
        const p = await api.savePriceOverrides(overrides);
        setPricing(p);
        setOverrides(p.overrides);
        onPricesChanged();
      }
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const refreshPrices = async () => {
    setRefreshingPrices(true);
    try {
      const p = await api.refreshPrices();
      setPricing(p);
      if (!dirtyPrices) setOverrides(p.overrides);
      if (p.lastError && p.fetchedAt === null) onError(`Prices could not be fetched: ${p.lastError}`);
      onPricesChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRefreshingPrices(false);
    }
  };

  const ask = s.permissionMode === 'ask';
  const usable = PROVIDERS.filter((p) => isSetUp(available, p));

  return (
    <main className="settings">
      <header className="tab-header">
        <div className="tab-heading">
          <h2>Settings</h2>
          <span className="sec sm">Plans, usage, prices and models are detected for you. These are the few choices that are yours.</span>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="card warn sm" role="status">
          <span>
            {problems.join(' · ')}. Routing leaves out a CLI that cannot run.{' '}
            <button className="link sm" onClick={() => setAdvanced(true)}>
              See CLI health
            </button>
          </span>
        </div>
      )}

      <section className="card" id="s-seats" aria-labelledby="s-seats-h">
        <header className="card-title" id="s-seats-h">
          Council seats
        </header>
        <p className="muted sm">
          The models that judge each task. Every seat sees the task and the models that are set up, weighs the complexity, and names the cheapest model it is confident
          can do it; the pick with the most seats wins, and unsure seats move it one rung up. Every task pays for every seat, so keep them cheap.
        </p>
        {routing && routing.ladder.length > 0 && (
          <p className="muted xs" title="Escalation climbs this list one rung at a time">
            They pick from, cheapest first: {routing.ladder.map((r) => r.label).join(' → ')}.
          </p>
        )}
        <div className="seat-chips">
          {s.seats.map((seat, i) => {
            const m = catalog?.[seat.provider]?.find((c) => c.id === seat.model);
            const off = !isSetUp(available, seat.provider);
            return (
              <span key={`${seat.provider}:${seat.model}:${i}`} className={`seat-chip${off ? ' off' : ''}`} title={off ? `${PROVIDER_NAMES[seat.provider]} is not set up, so this seat sits out` : m?.price ? priceTitle(m.price) : undefined}>
                <Glyph provider={seat.provider} />
                <span>{modelLabel(catalog, seat.provider, seat.model)}</span>
                {m?.price && <span className="price">{priceBadge(m.price)}</span>}
                {off && <span className="xs">not set up</span>}
                {s.seats.length > 1 && (
                  <button className="chip-x" onClick={() => setS({ ...s, seats: s.seats.filter((_, j) => j !== i) })} aria-label={`Remove the ${modelLabel(catalog, seat.provider, seat.model)} seat`} title="Remove this seat">
                    ×
                  </button>
                )}
              </span>
            );
          })}
          {s.seats.length < 9 && (
            <ModelPicker value={null} placeholder="+ Add a seat" onChange={(pick) => setS({ ...s, seats: [...s.seats, pick] })} catalog={catalog} available={available} ariaLabel="Add a council seat" allowDefault={false} />
          )}
        </div>
      </section>

      <section className="card" id="s-permissions" aria-labelledby="s-permissions-h">
        <header className="card-title" id="s-permissions-h">
          Permissions for new tabs
        </header>
        <span className="seg" role="radiogroup" aria-label="Permissions for new tabs">
          <button className={ask ? 'on' : ''} role="radio" aria-checked={ask} onClick={() => setS({ ...s, permissionMode: 'ask' })}>
            Ask me
          </button>
          <button className={!ask ? 'on' : ''} role="radio" aria-checked={!ask} onClick={() => setS({ ...s, permissionMode: 'auto' })}>
            Auto
          </button>
        </span>
        {ask ? (
          <ul className="perm-notes">
            {(usable.length > 0 ? usable : PROVIDERS).map((p) => (
              <li key={p}>
                <Glyph provider={p} /> {askModeNote(p)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="sm warn-text">{AUTO_NOTE}</p>
        )}
        <p className="muted xs">Any tab can switch between Ask me and Auto from its composer.</p>
      </section>

      <section className="card" id="s-flow" aria-labelledby="s-flow-h">
        <header className="card-title" id="s-flow-h">
          Flow
        </header>
        <div className="toggles">
          <label>
            <input type="checkbox" checked={s.autoStart} onChange={(e) => setS({ ...s, autoStart: e.target.checked })} /> Start the worker right after the vote
          </label>
          <label>
            <input type="checkbox" checked={s.autoEscalate} onChange={(e) => setS({ ...s, autoEscalate: e.target.checked })} /> If a worker fails, hand the task up one tier once
          </label>
        </div>
      </section>

      <PlanUsage budgets={budgets} health={health} available={available} onBudgets={onBudgets} onError={onError} />

      <section className="card prices-line" id="s-prices" aria-label="Prices">
        <span className="sm">{pricing ? pricesLine(pricing) : 'Loading prices…'}</span>
        {pricing?.fetchedAt && pricing.lastError && <span className="xs warn-text">({pricing.lastError})</span>}
        <span className="grow" />
        <button className="sm" disabled={refreshingPrices} onClick={() => void refreshPrices()} title="Fetch current prices from LiteLLM's and OpenRouter's public lists (no key needed). Also happens by itself weekly.">
          {refreshingPrices ? 'Refreshing…' : 'Refresh prices'}
        </button>
      </section>

      <section className="advanced">
        <button className="advanced-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          <span className="caret">{advanced ? '▾' : '▸'}</span>
          Advanced
          <span className="muted sm">spend caps, council limits, price overrides, CLI health</span>
        </button>

        {advanced && (
          <div className="advanced-body">
            <section className="card" id="s-caps">
              <header className="card-title">Monthly spend caps (API-key accounts)</header>
              <div className="grid3">
                {PROVIDERS.map((p) => (
                  <label key={p}>
                    <span className="row gap-sm">
                      <Glyph provider={p} />
                      {PROVIDER_NAMES[p]}
                    </span>
                    <span className="money">
                      <i>$</i>
                      <input type="number" min={0} step={1} value={s.spendCaps[p]} onChange={(e) => setS({ ...s, spendCaps: { ...s.spendCaps, [p]: num(e.target.value, 0) } })} aria-label={`${PROVIDER_NAMES[p]} monthly cap in USD`} />
                    </span>
                  </label>
                ))}
              </div>
              <div className="grid3">
                <label>
                  Warn at (% of a cap or window)
                  <input type="number" min={0} max={100} step={5} value={Math.round(s.warnPct * 100)} onChange={(e) => setS({ ...s, warnPct: num(e.target.value, 80) / 100 })} />
                </label>
                <label>
                  Month starts on day
                  <input type="number" min={1} max={31} value={s.resetDay} onChange={(e) => setS({ ...s, resetDay: num(e.target.value, 1) })} />
                </label>
              </div>
              <p className="muted sm">
                0 means no cap. A cap only applies to a provider paid per use (an API key); once reached, routing goes around it. A subscription is judged by its usage windows instead.
              </p>
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
            </section>

            <section className="card" id="s-overrides">
              <header className="card-title">Price overrides (USD per million tokens)</header>
              <p className="muted sm">Fetched prices cover the usual models. Price a model by hand here only if it is missing or wrong; an override beats the fetched price.</p>
              <PriceOverrides overrides={overrides} onChange={setOverrides} />
            </section>

            <Health health={health} />
          </div>
        )}
      </section>

      <div className={`savebar${dirty ? ' is-dirty' : ''}`} role="status">
        {dirty ? <span className="dirty">Unsaved changes</span> : savedAt ? <span>Saved at {savedAt}</span> : <span>Everything is saved</span>}
        <span className="grow" />
        <button
          className="quiet"
          onClick={() => {
            setS(settings);
            if (pricing) setOverrides(pricing.overrides);
          }}
          disabled={!dirty || saving}
        >
          Revert
        </button>
        <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </main>
  );
}
