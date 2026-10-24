import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, effectiveSettings, loadSettings, saveSettings } from '../src/config/settings.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'council-settings-')), 'settings.json');
}

test('a missing settings file loads as the defaults', async () => {
  expect(await loadSettings(tmpFile())).toEqual(DEFAULT_SETTINGS);
});

test('the defaults match the spec', () => {
  expect(DEFAULT_SETTINGS.spendCaps).toEqual({ claude: 0, codex: 0, gemini: 0 });
  expect(DEFAULT_SETTINGS.warnPct).toBe(0.8);
  expect(DEFAULT_SETTINGS.resetDay).toBe(1);
  expect(DEFAULT_SETTINGS.seats.map((s) => s.provider)).toEqual(['gemini', 'codex', 'claude']);
  expect('tierMap' in DEFAULT_SETTINGS).toBe(false);
  expect(DEFAULT_SETTINGS.autoStart).toBe(false);
  expect(DEFAULT_SETTINGS.autoEscalate).toBe(true);
  expect(DEFAULT_SETTINGS.stallMinutes).toBe(10);
  expect(DEFAULT_SETTINGS.seatTimeoutMs).toBe(60_000);
  expect(DEFAULT_SETTINGS.voteCostCeiling).toBe(0.05);
  expect(DEFAULT_SETTINGS.permissionMode).toBe('ask');
});

test('a partial file is merged over the defaults', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ spendCaps: { claude: 10 }, autoStart: true, seats: [{ provider: 'gemini', model: 'flash' }] }));
  const s = await loadSettings(file);
  expect(s.spendCaps).toEqual({ claude: 10, codex: 0, gemini: 0 });
  expect(s.autoStart).toBe(true);
  expect(s.seats).toEqual([{ provider: 'gemini', model: 'flash' }]);
  expect(s.models).toEqual(DEFAULT_SETTINGS.models);
  expect(s.permissionMode).toBe('ask');
});

test('monthly budgets from before plan detection are dropped rather than kept as hidden caps', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ budgets: { claude: 40, codex: 30, gemini: 30 }, allowedCommands: ['Bash(ls*)'] }));
  const s = await loadSettings(file);
  expect(s.spendCaps).toEqual({ claude: 0, codex: 0, gemini: 0 });
  expect('budgets' in s).toBe(false);
  expect('allowedCommands' in s).toBe(false);
});

test('save then load round-trips', async () => {
  const file = tmpFile();
  const changed = { ...DEFAULT_SETTINGS, resetDay: 15, recentProjects: ['C:/p'] };
  await saveSettings(file, changed);
  expect(await loadSettings(file)).toEqual(changed);
});

test('the file keeps only what differs from the defaults, so improved defaults reach existing installs', async () => {
  const file = tmpFile();
  await saveSettings(file, { ...DEFAULT_SETTINGS, autoStart: true, models: { ...DEFAULT_SETTINGS.models, codex: ['gpt-6'] } });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved).toEqual({ autoStart: true, models: { codex: ['gpt-6'] } });
  const loaded = await loadSettings(file);
  expect(loaded.models.claude).toEqual(DEFAULT_SETTINGS.models.claude);
  expect(loaded.models.codex).toEqual(['gpt-6']);
});

test('a corrupt file falls back to the defaults instead of crashing', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  expect(await loadSettings(file)).toEqual(DEFAULT_SETTINGS);
});

test('effectiveSettings applies a project override and leaves everything else', () => {
  const s = { ...DEFAULT_SETTINGS, projectOverrides: { p1: { autoStart: true, permissionMode: 'auto' as const } } };
  const e = effectiveSettings(s, 'p1');
  expect(e.autoStart).toBe(true);
  expect(e.permissionMode).toBe('auto');
  expect(e.spendCaps).toEqual(s.spendCaps);
  expect(effectiveSettings(s, 'other')).toEqual(s);
});
