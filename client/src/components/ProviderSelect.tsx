import { PROVIDER_NAMES } from '../lib/format';
import { isSetUp, type Availability } from '../lib/routing';
import { PROVIDERS, type Provider } from '../types';

interface Props {
  value: Provider;
  onChange: (p: Provider) => void;
  available: Availability;
  ariaLabel: string;
  disabled?: boolean;
}

/** A provider dropdown where providers without a working CLI are shown but cannot be chosen. */
export function ProviderSelect({ value, onChange, available, ariaLabel, disabled }: Props) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Provider)} aria-label={ariaLabel} disabled={disabled}>
      {PROVIDERS.map((p) => {
        const ok = isSetUp(available, p);
        return (
          <option key={p} value={p} disabled={!ok && p !== value}>
            {PROVIDER_NAMES[p]}
            {ok ? '' : ' (not set up)'}
          </option>
        );
      })}
    </select>
  );
}
