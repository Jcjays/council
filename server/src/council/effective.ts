import type { Provider } from '../adapters/types.js';
import type { ModelChoice } from '../config/models.js';
import type { Settings } from '../config/settings.js';
import type { Seat } from './council.js';
import { buildLadder, CHEAP_FIRST, type Rung } from './ladder.js';

const NAMES: Record<Provider, string> = { gemini: 'Gemini', codex: 'Codex', claude: 'Claude' };

export interface EffectiveRouting {
  /** Providers whose CLI is installed and signed in, cheapest first. */
  available: Provider[];
  /** The seats that can actually vote. */
  seats: Seat[];
  /** Every model the council may pick from, cheapest first. */
  ladder: Rung[];
  /** Plain-language explanation of what is missing or substituted. */
  notes: string[];
}

function seatLabel(seat: Seat, ladder: Rung[]): string {
  const rung = ladder.find((r) => r.provider === seat.provider && r.model === seat.model);
  return `${NAMES[seat.provider]} ${rung?.label ?? seat.model ?? '(default model)'}`;
}

/**
 * What the council becomes once the CLIs that are missing or not signed in are
 * taken out: the configured seats that can vote, and the ladder of models they
 * choose the worker from. There is no fixed tier-to-model table; the seats judge
 * each task and name the cheapest model they trust with it.
 */
export function effectiveRouting(
  settings: Pick<Settings, 'seats' | 'models'>,
  availableProviders: Provider[],
  catalog: Record<Provider, ModelChoice[]>,
): EffectiveRouting {
  const available = CHEAP_FIRST.filter((p) => availableProviders.includes(p));
  const ladder = buildLadder(catalog, available);
  if (available.length === 0) {
    return {
      available,
      seats: [],
      ladder,
      notes: ['No CLI is installed and signed in. Install Claude Code, Codex CLI or Gemini CLI, sign in, and Council will route tasks to it.'],
    };
  }

  const notes: string[] = [];
  let seats = settings.seats.filter((s) => available.includes(s.provider));
  if (seats.length === 0) {
    const first = ladder[0];
    seats = first ? [{ provider: first.provider, model: first.model }] : [];
    if (first) notes.push(`None of the configured council seats is set up, so ${seatLabel(seats[0] as Seat, ladder)} votes alone.`);
  }

  if (available.length === 1) {
    const only = available[0] as Provider;
    notes.push(
      `Only ${NAMES[only]} is set up. ${seats.map((s) => seatLabel(s, ladder)).join(', ')} ${seats.length === 1 ? 'votes' : 'vote'} and the pick climbs ${ladder.map((r) => r.label).join(' → ')}.`,
    );
  } else {
    const absent = CHEAP_FIRST.filter((p) => !available.includes(p)).map((p) => NAMES[p]);
    if (absent.length > 0) notes.push(`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} not set up; the council picks from the models that are.`);
  }

  return { available, seats, ladder, notes };
}
