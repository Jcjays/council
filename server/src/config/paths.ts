import os from 'node:os';
import path from 'node:path';

/** Root of Council's per-user data. `COUNCIL_HOME` overrides `~/.council`. */
export function councilHome(): string {
  const fromEnv = process.env.COUNCIL_HOME;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return path.join(os.homedir(), '.council');
}

export interface CouncilPaths {
  home: string;
  settings: string;
  pricing: string;
  ledger: string;
  projects: string;
}

export function paths(home: string = councilHome()): CouncilPaths {
  return {
    home,
    settings: path.join(home, 'settings.json'),
    pricing: path.join(home, 'pricing.json'),
    ledger: path.join(home, 'ledger.jsonl'),
    projects: path.join(home, 'projects'),
  };
}
