import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCommand, spawnCli } from './spawn.js';
import type { AuthSource, CliHealth, Provider } from './types.js';

export interface VersionProbe {
  installed: boolean;
  version?: string;
  error?: string;
}

/** Runs `<cmd> --version` and extracts the first version-looking token. */
export async function probeVersion(cmd: string, args: string[] = ['--version'], timeoutMs = 15_000): Promise<VersionProbe> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const child = spawnCli(cmd, args, { cwd: process.cwd(), signal: ac.signal, captureStdout: true });
    for await (const _ of child.lines) {
      /* drain */
    }
    const code = await child.exit;
    const out = `${child.stdout()}\n${child.stderr()}`.trim();
    if (code !== 0) return { installed: false, error: out === '' ? `exit code ${code}` : out };
    const match = /v?\d+\.\d+(?:\.\d+)?[\w.-]*/.exec(out);
    return { installed: true, version: match ? match[0] : out.split('\n')[0] };
  } finally {
    clearTimeout(timer);
  }
}

const ENV_KEYS: Record<Provider, string[]> = {
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
};

const LOGIN_FILES: Record<Provider, string[]> = {
  claude: ['.claude/.credentials.json'],
  gemini: ['.gemini/oauth_creds.json', '.gemini/google_accounts.json'],
  codex: ['.codex/auth.json'],
};

/**
 * Best-effort: an API key in the environment, else a stored login file, else
 * unknown. Claude on macOS keeps its login in the keychain, which we cannot read.
 */
export function detectAuth(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): { authed: boolean; source: AuthSource } {
  if (ENV_KEYS[provider].some((k) => (env[k] ?? '').trim() !== '')) return { authed: true, source: 'api-key' };
  if (LOGIN_FILES[provider].some((rel) => exists(path.join(home, rel)))) return { authed: true, source: 'login' };
  if (provider === 'claude' && platform === 'darwin') return { authed: true, source: 'unknown' };
  return { authed: false, source: 'none' };
}

export const CLI_COMMANDS: Record<Provider, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini' };

export async function checkCli(provider: Provider, cmd: string = CLI_COMMANDS[provider]): Promise<CliHealth> {
  const probe = await probeVersion(resolveCommand(cmd));
  const auth = detectAuth(provider);
  return {
    installed: probe.installed,
    version: probe.version,
    authed: probe.installed && auth.authed,
    authSource: auth.source,
    error: probe.error,
  };
}
