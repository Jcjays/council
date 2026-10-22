import { useEffect, useRef, useState } from 'react';
import { PROVIDER_NAMES } from '../lib/format';
import { modelLabel, priceBadge, priceTitle, sameWorker, type Pick } from '../lib/models';
import { firstSetUp, isSetUp, notSetUpTitle, type Availability } from '../lib/routing';
import { PROVIDERS, type ModelCatalog, type ModelChoice, type Provider } from '../types';
import { Glyph } from './Glyph';

interface Props {
  /** The chosen worker; null shows the placeholder (nothing chosen yet). */
  value: Pick | null;
  onChange: (pick: Pick) => void;
  catalog: ModelCatalog | null;
  available: Availability;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** Offer each provider's "CLI default" choice. */
  allowDefault?: boolean;
  /** Open the menu above the button (for pickers near the bottom of the page). */
  up?: boolean;
}

function chipTitle(m: ModelChoice): string {
  return [m.note, m.resolves ? `= ${m.resolves}` : '', m.price ? priceTitle(m.price) : 'No price known'].filter(Boolean).join(' · ');
}

/**
 * One picker for every place a worker is chosen: a button naming the provider
 * and model, opening a menu of each provider's models (cheapest first) with
 * their prices. Providers without a working CLI are shown but cannot be picked.
 */
export function ModelPicker({ value, onChange, catalog, available, ariaLabel, placeholder = 'Choose a model', disabled, allowDefault = true, up }: Props) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const otherProvider: Provider = value?.provider ?? firstSetUp(available, 'claude');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector<HTMLButtonElement>('.model-chip.on, .model-chip:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (pick: Pick) => {
    onChange(pick);
    setOpen(false);
  };

  const chosen = value ? catalog?.[value.provider]?.find((m) => m.id === value.model) : undefined;

  return (
    <div className="picker" ref={root}>
      <button type="button" className="picker-trigger" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        {value ? (
          <>
            <Glyph provider={value.provider} />
            <span>{PROVIDER_NAMES[value.provider]}</span>
            <span className="muted">·</span>
            <span className="picker-model">{modelLabel(catalog, value.provider, value.model)}</span>
            {chosen?.price && (
              <span className="price" title={priceTitle(chosen.price)}>
                {priceBadge(chosen.price)}
              </span>
            )}
          </>
        ) : (
          <span className="muted">{placeholder}</span>
        )}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className={`picker-pop${up ? ' up' : ''}`} role="listbox" aria-label={ariaLabel}>
          {PROVIDERS.map((p) => {
            const ok = isSetUp(available, p);
            const models = catalog?.[p] ?? [];
            return (
              <div key={p} className={`picker-group${ok ? '' : ' off'}`} title={ok ? undefined : notSetUpTitle(p)}>
                <div className="picker-group-h">
                  <Glyph provider={p} />
                  <span>{PROVIDER_NAMES[p]}</span>
                  {!ok && <span className="xs">not set up</span>}
                  <span className="grow" />
                  {ok && models.length > 0 && <span className="xs">cheapest first · $ in / out per M tokens</span>}
                </div>
                <div className="model-chips">
                  {models.map((m) => {
                    const on = value !== null && sameWorker(value, { provider: p, model: m.id });
                    return (
                      <button key={m.id} type="button" role="option" aria-selected={on} className={`model-chip${on ? ' on' : ''}`} disabled={!ok} title={chipTitle(m)} onClick={() => choose({ provider: p, model: m.id })}>
                        <span>{m.label}</span>
                        {m.price && <span className="price">{priceBadge(m.price)}</span>}
                      </button>
                    );
                  })}
                  {allowDefault && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={value !== null && sameWorker(value, { provider: p, model: null })}
                      className={`model-chip quiet${value !== null && sameWorker(value, { provider: p, model: null }) ? ' on' : ''}`}
                      disabled={!ok}
                      title={`Whatever model the ${PROVIDER_NAMES[p]} CLI is configured to use`}
                      onClick={() => choose({ provider: p, model: null })}
                    >
                      CLI default
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <form
            className="picker-other"
            onSubmit={(e) => {
              e.preventDefault();
              if (other.trim()) choose({ provider: otherProvider, model: other.trim() });
              setOther('');
            }}
          >
            <span className="xs muted">Another {PROVIDER_NAMES[otherProvider]} model:</span>
            <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="exact model name" aria-label={`Another ${PROVIDER_NAMES[otherProvider]} model`} />
            <button type="submit" className="sm" disabled={!other.trim() || !isSetUp(available, otherProvider)}>
              Use
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
