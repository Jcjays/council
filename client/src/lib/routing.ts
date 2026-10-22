import { PROVIDERS, type Provider } from '../types';
import { PROVIDER_NAMES } from './format';

/**
 * Which providers have a CLI installed and signed in, as `GET /api/routing`
 * reports. `null` or `undefined` means not known yet, and every provider is
 * treated as set up until the answer arrives.
 */
export type Availability = Provider[] | null | undefined;

export function isSetUp(available: Availability, p: Provider): boolean {
  return !available || available.includes(p);
}

/** True once the server has answered and no provider is usable. */
export function noneSetUp(available: Availability): boolean {
  return Array.isArray(available) && available.length === 0;
}

export function setUpCount(available: Availability): number {
  return available ? available.length : PROVIDERS.length;
}

/** The label of the Auto choice: a council needs at least two providers to vote. */
export function autoLabel(available: Availability): string {
  const n = setUpCount(available);
  if (n > 1) return 'Auto (council votes)';
  if (n === 1) return 'Auto (picks the model)';
  return 'Auto';
}

export function notSetUpTitle(p: Provider): string {
  return `${PROVIDER_NAMES[p]} is not set up: install its CLI and sign in (Settings › CLI health)`;
}

/** `preferred` when it is set up, else the first provider that is, else `preferred`. */
export function firstSetUp(available: Availability, preferred: Provider): Provider {
  if (isSetUp(available, preferred)) return preferred;
  return PROVIDERS.find((p) => isSetUp(available, p)) ?? preferred;
}
