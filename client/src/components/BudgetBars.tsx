import { budgetTone, daysLeft, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type BudgetState, type Provider } from '../types';

export function BudgetBars({ budgets, resetDay }: { budgets: Record<Provider, BudgetState> | null; resetDay: number }) {
  const left = daysLeft(new Date(), resetDay);
  return (
    <section className="budgets" aria-label="Monthly budgets">
      <header className="section-title">
        <span>Budgets</span>
        <span className="muted">{left} day{left === 1 ? '' : 's'} left</span>
      </header>
      {PROVIDERS.map((p) => {
        const b = budgets?.[p];
        const pct = b ? Math.min(1, b.pct) : 0;
        const tone = b ? budgetTone(b.pct) : 'ok';
        const title = b ? `${formatUsd(b.spent)} spent, of which ${formatUsd(b.routingSpent)} on council votes and hand-off summaries` : 'loading';
        return (
          <div key={p} className={`budget budget-${tone}`} title={title}>
            <div className="budget-row">
              <span>{PROVIDER_NAMES[p]}</span>
              <span className="muted">
                {b ? (b.limit > 0 ? `${formatUsd(b.spent)} / ${formatUsd(b.limit)}` : `${formatUsd(b.spent)} (untracked)`) : '…'}
              </span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct * 100}%` }} />
            </div>
            {b?.exhausted && <div className="budget-note">Exhausted: auto routing avoids {PROVIDER_NAMES[p]}</div>}
          </div>
        );
      })}
    </section>
  );
}
