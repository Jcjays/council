import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gitOk, runGit } from './git.js';

export const WORKTREES_DIR = '.worktrees';
export const BRANCH_PREFIX = 'council/';
const SLUG_MAX = 40;

/** Lowercase ASCII words joined by dashes, at most 40 characters, `task` when empty. */
export function slugify(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let slug = words.join('-');
  if (slug.length > SLUG_MAX) slug = slug.slice(0, SLUG_MAX).replace(/-+$/, '');
  return slug === '' ? 'task' : slug;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface CommitResult {
  committed: boolean;
  sha?: string;
}

export interface CheckoutState {
  branch: string;
  clean: boolean;
  dirtyFiles: string[];
}

export type MergeResult =
  | { kind: 'merged'; sha: string }
  | { kind: 'blocked'; reason: string; files?: string[] }
  | { kind: 'conflict'; files: string[] };

export interface WorktreeOps {
  defaultBranch(): Promise<string>;
  ensureExcluded(): Promise<void>;
  create(tabId: string, title: string): Promise<WorktreeInfo>;
  commitAll(wtPath: string, message: string): Promise<CommitResult>;
  mainCheckoutState(): Promise<CheckoutState>;
  mergeInto(branch: string, target: string): Promise<MergeResult>;
  hasUnmergedCommits(branch: string, target: string): Promise<boolean>;
  diffStat(wtPath: string): Promise<string>;
  remove(wtPath: string, opts: { keepBranch: boolean; branch: string }): Promise<void>;
}

/** Per-tab git worktrees under `<root>/.worktrees`, on `council/<slug>-<id>` branches. */
export class WorktreeManager implements WorktreeOps {
  constructor(public readonly root: string) {}

  async defaultBranch(): Promise<string> {
    const origin = await runGit(this.root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (origin.code === 0 && origin.stdout.trim() !== '') return origin.stdout.trim().replace(/^origin\//, '');
    const head = await runGit(this.root, ['symbolic-ref', '--short', 'HEAD']);
    if (head.code === 0 && head.stdout.trim() !== '') return head.stdout.trim();
    for (const candidate of ['main', 'master']) {
      const r = await runGit(this.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]);
      if (r.code === 0) return candidate;
    }
    throw new Error(`cannot determine the default branch of ${this.root}`);
  }

  async ensureExcluded(): Promise<void> {
    const common = await gitOk(this.root, ['rev-parse', '--git-common-dir']);
    const infoDir = path.join(path.resolve(this.root, common), 'info');
    const file = path.join(infoDir, 'exclude');
    await fs.mkdir(infoDir, { recursive: true });
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      /* no exclude file yet */
    }
    const line = `${WORKTREES_DIR}/`;
    if (text.split(/\r?\n/).some((l) => l.trim() === line)) return;
    const sep = text === '' || text.endsWith('\n') ? '' : '\n';
    await fs.writeFile(file, `${text}${sep}${line}\n`, 'utf8');
  }

  async create(tabId: string, title: string): Promise<WorktreeInfo> {
    const base = await this.defaultBranch();
    const hasCommit = await runGit(this.root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    if (hasCommit.code !== 0) throw new Error(`repository has no commits on ${base}; commit something first`);
    await this.ensureExcluded();

    const id = tabId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || randomBytes(3).toString('hex');
    const leaf = `${slugify(title)}-${id}`;
    const branch = `${BRANCH_PREFIX}${leaf}`;
    const wtPath = path.join(this.root, WORKTREES_DIR, leaf);
    await gitOk(this.root, ['worktree', 'add', '-b', branch, wtPath, base]);
    return { path: wtPath, branch };
  }

  async commitAll(wtPath: string, message: string): Promise<CommitResult> {
    await gitOk(wtPath, ['add', '-A']);
    const staged = await runGit(wtPath, ['diff', '--cached', '--quiet']);
    if (staged.code === 0) return { committed: false };
    await gitOk(wtPath, ['commit', '-q', '-m', message]);
    return { committed: true, sha: await gitOk(wtPath, ['rev-parse', '--short=7', 'HEAD']) };
  }

  async mainCheckoutState(): Promise<CheckoutState> {
    const head = await runGit(this.root, ['symbolic-ref', '--short', 'HEAD']);
    const branch = head.code === 0 && head.stdout.trim() !== '' ? head.stdout.trim() : 'HEAD';
    const status = await runGit(this.root, ['status', '--porcelain']);
    if (status.code !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`);
    // Porcelain lines are `XY path`; the first column may be a space, so never trim the line first.
    const dirtyFiles = status.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => l.slice(3).trim().replace(/^"(.*)"$/, '$1'));
    return { branch, clean: dirtyFiles.length === 0, dirtyFiles };
  }

  async mergeInto(branch: string, target: string): Promise<MergeResult> {
    const state = await this.mainCheckoutState();
    if (state.branch !== target) {
      return { kind: 'blocked', reason: `the main checkout is on ${state.branch}, not ${target}; switch to ${target} first` };
    }
    if (!state.clean) {
      return { kind: 'blocked', reason: 'uncommitted changes in the main checkout; commit or stash them first', files: state.dirtyFiles };
    }
    const merge = await runGit(this.root, ['merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} (council)`, branch]);
    if (merge.code === 0) return { kind: 'merged', sha: await gitOk(this.root, ['rev-parse', '--short=7', 'HEAD']) };

    const conflicts = (await runGit(this.root, ['diff', '--name-only', '--diff-filter=U'])).stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '');
    await runGit(this.root, ['merge', '--abort']);
    if (conflicts.length > 0) return { kind: 'conflict', files: conflicts };
    return { kind: 'blocked', reason: (merge.stderr || merge.stdout).trim() || 'merge failed' };
  }

  async hasUnmergedCommits(branch: string, target: string): Promise<boolean> {
    const r = await runGit(this.root, ['rev-list', '--count', `${target}..${branch}`]);
    return r.code === 0 && Number.parseInt(r.stdout.trim(), 10) > 0;
  }

  async diffStat(wtPath: string): Promise<string> {
    const stat = (await runGit(wtPath, ['diff', '--stat'])).stdout.trim();
    const untracked = (await runGit(wtPath, ['ls-files', '--others', '--exclude-standard'])).stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((f) => ` ${f} (new file)`);
    return [stat, ...untracked].filter((s) => s !== '').join('\n');
  }

  async remove(wtPath: string, opts: { keepBranch: boolean; branch: string }): Promise<void> {
    await runGit(this.root, ['worktree', 'remove', '--force', wtPath]);
    await fs.rm(wtPath, { recursive: true, force: true });
    await runGit(this.root, ['worktree', 'prune']);
    if (!opts.keepBranch) await runGit(this.root, ['branch', '-D', opts.branch]);
  }
}
