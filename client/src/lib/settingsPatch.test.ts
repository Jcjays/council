import { expect, test } from 'vitest';
import type { Settings } from '../types';
import { editableSettings } from './settingsPatch';

const settings: Settings = {
  budgets: { claude: 40, codex: 30, gemini: 30 },
  warnPct: 0.8,
  resetDay: 1,
  seats: [{ provider: 'gemini', model: 'flash' }],
  tierMap: {
    easy: { provider: 'gemini', model: 'flash' },
    medium: { provider: 'codex', model: null },
    hard: { provider: 'claude', model: 'claude-sonnet-5-5' },
  },
  autoStart: false,
  autoEscalate: true,
  stallMinutes: 10,
  seatTimeoutMs: 60_000,
  voteCostCeiling: 0.05,
  allowedCommands: ['Bash(npm test*)'],
  models: { claude: ['claude-sonnet-5-5'], codex: ['gpt-5.5'], gemini: ['flash'] },
  recentProjects: ['C:/opened-after-the-panel-loaded'],
  projectOverrides: { abc: { autoStart: true } },
};

test('editableSettings keeps the fields the panel edits and drops the ones the server owns', () => {
  const patch = editableSettings(settings);
  expect(patch).not.toHaveProperty('recentProjects');
  expect(patch).not.toHaveProperty('projectOverrides');
  expect(Object.keys(patch).sort()).toEqual(
    ['allowedCommands', 'autoEscalate', 'autoStart', 'budgets', 'models', 'resetDay', 'seatTimeoutMs', 'seats', 'stallMinutes', 'tierMap', 'voteCostCeiling', 'warnPct'].sort(),
  );
  expect(patch.budgets).toEqual(settings.budgets);
  expect(patch.seats).toEqual(settings.seats);
});
