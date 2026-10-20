import { useState } from 'react';
import { formatUsd, statusLabel, workerLabel } from '../lib/format';
import type { BudgetState, ProjectInfo, Provider, Tab } from '../types';
import { BudgetBars } from './BudgetBars';

interface Props {
  projects: ProjectInfo[];
  project: ProjectInfo | null;
  onOpenProject: (path: string) => Promise<void>;
  tabs: Tab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewTab: () => void;
  budgets: Record<Provider, BudgetState> | null;
  resetDay: number;
  view: 'tabs' | 'settings';
  onView: (v: 'tabs' | 'settings') => void;
  connected: boolean;
}

export function Sidebar(p: Props) {
  const [path, setPath] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [opening, setOpening] = useState(false);
  const visible = p.tabs.filter((t) => showClosed || t.status !== 'closed');

  const open = async (target: string) => {
    if (!target.trim()) return;
    setOpening(true);
    try {
      await p.onOpenProject(target.trim());
      setPath('');
    } finally {
      setOpening(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>Council</h1>
        <span className={`dot ${p.connected ? 'dot-on' : 'dot-off'}`} title={p.connected ? 'connected' : 'reconnecting…'} />
      </div>

      <section>
        <header className="section-title">Project</header>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void open(path);
          }}
        >
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\path\to\checkout" aria-label="Project path" />
          <button type="submit" disabled={opening}>
            Open
          </button>
        </form>
        {p.projects.length > 0 && (
          <select value={p.project?.root ?? ''} onChange={(e) => void open(e.target.value)} aria-label="Recent projects">
            <option value="">Recent projects…</option>
            {p.projects.map((pr) => (
              <option key={pr.projectId} value={pr.root}>
                {pr.root}
              </option>
            ))}
          </select>
        )}
        {p.project && (
          <div className="muted small" title={p.project.root}>
            {p.project.root}
            {p.project.defaultBranch ? ` · ${p.project.defaultBranch}` : ''}
          </div>
        )}
      </section>

      <BudgetBars budgets={p.budgets} resetDay={p.resetDay} />

      <section className="tabs-list">
        <header className="section-title">
          <span>Tabs</span>
          <button className="link" onClick={p.onNewTab} disabled={!p.project}>
            + New tab
          </button>
        </header>
        {visible.length === 0 && <div className="muted small">{p.project ? 'No tabs yet. Create one and describe a task.' : 'Open a project to start.'}</div>}
        <ul>
          {visible.map((t) => (
            <li key={t.id}>
              <button className={`tab-item ${t.id === p.selectedId ? 'selected' : ''}`} onClick={() => p.onSelect(t.id)}>
                <span className={`status status-${t.status}`} title={statusLabel(t.status)} />
                <span className="tab-title">{t.title || 'Untitled task'}</span>
                <span className="muted small">{t.worker ? workerLabel(t.worker) : statusLabel(t.status)}</span>
                <span className="muted small">{formatUsd(t.costUsd)}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="small muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show closed
        </label>
      </section>

      <nav className="sidebar-nav">
        <button className={p.view === 'tabs' ? 'selected' : ''} onClick={() => p.onView('tabs')}>
          Tabs
        </button>
        <button className={p.view === 'settings' ? 'selected' : ''} onClick={() => p.onView('settings')}>
          Settings
        </button>
      </nav>
    </aside>
  );
}
