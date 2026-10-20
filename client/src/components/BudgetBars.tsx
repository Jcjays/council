import { budgetTone, daysLeft, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type BudgetState, type Provider } from '../types';
import { Glyph } from './Glyph';

/** Monthly spend per provider. The lighter segment is what council votes and hand-off summaries cost. */
export function BudgetBars({ budgets, resetDay }: { budgets: Record<Provider, BudgetState> | null; resetDay: number }) {
  const left = daysLeft(new Date(), resetDay);
  return (
    <section className="budgets" aria-label="Monthly budgets">
      {PROVIDERS.map((p) => {
        const b = budgets?.[p];
        const tone = b ? budgetTone(b.pct) : 'ok';
        const total = b ? Math.min(1, b.pct) : 0;
        const voteShare = b && b.limit > 0 ? Math.min(total, b.routingSpent / b.limit) : 0;
        const workShare = Math.max(0, total - voteShare);
        const title = b
          ? `${formatUsd(b.spent)} spent this period, of which ${formatUsd(b.routingSpent)} on council votes and hand-off summaries${b.limit > 0 ? `; limit ${formatUsd(b.limit)}` : '; not tracked'}`
          : 'loading';
        return (
          <div key={p} className={`budget budget-${tone} g-${p}`} title={title}>
            <div className="row">
              <Glyph provider={p} />
              <span>{PROVIDER_NAMES[p]}</span>
              <span className="grow" />
              <span className="amount">{b ? (b.limit > 0 ? `${formatUsd(b.spent)} / ${formatUsd(b.limit)}` : `${formatUsd(b.spent)} · untracked`) : '…'}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(total * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${PROVIDER_NAMES[p]} budget used`}>
              <i className="work" style={{ width: `${workShare * 100}%` }} />
              <i className="vote" style={{ width: `${voteShare * 100}%` }} />
            </div>
            {b?.exhausted && <div className="budget-note">Exhausted: auto routing avoids {PROVIDER_NAMES[p]}</div>}
          </div>
        );
      })}
      <div className="legend">
        {left} day{left === 1 ? '' : 's'} until reset · lighter segment is council votes
      </div>
    </section>
  );
}
