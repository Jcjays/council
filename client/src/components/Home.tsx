import { useState } from 'react';
import { basename } from '../lib/format';
import { noneSetUp, type Availability } from '../lib/routing';
import type { CliHealth, ProjectInfo, Provider } from '../types';
import { Health } from './Health';

interface Props {
  projects: ProjectInfo[];
  project: ProjectInfo | null;
  openTabs: number;
  available: Availability;
  /** Plain-language notes on the routing in force (which CLIs are set up, how tiers are filled). */
  notes: string[];
  health: Record<Provider, CliHealth> | null;
  onOpenProject: (path: string) => Promise<void>;
  onNewTab: () => void;
  onSettings: () => void;
}

export function Steps() {
  return (
    <div className="steps" aria-label="How a tab works">
      <div className="step">
        <b>1 · Vote</b>
        <span>Cheap seats rate the task easy, medium or hard.</span>
      </div>
      <div className="step">
        <b>2 · Route</b>
        <span>The cheapest worker for that tier gets it: Gemini, Codex or Claude.</span>
      </div>
      <div className="step">
        <b>3 · Review</b>
        <span>The changes land in your checkout, uncommitted. Look them over in your editor or git.</span>
      </div>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="notes" aria-label="Routing notes">
      {notes.map((n) => (
        <div key={n} className="note-row">
          {n}
        </div>
      ))}
    </div>
  );
}

/** What the main pane shows with no tab selected: set up a CLI, get started, or jump back in. */
export function Home({ projects, project, openTabs, available, notes, health, onOpenProject, onNewTab, onSettings }: Props) {
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

  if (noneSetUp(available)) {
    return (
      <main className="home">
        <div className="home-inner">
          <h2>Set up a coding CLI first</h2>
          <p className="lead">
            Council drives Claude Code, Codex CLI and Gemini CLI, and none of them is installed and signed in on this machine yet, so there is nothing to route a task to. One is enough: with a single provider the council uses its cheapest model and the tiers climb that provider's own models.
          </p>
          <Health health={health} />
          <p className="muted sm">
            Install one, sign in, and Council notices within a minute. The same table lives under{' '}
            <button className="link sm" onClick={onSettings}>
              Settings › CLI health
            </button>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="home">
      <div className="home-inner">
        {project ? (
          <>
            <h2>{openTabs > 0 ? 'Pick a tab, or start another' : 'Start the first task'}</h2>
            <p className="lead">
              {openTabs > 0
                ? `${basename(project.root)} has ${openTabs} open tab${openTabs === 1 ? '' : 's'} in the sidebar. Each one is a task with its own worker, editing this checkout in place.`
                : `Create a tab, describe the task, and the council routes it to the cheapest agent that can handle it. Workers follow the project's CLAUDE.md, AGENTS.md or GEMINI.md.`}
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
            <Notes notes={notes} />
          </>
        ) : (
          <>
            <h2>Get started</h2>
            <p className="lead">Open a git checkout. Each tab puts one agent to work in it, following the project's CLAUDE.md, AGENTS.md or GEMINI.md; nothing is committed, so you review the changes as you would your own.</p>
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
            <Notes notes={notes} />
          </>
        )}
      </div>
    </main>
  );
}
