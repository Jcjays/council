import { useState } from 'react';
import { basename } from '../lib/format';
import type { ProjectInfo } from '../types';

interface Props {
  projects: ProjectInfo[];
  project: ProjectInfo | null;
  openTabs: number;
  onOpenProject: (path: string) => Promise<void>;
  onNewTab: () => void;
}

export function Steps() {
  return (
    <div className="steps" aria-label="How a tab works">
      <div className="step">
        <b>1 · Vote</b>
        <span>Three cheap seats rate the task easy, medium or hard.</span>
      </div>
      <div className="step">
        <b>2 · Route</b>
        <span>The cheapest worker for that tier gets it: Gemini, Codex or Claude.</span>
      </div>
      <div className="step">
        <b>3 · Worktree</b>
        <span>It works on its own branch; you merge when it is done.</span>
      </div>
    </div>
  );
}

/** What the main pane shows with no tab selected: get started, or jump back in. */
export function Home({ projects, project, openTabs, onOpenProject, onNewTab }: Props) {
  const [path, setPath] = useState('');
  const [opening, setOpening] = useState(false);
  const open = async (target: string) => {
    if (!target.trim()) return;
    setOpening(true);
    try {
      await onOpenProject(target.trim());
      setPath('');
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="home">
      <div className="home-inner">
        {project ? (
          <>
            <h2>{openTabs > 0 ? 'Pick a tab, or start another' : 'Start the first task'}</h2>
            <p className="lead">
              {openTabs > 0
                ? `${basename(project.root)} has ${openTabs} open tab${openTabs === 1 ? '' : 's'} in the sidebar. Each one is a task with its own worker and git worktree.`
                : `Create a tab, describe the task, and the council routes it to the cheapest agent that can handle it.`}
            </p>
            <div className="row">
              <button className="primary" onClick={onNewTab}>
                + New tab
              </button>
              <span className="muted sm">
                or press <kbd>Alt</kbd> <kbd>N</kbd>
              </span>
            </div>
            <Steps />
          </>
        ) : (
          <>
            <h2>Get started</h2>
            <p className="lead">Open a git checkout. Council keeps a branch and worktree per task inside it, so several agents can work on the same project at once.</p>
            <div className="card">
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void open(path);
                }}
              >
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\path\to\checkout" aria-label="Project path" autoFocus />
                <button type="submit" className="primary" disabled={opening || !path.trim()}>
                  Open
                </button>
              </form>
              {projects.length > 0 && (
                <div className="recent" aria-label="Recent projects">
                  <span className="section-label">Recent</span>
                  {projects.map((pr) => (
                    <button key={pr.projectId} onClick={() => void open(pr.root)} disabled={opening}>
                      <span className="rrow">
                        <span>{basename(pr.root)}</span>
                        <span className="muted xs">{pr.defaultBranch ?? ''}</span>
                      </span>
                      <span className="path">{pr.root}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Steps />
          </>
        )}
      </div>
    </main>
  );
}
