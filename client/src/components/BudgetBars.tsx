import { budgetTone, daysLeft, describeWindow, formatTokens, PROVIDER_NAMES } from '../lib/format';
import { isSetUp, type Availability } from '../lib/routing';
import { PROVIDERS, type BudgetState, type Provider } from '../types';
import { Glyph } from './Glyph';

interface Props {
  budgets: Record<Provider, BudgetState> | null;
  resetDay?: number;
  available: Availability;
  now?: Date;
}

/**
 * Limit and quota status per provider. Renders auto-detected rate limits
 * and live window quotas without artificial dollar budgets.
 */
export function BudgetBars({ budgets, resetDay, available, now = new Date() }: Props) {
  const left = resetDay !== undefined ? daysLeft(now, resetDay) : null;

  return (
    <section className="budgets" aria-label="Model and provider limits">
      <div
        className="section-label"
        style={{ padding: '4px 8px 0', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        Limits &amp; Usage
      </div>
      {PROVIDERS.map((p) => {
        const b = budgets?.[p];
        const setUp = isSetUp(available, p);
        const tone = b ? budgetTone(b.pct) : 'ok';
        const windows = setUp ? (b?.usage?.windows ?? []) : [];
        const tokenText = b?.tokens?.total ? `${formatTokens(b.tokens.total)} tokens` : null;
        const title = !setUp
          ? `${PROVIDER_NAMES[p]} is not set up: install its CLI and sign in`
          : `${PROVIDER_NAMES[p]}: live limits monitored${tokenText ? ` · ${tokenText} this period` : ''}${
              b?.usage
                ? `. Rate limits reported at ${new Date(b.usage.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''
            }`;

        return (
          <div key={p} className={`budget budget-${tone} g-${p}${setUp ? '' : ' off'}`} title={title}>
            <div className="row">
              <Glyph provider={p} />
              <span>{PROVIDER_NAMES[p]}</span>
              <span className="grow" />
              {!setUp ? (
                <span className="muted xs">not set up</span>
              ) : b?.exhausted ? (
                <span className="chip" style={{ '--c': 'var(--danger)', fontSize: '10px' } as React.CSSProperties}>
                  exhausted
                </span>
              ) : b?.warning ? (
                <span className="chip" style={{ '--c': 'var(--warn)', fontSize: '10px' } as React.CSSProperties}>
                  near limit
                </span>
              ) : tokenText ? (
                <span className="muted xs">{tokenText}</span>
              ) : (
                <span className="chip" style={{ '--c': 'var(--ok)', fontSize: '10px' } as React.CSSProperties}>
                  active
                </span>
              )}
            </div>

            {windows.map((w) => {
              const used = Math.min(1, Math.max(0, w.usedPct));
              const cls = used >= 1 ? ' usage-over' : used >= 0.8 ? ' usage-warn' : '';
              return (
                <div key={w.name} className={`usage${cls}`}>
                  <div
                    className="bar"
                    role="progressbar"
                    aria-valuenow={Math.round(used * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${PROVIDER_NAMES[p]} ${w.name} window used`}
                  >
                    <i className="work" style={{ width: `${used * 100}%` }} />
                  </div>
                  <span className="label">{describeWindow(w, now)}</span>
                </div>
              );
            })}

            {b?.exhausted && setUp && (
              <div className="budget-note">Budget spent: auto routing avoids {PROVIDER_NAMES[p]}</div>
            )}
          </div>
        );
      })}
      {left !== null && (
        <div className="legend">
          {left} day{left === 1 ? '' : 's'} to billing cycle reset
        </div>
      )}
    </section>
  );
}
