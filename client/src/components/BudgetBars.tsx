import { budgetTone, daysLeft, describeWindow, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { isSetUp, type Availability } from '../lib/routing';
import { PROVIDERS, type BudgetState, type Provider } from '../types';
import { Glyph } from './Glyph';

interface Props {
  budgets: Record<Provider, BudgetState> | null;
  resetDay: number;
  /** Providers whose CLI is installed and signed in; the others are greyed out as not set up. */
  available: Availability;
  now?: Date;
}

/**
 * One meter per provider. When the CLI reports its plan usage (Claude always,
 * Codex when it attaches rate limits) those windows are the primary meter and
 * the dollar ledger sits beneath; otherwise the dollar bar is the meter.
 * The lighter segment of the dollar bar is what council votes and hand-off summaries cost.
 */
export function BudgetBars({ budgets, resetDay, available, now = new Date() }: Props) {
  const left = daysLeft(now, resetDay);
  let anyUsage = false;
  return (
    <section className="budgets" aria-label="Budgets and plan usage">
      {PROVIDERS.map((p) => {
        const b = budgets?.[p];
        const setUp = isSetUp(available, p);
        const tone = b ? budgetTone(b.pct) : 'ok';
        const total = b ? Math.min(1, b.pct) : 0;
        const voteShare = b && b.limit > 0 ? Math.min(total, b.routingSpent / b.limit) : 0;
        const workShare = Math.max(0, total - voteShare);
        const windows = setUp ? (b?.usage?.windows ?? []) : [];
        if (windows.length > 0) anyUsage = true;
        const dollars = !b ? '…' : b.limit > 0 ? `${formatUsd(b.spent)} / ${formatUsd(b.limit)}` : `${formatUsd(b.spent)} · untracked`;
        const title = !setUp
          ? `${PROVIDER_NAMES[p]} is not set up: install its CLI and sign in`
          : b
            ? `${formatUsd(b.spent)} spent this period, of which ${formatUsd(b.routingSpent)} on council votes and hand-off summaries${b.limit > 0 ? `; limit ${formatUsd(b.limit)}` : '; not tracked'}${
                b.usage ? `. Plan usage reported by the ${PROVIDER_NAMES[p]} CLI at ${new Date(b.usage.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
              }`
            : 'loading';
        return (
          <div key={p} className={`budget budget-${tone} g-${p}${setUp ? '' : ' off'}`} title={title}>
            <div className="row">
              <Glyph provider={p} />
              <span>{PROVIDER_NAMES[p]}</span>
              <span className="grow" />
              {!setUp ? <span className="muted xs">not set up</span> : windows.length === 0 && <span className="amount">{dollars}</span>}
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
            <div className={`bar${windows.length > 0 ? ' thin' : ''}`} role="progressbar" aria-valuenow={Math.round(total * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${PROVIDER_NAMES[p]} monthly budget used`}>
              <i className="work" style={{ width: `${workShare * 100}%` }} />
              <i className="vote" style={{ width: `${voteShare * 100}%` }} />
            </div>
            {windows.length > 0 && (
              <div className="dollar-line">
                <span>this month</span>
                <span className="amount">{dollars}</span>
              </div>
            )}
            {b?.exhausted && setUp && <div className="budget-note">Budget spent: auto routing avoids {PROVIDER_NAMES[p]}</div>}
          </div>
        );
      })}
      <div className="legend" title={`The lighter end of a dollar bar is what council votes and hand-off summaries cost.${anyUsage ? '' : ' Plan usage windows appear by themselves once a CLI reports them during a run.'}`}>
        {left} day{left === 1 ? '' : 's'} to reset · lighter = council votes
      </div>
    </section>
  );
}
