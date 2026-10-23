import type { Provider } from '../adapters/types.js';
import type { BudgetState } from '../ledger/budget.js';
import { lookupPrice, type PriceTable } from '../ledger/pricing.js';
import type { Seat, SeatResult } from './council.js';

const PROVIDER_ORDER: Record<Provider, number> = { gemini: 1, codex: 2, claude: 3 };

export function seatCost(seat: Seat, pricing: PriceTable): number {
  const price = lookupPrice(seat.provider, seat.model, pricing);
  if (price) {
    return price.inputPerM + price.outputPerM;
  }
  return (PROVIDER_ORDER[seat.provider] ?? 2) * 10;
}

export function rankSeats(seats: Seat[], pricing: PriceTable): Seat[] {
  return [...seats].sort((a, b) => {
    const costA = seatCost(a, pricing);
    const costB = seatCost(b, pricing);
    if (costA !== costB) return costA - costB;
    const pA = PROVIDER_ORDER[a.provider] ?? 2;
    const pB = PROVIDER_ORDER[b.provider] ?? 2;
    if (pA !== pB) return pA - pB;
    return (a.model ?? '').localeCompare(b.model ?? '');
  });
}

export interface RoutingDecision {
  selectedSeat: Seat;
  confidence: number;
  complexity: number;
  reason: string;
  isFallback: boolean;
  shiftedFrom?: Seat;
  exhaustedNotice?: string;
}

export function selectSeat(
  seats: SeatResult[],
  pricing: PriceTable,
  budgets: Partial<Record<Provider, BudgetState>> = {},
  unavailable: Provider[] = [],
): RoutingDecision {
  const isBlocked = (p: Provider) => budgets[p]?.exhausted === true || unavailable.includes(p);
  const why = (p: Provider) => (unavailable.includes(p) ? `${p} CLI is not available` : `${p} budget is exhausted`);

  const validVotes = seats.flatMap((s) => (s.vote ? [s.vote] : []));
  const avgComplexity =
    validVotes.length > 0
      ? Math.round(validVotes.reduce((sum, v) => sum + v.complexity, 0) / validVotes.length)
      : 3;
  const complexity = Math.min(5, Math.max(1, avgComplexity));

  const ranked = rankSeats(
    seats.map((s) => s.seat),
    pricing,
  );
  const seatResultMap = new Map<string, SeatResult>();
  for (const s of seats) {
    seatResultMap.set(`${s.seat.provider}:${s.seat.model ?? ''}`, s);
  }
  const getResult = (st: Seat) => seatResultMap.get(`${st.provider}:${st.model ?? ''}`);

  const availableRanked = ranked.filter((st) => !isBlocked(st.provider));

  const confident = availableRanked.filter((st) => {
    const res = getResult(st);
    return res?.vote && res.vote.confidence >= 0.8;
  });

  if (confident.length > 0) {
    const winner = confident[0] as Seat;
    const res = getResult(winner);
    return {
      selectedSeat: winner,
      confidence: res?.vote?.confidence ?? 0.8,
      complexity,
      reason: res?.vote?.reason ?? 'Selected lowest-cost confident model',
      isFallback: false,
    };
  }

  if (availableRanked.length > 0) {
    const strongest = availableRanked[availableRanked.length - 1] as Seat;
    const res = getResult(strongest);
    return {
      selectedSeat: strongest,
      confidence: res?.vote?.confidence ?? 0.5,
      complexity,
      reason: res?.vote?.reason || 'No seat reached 80% confidence; routed to strongest available model',
      isFallback: true,
    };
  }

  const defaultSeat = (ranked[0] ?? seats[0]?.seat) as Seat;
  const res = getResult(defaultSeat);
  return {
    selectedSeat: defaultSeat,
    confidence: res?.vote?.confidence ?? 0.5,
    complexity,
    reason: 'All providers are exhausted or unavailable; keeping default seat',
    isFallback: true,
    exhaustedNotice: `Every provider is exhausted or unavailable (${why(defaultSeat.provider)})`,
  };
}

export function nextStrongerSeat(current: Seat, seats: Seat[], pricing: PriceTable): Seat | null {
  const ranked = rankSeats(seats, pricing);
  const curKey = `${current.provider}:${current.model ?? ''}`;
  const idx = ranked.findIndex((s) => `${s.provider}:${s.model ?? ''}` === curKey);
  if (idx < 0) {
    return ranked[0] ?? null;
  }
  if (idx + 1 < ranked.length) {
    return ranked[idx + 1] as Seat;
  }
  return null;
}
