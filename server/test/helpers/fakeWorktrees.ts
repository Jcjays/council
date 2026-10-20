import { slugify, type MergeResult, type WorktreeOps } from '../../src/worktrees/manager.js';

/** In-memory stand-in for WorktreeManager that records what the engine asked for. */
export class FakeWorktrees implements WorktreeOps {
  created: { tabId: string; title: string }[] = [];
  commits: string[] = [];
  removed: { path: string; keepBranch: boolean }[] = [];
  mergeResult: MergeResult = { kind: 'merged', sha: 'abc1234' };
  unmerged = true;
  diff = ' a.txt | 1 +';

  constructor(public readonly root: string) {}

  async defaultBranch(): Promise<string> {
    return 'main';
  }

  async ensureExcluded(): Promise<void> {}

  async create(tabId: string, title: string): Promise<{ path: string; branch: string }> {
    this.created.push({ tabId, title });
    return { path: `${this.root}/.worktrees/${tabId}`, branch: `council/${slugify(title)}-${tabId.slice(0, 6)}` };
  }

  async commitAll(_wtPath: string, message: string): Promise<{ committed: boolean; sha?: string }> {
    this.commits.push(message);
    return { committed: true, sha: 'abc1234' };
  }

  async mainCheckoutState(): Promise<{ branch: string; clean: boolean; dirtyFiles: string[] }> {
    return { branch: 'main', clean: true, dirtyFiles: [] };
  }

  async mergeInto(): Promise<MergeResult> {
    return this.mergeResult;
  }

  async hasUnmergedCommits(): Promise<boolean> {
    return this.unmerged;
  }

  async diffStat(): Promise<string> {
    return this.diff;
  }

  async remove(path: string, opts: { keepBranch: boolean; branch: string }): Promise<void> {
    this.removed.push({ path, keepBranch: opts.keepBranch });
  }
}
