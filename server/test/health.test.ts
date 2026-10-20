import { expect, test } from 'vitest';
import { detectAuth, probeVersion } from '../src/adapters/health.js';
import { checkAll } from '../src/adapters/index.js';
import type { Adapter, CliHealth, Provider } from '../src/adapters/types.js';

test('checkAll returns one health entry per provider from the registry', async () => {
  const fake = (p: Provider, h: CliHealth): Adapter => ({
    provider: p,
    check: async () => h,
    run: async function* () {
      /* unused */
    },
  });
  const all = await checkAll({
    claude: fake('claude', { installed: true, version: '2.1.302', authed: true }),
    codex: fake('codex', { installed: false, authed: false, error: 'not found' }),
    gemini: fake('gemini', { installed: true, version: '0.15.3', authed: false }),
  });
  expect(Object.keys(all).sort()).toEqual(['claude', 'codex', 'gemini']);
  expect(all.codex).toMatchObject({ installed: false, error: 'not found' });
  expect(all.claude.version).toBe('2.1.302');
});

test('probeVersion reports an installed command and its version', async () => {
  const r = await probeVersion(process.execPath, ['--version']);
  expect(r.installed).toBe(true);
  expect(r.version).toMatch(/^v?\d+\.\d+/);
});

test('probeVersion reports a missing command with an error', async () => {
  const r = await probeVersion('definitely-not-a-cli-xyz-123');
  expect(r.installed).toBe(false);
  expect(r.error).toBeTruthy();
});

test('detectAuth prefers API key environment variables', () => {
  const none = () => false;
  expect(detectAuth('claude', { ANTHROPIC_API_KEY: 'k' }, none, 'win32')).toEqual({ authed: true, source: 'api-key' });
  expect(detectAuth('gemini', { GEMINI_API_KEY: 'k' }, none, 'win32').source).toBe('api-key');
  expect(detectAuth('gemini', { GOOGLE_API_KEY: 'k' }, none, 'win32').source).toBe('api-key');
  expect(detectAuth('codex', { CODEX_API_KEY: 'k' }, none, 'win32').source).toBe('api-key');
  expect(detectAuth('codex', { OPENAI_API_KEY: 'k' }, none, 'win32').source).toBe('api-key');
});

test('detectAuth falls back to stored login files', () => {
  const exists = (p: string) => /\.credentials\.json$|oauth_creds\.json$|auth\.json$/.test(p);
  expect(detectAuth('claude', {}, exists, 'win32')).toEqual({ authed: true, source: 'login' });
  expect(detectAuth('gemini', {}, exists, 'win32').source).toBe('login');
  expect(detectAuth('codex', {}, exists, 'win32').source).toBe('login');
});

test('detectAuth reports none when nothing is found, except Claude on macOS (keychain)', () => {
  expect(detectAuth('claude', {}, () => false, 'win32')).toEqual({ authed: false, source: 'none' });
  expect(detectAuth('gemini', {}, () => false, 'darwin')).toEqual({ authed: false, source: 'none' });
  expect(detectAuth('claude', {}, () => false, 'darwin')).toEqual({ authed: true, source: 'unknown' });
});
