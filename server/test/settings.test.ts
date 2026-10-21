import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, effectiveSettings, loadSettings, mergeSettings, saveSettings } from '../src/config/settings.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'council-settings-')), 'settings.json');
}

test('a missing settings file loads as the defaults', async () => {
  expect(await loadSettings(tmpFile())).toEqual(DEFAULT_SETTINGS);
});

test('the defaults match the spec', () => {
  expect(DEFAULT_SETTINGS.budgets).toEqual({ claude: 40, codex: 30, gemini: 30 });
  expect(DEFAULT_SETTINGS.warnPct).toBe(0.8);
  expect(DEFAULT_SETTINGS.resetDay).toBe(1);
  expect(DEFAULT_SETTINGS.seats.map((s) => s.provider)).toEqual(['gemini', 'codex', 'claude']);
  expect(DEFAULT_SETTINGS.tierMap).toEqual({
    easy: { provider: 'gemini', model: 'flash' },
    medium: { provider: 'codex', model: null },
    hard: { provider: 'claude', model: 'claude-sonnet-5-5' },
  });
  expect(DEFAULT_SETTINGS.autoStart).toBe(false);
  expect(DEFAULT_SETTINGS.autoEscalate).toBe(true);
  expect(DEFAULT_SETTINGS.stallMinutes).toBe(10);
  expect(DEFAULT_SETTINGS.seatTimeoutMs).toBe(60_000);
  expect(DEFAULT_SETTINGS.voteCostCeiling).toBe(0.05);
  expect(DEFAULT_SETTINGS.allowedCommands.length).toBeGreaterThan(5);
});

test('a partial file is merged over the defaults', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ budgets: { claude: 10 }, autoStart: true, seats: [{ provider: 'gemini', model: 'flash' }] }));
  const s = await loadSettings(file);
  expect(s.budgets).toEqual({ claude: 10, codex: 30, gemini: 30 });
  expect(s.autoStart).toBe(true);
  expect(s.seats).toEqual([{ provider: 'gemini', model: 'flash' }]);
  expect(s.tierMap).toEqual(DEFAULT_SETTINGS.tierMap);
  expect(s.allowedCommands).toEqual(DEFAULT_SETTINGS.allowedCommands);
});

test('save then load round-trips', async () => {
  const file = tmpFile();
  const changed = { ...DEFAULT_SETTINGS, resetDay: 15, recentProjects: ['C:/p'] };
  await saveSettings(file, changed);
  expect(await loadSettings(file)).toEqual(changed);
});

test('a corrupt file falls back to the defaults instead of crashing', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  expect(await loadSettings(file)).toEqual(DEFAULT_SETTINGS);
});

test('effectiveSettings applies a project override and leaves everything else', () => {
  const s = { ...DEFAULT_SETTINGS, projectOverrides: { p1: { autoStart: true, allowedCommands: ['Bash(x)'] } } };
  const e = effectiveSettings(s, 'p1');
  expect(e.autoStart).toBe(true);
  expect(e.allowedCommands).toEqual(['Bash(x)']);
  expect(e.budgets).toEqual(s.budgets);
  expect(effectiveSettings(s, 'other')).toEqual(s);
});

test('values of the wrong type are dropped instead of stored', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    stallMinutes: 'soon',
    seatTimeoutMs: null,
    autoStart: 'yes',
    seats: 3,
    allowedCommands: ['Bash(ls*)', 7],
    budgets: { claude: 'lots', codex: 12 },
    tierMap: { easy: { provider: 'nope', model: 'x' } },
  });
  expect(s.stallMinutes).toBe(DEFAULT_SETTINGS.stallMinutes);
  expect(s.seatTimeoutMs).toBe(DEFAULT_SETTINGS.seatTimeoutMs);
  expect(s.autoStart).toBe(DEFAULT_SETTINGS.autoStart);
  expect(s.seats).toEqual(DEFAULT_SETTINGS.seats);
  expect(s.allowedCommands).toEqual(DEFAULT_SETTINGS.allowedCommands);
  expect(s.budgets).toEqual({ claude: 40, codex: 12, gemini: 30 });
  expect(s.tierMap.easy).toEqual(DEFAULT_SETTINGS.tierMap.easy);
});

test('numbers out of range are clamped, and seats are capped at five', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    warnPct: 4,
    resetDay: 99,
    seats: Array.from({ length: 8 }, () => ({ provider: 'gemini' })),
  });
  expect(s.warnPct).toBe(1);
  expect(s.resetDay).toBe(31);
  expect(s.seats).toHaveLength(5);
  expect(s.seats[0]).toEqual({ provider: 'gemini', model: null });
});
