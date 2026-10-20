import type { Settings } from '../types';

/** The settings the panel edits. The server owns the rest (recent projects, per-project overrides). */
export type EditableSettings = Pick<
  Settings,
  'budgets' | 'warnPct' | 'resetDay' | 'seats' | 'tierMap' | 'autoStart' | 'autoEscalate' | 'stallMinutes' | 'seatTimeoutMs' | 'voteCostCeiling' | 'allowedCommands' | 'models'
>;

/**
 * Picks the fields the Settings panel edits so a Save never overwrites what the
 * server changed since the panel loaded, such as the recent-projects list.
 */
export function editableSettings(s: Settings): EditableSettings {
  return {
    budgets: s.budgets,
    warnPct: s.warnPct,
    resetDay: s.resetDay,
    seats: s.seats,
    tierMap: s.tierMap,
    autoStart: s.autoStart,
    autoEscalate: s.autoEscalate,
    stallMinutes: s.stallMinutes,
    seatTimeoutMs: s.seatTimeoutMs,
    voteCostCeiling: s.voteCostCeiling,
    allowedCommands: s.allowedCommands,
    models: s.models,
  };
}
