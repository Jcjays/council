import type { Provider } from '../adapters/types.js';
import type { Settings } from '../config/settings.js';
import type { Seat } from './council.js';

/** Providers from cheapest to dearest; used when something has to be picked without configuration. */
const CHEAP_FIRST: Provider[] = ['gemini', 'codex', 'claude'];
const NAMES: Record<Provider, string> = { gemini: 'Gemini', codex: 'Codex', claude: 'Claude' };

export interface EffectiveRouting {
  /** Providers whose CLI is installed and signed in, cheapest first. */
  available: Provider[];
  seats: Seat[];
  /** Plain-language explanation of any substitution, for the vote card and settings page. */
  notes: string[];
  /** Transitional property until Task 4 refactors engine */
  tierMap?: any;
}

function label(w: Seat): string {
  return `${NAMES[w.provider]} ${w.model ?? '(default model)'}`;
}

/**
 * What the council becomes once the CLIs that are missing or not signed in are filtered out.
 * If none of the configured seats are available, the cheapest available provider votes alone.
 */
export function effectiveRouting(settings: Pick<Settings, 'seats' | 'models'>, availableProviders: Provider[]): EffectiveRouting {
  const available = CHEAP_FIRST.filter((p) => availableProviders.includes(p));
  if (available.length === 0) {
    return {
      available,
      seats: [],
      notes: ['No CLI is installed and signed in. Install Claude Code, Codex CLI or Gemini CLI, sign in, and Council will route tasks to it.'],
      tierMap: {},
    };
  }

  const notes: string[] = [];
  const ladder = (p: Provider): string[] => settings.models[p] ?? [];
  const rung = (p: Provider, index: number): string | null => {
    const l = ladder(p);
    return l.length === 0 ? null : (l[Math.min(index, l.length - 1)] ?? null);
  };
  const cheapest = available[0] as Provider;

  let seats = settings.seats.filter((s) => available.includes(s.provider));
  if (seats.length === 0) {
    seats = [{ provider: cheapest, model: rung(cheapest, 0) }];
    notes.push(`None of the configured council seats is set up, so ${label(seats[0] as Seat)} votes alone.`);
  } else if (seats.length < settings.seats.length) {
    const missing = settings.seats.filter((s) => !available.includes(s.provider));
    const absent = [...new Set(missing.map((s) => NAMES[s.provider]))];
    notes.push(`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} not set up; remaining seats form council.`);
  }

  if (available.length === 1) {
    const only = available[0] as Provider;
    notes.push(`Only ${NAMES[only]} is set up. Active council: ${seats.map(label).join(', ')}.`);
  }

  const tierMap = {
    easy: seats[0] ?? { provider: cheapest, model: null },
    medium: seats[1] ?? seats[0] ?? { provider: cheapest, model: null },
    hard: seats[seats.length - 1] ?? { provider: cheapest, model: null },
  };

  return { available, seats, notes, tierMap };
}
