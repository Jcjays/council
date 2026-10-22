import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCommand, spawnCli } from './spawn.js';
import type { AuthSource, CliHealth, Provider, ProviderPlan } from './types.js';

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

/** Claude before any run: an API key in the environment is metered; a sign-in is most likely the subscription (a run confirms it). */
export function claudePlanGuess(env: NodeJS.ProcessEnv, source: AuthSource): ProviderPlan | undefined {
  if ((env.ANTHROPIC_API_KEY ?? '').trim() !== '') return { kind: 'api-key', label: 'API key (ANTHROPIC_API_KEY)', confirmed: false };
  if (source === 'login' || source === 'unknown') return { kind: 'subscription', label: 'Claude subscription', confirmed: false };
  return undefined;
}

/** `codex login status` prints "Logged in using ChatGPT", "Logged in using an API key - …" or "Not logged in" (on stderr). */
export function codexPlanFromLoginStatus(output: string, exitCode: number): ProviderPlan | undefined {
  if (exitCode !== 0) return undefined;
  if (/logged in using chatgpt/i.test(output)) return { kind: 'subscription', label: 'ChatGPT plan', confirmed: true };
  if (/logged in using an api key/i.test(output)) return { kind: 'api-key', label: 'OpenAI API key', confirmed: true };
  return undefined;
}

const GEMINI_METERED = new Set(['gemini-api-key', 'vertex-ai']);
const GEMINI_ACCOUNT = new Set(['oauth-personal', 'cloud-shell', 'compute-default-credentials']);

/**
 * Gemini from its environment and `~/.gemini/settings.json` (auth type only):
 * an API key or Vertex AI is metered; a Google sign-in uses the account's
 * Code Assist quota, which the CLI does not report.
 */
export function geminiPlan(env: NodeJS.ProcessEnv, settings: unknown, exists: (p: string) => boolean, home: string = os.homedir()): ProviderPlan | undefined {
  if (['GEMINI_API_KEY', 'GOOGLE_API_KEY'].some((k) => (env[k] ?? '').trim() !== '')) return { kind: 'api-key', label: 'Gemini API key', confirmed: false };
  if (/^(1|true)$/i.test(env.GOOGLE_GENAI_USE_VERTEXAI ?? '')) return { kind: 'api-key', label: 'Vertex AI (Google Cloud billing)', confirmed: false };
  const s = settings && typeof settings === 'object' ? (settings as Record<string, any>) : {};
  const selected: unknown = s.security?.auth?.selectedType ?? s.selectedAuthType;
  const account: ProviderPlan = { kind: 'subscription', label: 'Google account (Gemini Code Assist quota)', confirmed: false };
  if (typeof selected === 'string' && GEMINI_METERED.has(selected)) {
    return selected === 'vertex-ai' ? { kind: 'api-key', label: 'Vertex AI (Google Cloud billing)', confirmed: false } : { kind: 'api-key', label: 'Gemini API key', confirmed: false };
  }
  if (typeof selected === 'string' && GEMINI_ACCOUNT.has(selected)) return account;
  if (exists(path.join(home, '.gemini', 'oauth_creds.json'))) return account;
  return undefined;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Runs a CLI subcommand and returns everything it printed, for status commands that write to stderr. */
async function runStatus(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; output: string }> {
  const child = spawnCli(cmd, args, { cwd: process.cwd(), signal: AbortSignal.timeout(timeoutMs), captureStdout: true });
  for await (const _ of child.lines) {
    /* drain */
  }
  const code = await child.exit;
  return { code, output: `${child.stdout()}\n${child.stderr()}` };
}

export async function checkCli(provider: Provider, cmd: string = CLI_COMMANDS[provider]): Promise<CliHealth> {
  const resolved = resolveCommand(cmd);
  const probe = await probeVersion(resolved);
  const auth = detectAuth(provider);
  let authed = probe.installed && auth.authed;
  let plan: ProviderPlan | undefined;
  if (probe.installed && provider === 'codex') {
    const status = await runStatus(resolved, ['login', 'status']).catch(() => undefined);
    if (status && /not logged in/i.test(status.output)) authed = false;
    plan = status ? codexPlanFromLoginStatus(status.output, status.code) : undefined;
    if (plan) authed = true;
  } else if (provider === 'gemini') {
    plan = geminiPlan(process.env, readJsonFile(path.join(os.homedir(), '.gemini', 'settings.json')), (p) => fs.existsSync(p));
  } else if (provider === 'claude') {
    plan = claudePlanGuess(process.env, auth.source);
  }
  return {
    installed: probe.installed,
    version: probe.version,
    authed,
    authSource: auth.source,
    plan: authed ? plan : undefined,
    error: probe.error,
  };
}
