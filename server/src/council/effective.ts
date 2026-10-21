import { TIER_ORDER, type Provider, type Tier } from '../adapters/types.js';
import type { Settings } from '../config/settings.js';
import type { Seat } from './council.js';
import type { TierMap, Worker } from './routing.js';

/** Providers from cheapest to dearest; used when something has to be picked without configuration. */
const CHEAP_FIRST: Provider[] = ['gemini', 'codex', 'claude'];
const NAMES: Record<Provider, string> = { gemini: 'Gemini', codex: 'Codex', claude: 'Claude' };

export interface EffectiveRouting {
  /** Providers whose CLI is installed and signed in, cheapest first. */
  available: Provider[];
  seats: Seat[];
  tierMap: TierMap;
  /** Plain-language explanation of any substitution, for the vote card and settings page. */
  notes: string[];
}

function clone(map: TierMap): TierMap {
  return { easy: { ...map.easy }, medium: { ...map.medium }, hard: { ...map.hard } };
}

function label(w: Worker): string {
  return `${NAMES[w.provider]} ${w.model ?? '(default model)'}`;
}

/**
 * What the council and the tier map become once the CLIs that are missing or not
 * signed in are taken out. One provider: its cheapest model votes and the tiers
 * climb its own model ladder (Settings → models, cheapest first). Two providers:
 * a missing tier is filled from the nearest configured provider, and a tier that
 * would reuse the rung below it moves one rung up.
 */
export function effectiveRouting(settings: Pick<Settings, 'seats' | 'tierMap' | 'models'>, availableProviders: Provider[]): EffectiveRouting {
  const available = CHEAP_FIRST.filter((p) => availableProviders.includes(p));
  const tierMap = clone(settings.tierMap);
  if (available.length === 0) {
    return {
      available,
      seats: [],
      tierMap,
      notes: ['No CLI is installed and signed in. Install Claude Code, Codex CLI or Gemini CLI, sign in, and Council will route tasks to it.'],
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
    notes.push(`None of the configured council seats is set up, so ${label(seats[0] as Worker)} votes alone.`);
  }

  const missing = TIER_ORDER.filter((t) => !available.includes(tierMap[t].provider));
  for (const tier of missing) {
    const index = TIER_ORDER.indexOf(tier);
    const nearest = [...TIER_ORDER.slice(index + 1), ...TIER_ORDER.slice(0, index).reverse()].find((t) =>
      available.includes(settings.tierMap[t].provider),
    );
    const provider = nearest ? settings.tierMap[nearest].provider : cheapest;
    tierMap[tier] = { provider, model: rung(provider, index) };
  }

  // A tier must not reuse the rung of the tier below it on the same provider.
  for (let i = 1; i < TIER_ORDER.length; i++) {
    const below = tierMap[TIER_ORDER[i - 1] as Tier];
    const current = tierMap[TIER_ORDER[i] as Tier];
    if (below.provider !== current.provider) continue;
    const l = ladder(current.provider);
    const belowIndex = below.model ? l.indexOf(below.model) : -1;
    const currentIndex = current.model ? l.indexOf(current.model) : -1;
    if (belowIndex >= 0 && currentIndex >= 0 && currentIndex <= belowIndex) {
      current.model = l[Math.min(belowIndex + 1, l.length - 1)] ?? current.model;
    }
  }

  if (available.length === 1) {
    const only = available[0] as Provider;
    notes.push(
      `Only ${NAMES[only]} is set up. Council: ${seats.map(label).join(', ')}. Easy → ${tierMap.easy.model ?? 'default'}, medium → ${tierMap.medium.model ?? 'default'}, hard → ${tierMap.hard.model ?? 'default'}.`,
    );
  } else if (missing.length > 0) {
    const absent = CHEAP_FIRST.filter((p) => !available.includes(p)).map((p) => NAMES[p]);
    notes.push(`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} not set up: ${missing.map((t) => `${t} → ${label(tierMap[t])}`).join(', ')}.`);
  }

  return { available, seats, tierMap, notes };
}
