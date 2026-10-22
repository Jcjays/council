import { useState } from 'react';
import { api } from '../api';
import { describeWindow, PROVIDER_NAMES } from '../lib/format';
import { planKindLabel, spendLine } from '../lib/plan';
import { isSetUp, type Availability } from '../lib/routing';
import { PROVIDERS, type BudgetState, type CliHealth, type Provider } from '../types';
import { Glyph } from './Glyph';

interface Props {
  budgets: Record<Provider, BudgetState> | null;
  health: Record<Provider, CliHealth> | null;
  available: Availability;
  onBudgets: (b: Record<Provider, BudgetState>) => void;
  onError: (m: string) => void;
}

/** Where usage windows come from, when none has been seen yet. */
const NO_WINDOWS: Record<Provider, string> = {
  claude: 'Usage windows appear after the next Claude run, or Refresh usage.',
  codex: 'Usage windows appear after the next Codex run, or Refresh usage.',
  gemini: 'Gemini CLI does not report its quota, so only spend is shown.',
};

/**
 * Per provider: how it is paid for (detected), the usage windows its CLI
 * reports with time to reset, and this month's spend from the ledger.
 */
export function PlanUsage({ budgets, health, available, onBudgets, onError }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const now = new Date();

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.refreshUsage();
      onBudgets(r.budgets);
      setSkipped(r.skipped.filter((x) => x.reason !== 'not set up' && !x.reason.startsWith('Gemini CLI')).map((x) => `${PROVIDER_NAMES[x.provider]}: ${x.reason}`));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="card" id="s-plans" aria-labelledby="s-plans-h">
      <header className="card-title" id="s-plans-h">
        Plan & usage
        <span className="grow" />
        <button className="sm" disabled={refreshing} onClick={() => void refresh()} title="Sends one tiny request to Claude and to Codex (each capped, a fraction of a cent) to read the plan and fresh usage windows">
          {refreshing ? 'Refreshing…' : 'Refresh usage'}
        </button>
      </header>
      <p className="muted xs">Refresh usage sends one tiny request per set-up CLI that reports usage (Claude, Codex); each costs a fraction of a cent.</p>
      <div className="plan-cards">
        {PROVIDERS.map((p) => {
          const b = budgets?.[p];
          const setUp = isSetUp(available, p);
          const plan = b?.plan ?? health?.[p]?.plan;
          const windows = b?.usage?.windows ?? [];
          return (
            <div key={p} className={`plan-card g-${p}${setUp ? '' : ' off'}`}>
              <div className="row gap-sm">
                <Glyph provider={p} />
                <b>{PROVIDER_NAMES[p]}</b>
                <span className="grow" />
                {!setUp && <span className="muted xs">not set up</span>}
              </div>
              {setUp && (
                <>
                  <div className="plan-kind">
                    <span>{planKindLabel(plan)}</span>
                    {plan && <span className="muted xs">{plan.label}</span>}
                  </div>
                  {windows.map((w) => {
                    const used = Math.min(1, Math.max(0, w.usedPct));
                    const cls = used >= 1 ? ' usage-over' : used >= 0.8 ? ' usage-warn' : '';
                    return (
                      <div key={w.name} className={`usage${cls}`}>
                        <div className="bar" role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${PROVIDER_NAMES[p]} ${w.name} window used`}>
                          <i className="work" style={{ width: `${used * 100}%` }} />
                        </div>
                        <span className="label">{describeWindow(w, now)}</span>
                      </div>
                    );
                  })}
                  {windows.length === 0 && plan?.kind !== 'api-key' && <span className="muted xs">{NO_WINDOWS[p]}</span>}
                  {b && <span className="sm">{spendLine({ ...b, plan })}</span>}
                  {b?.reason && (
                    <span className={`xs ${b.exhausted ? 'danger-text' : 'warn-text'}`}>
                      {PROVIDER_NAMES[p]} {b.reason}
                      {b.exhausted ? '; auto routing goes around it' : ''}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {skipped.length > 0 && <p className="xs warn-text">Could not refresh: {skipped.join(' · ')}</p>}
    </section>
  );
}
