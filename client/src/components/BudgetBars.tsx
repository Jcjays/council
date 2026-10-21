import { budgetTone, daysLeft, describeWindow, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type BudgetState, type Provider } from '../types';

interface Props {
  budgets: Record<Provider, BudgetState> | null;
  resetDay: number;
  /** Providers whose CLI is installed and signed in; others are shown as not set up. */
  available?: Provider[] | null;
}

export function BudgetBars({ budgets, resetDay, available }: Props) {
  const left = daysLeft(new Date(), resetDay);
  return (
    <section className="budgets" aria-label="Monthly budgets">
      <header className="section-title">
        <span>Budgets</span>
        <span className="muted">{left} day{left === 1 ? '' : 's'} left</span>
      </header>
      {PROVIDERS.map((p) => {
        const b = budgets?.[p];
        const setUp = !available || available.includes(p);
        const pct = b ? Math.min(1, b.pct) : 0;
        const tone = b ? budgetTone(b.pct) : 'ok';
        const title = b ? `${formatUsd(b.spent)} spent, of which ${formatUsd(b.routingSpent)} on council votes and hand-off summaries` : 'loading';
        return (
          <div key={p} className={`budget budget-${tone} ${setUp ? '' : 'budget-off'}`} title={title}>
            <div className="budget-row">
              <span>{PROVIDER_NAMES[p]}</span>
              <span className="muted">
                {!setUp ? 'not set up' : b ? (b.limit > 0 ? `${formatUsd(b.spent)} / ${formatUsd(b.limit)}` : `${formatUsd(b.spent)} (untracked)`) : '…'}
              </span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct * 100}%` }} />
            </div>
            {b?.usage?.windows.map((w) => (
              <div key={w.name} className="usage-window" title={`Reported by the ${PROVIDER_NAMES[p]} CLI at ${new Date(b.usage?.observedAt ?? '').toLocaleTimeString()}`}>
                <div className="bar bar-thin">
                  <div className={`bar-fill ${w.usedPct >= 1 ? 'bar-over' : w.usedPct >= 0.8 ? 'bar-warn' : ''}`} style={{ width: `${Math.min(1, w.usedPct) * 100}%` }} />
                </div>
                <span className="small muted">{describeWindow(w)}</span>
              </div>
            ))}
            {b?.exhausted && setUp && <div className="budget-note">Exhausted: auto routing avoids {PROVIDER_NAMES[p]}</div>}
          </div>
        );
      })}
      <p className="small muted">Plan usage windows appear automatically once a CLI reports them during a run.</p>
    </section>
  );
}
