import { useState } from 'react';
import { basename } from '../lib/format';
import { useProjectPicker } from '../hooks/useProjectPicker';
import type { ProjectInfo } from '../types';
import { FolderBrowser } from './FolderBrowser';

interface Props {
  projects: ProjectInfo[];
  project: ProjectInfo | null;
  onOpenProject: (path: string) => Promise<void>;
}

/** The current checkout, with quick shortcuts, folder browser, and recent/discovered lists. */
export function ProjectPicker({ projects, project, onOpenProject }: Props) {
  const [editing, setEditing] = useState(false);
  const showForm = editing || !project;
  const { path, setPath, search, setSearch, opening, browsing, setBrowsing, currentCwd, open, recent, discovered } =
    useProjectPicker({ projects, exclude: project, active: showForm, onOpenProject });

  const openAndClose = async (target: string) => {
    await open(target);
    setEditing(false);
  };

  return (
    <>
      {project && (
        <div className="project" title={project.root}>
          <div className="name">
            <span className="ellipsis">{basename(project.root)}</span>
            {project.defaultBranch && <span className="muted xs mono">{project.defaultBranch}</span>}
            <span className="grow" />
            <button className="link xs" onClick={() => setEditing((e) => !e)} aria-expanded={showForm}>
              {editing ? 'done' : 'change'}
            </button>
          </div>
          <div className="path ellipsis">{project.root}</div>
        </div>
      )}

      {showForm && (
        <div className="project-form">
          {/* Quick workspace shortcut */}
          {currentCwd && currentCwd !== project?.root && (
            <button
              type="button"
              className="sm"
              style={{ width: '100%', marginBottom: '6px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => void openAndClose(currentCwd)}
              disabled={opening}
              title={`Open current workspace: ${currentCwd}`}
            >
              <span>🚀</span>
              <span className="ellipsis">Open Current: <strong>{basename(currentCwd)}</strong></span>
            </button>
          )}

          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void openAndClose(path);
            }}
          >
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Path to git checkout…"
              aria-label="Project path"
              autoFocus={editing}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={opening || !path.trim()}>
              Open
            </button>
            <button
              type="button"
              className="quiet sm"
              onClick={() => setBrowsing(true)}
              disabled={opening}
              title="Browse folders and Git repositories"
            >
              📁 Browse
            </button>
          </form>

          {(recent.length > 3 || discovered.length > 0 || search) && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              style={{ fontSize: 'var(--fs-xs)', marginTop: '4px' }}
            />
          )}

          {recent.length > 0 && (
            <div className="recent" aria-label="Recent projects">
              <span className="section-label">Recent</span>
              {recent.map((pr) => (
                <button key={pr.projectId} onClick={() => void openAndClose(pr.root)} disabled={opening} title={pr.root}>
                  <span className="ellipsis">{basename(pr.root)}</span>
                  <span className="path ellipsis">{pr.root}</span>
                </button>
              ))}
            </div>
          )}

          {discovered.length > 0 && (
            <div className="recent" aria-label="Discovered projects" style={{ marginTop: '8px' }}>
              <span className="section-label">Discovered Repositories</span>
              {discovered.map((pr) => (
                <button key={pr.root} onClick={() => void openAndClose(pr.root)} disabled={opening} title={pr.root}>
                  <div className="rrow">
                    <span className="ellipsis">{pr.name}</span>
                    {pr.defaultBranch && <span className="muted xs">{pr.defaultBranch}</span>}
                  </div>
                  <span className="path ellipsis">{pr.root}</span>
                </button>
              ))}
            </div>
          )}

          {search && recent.length === 0 && discovered.length === 0 && (
            <div className="muted xs" style={{ padding: '8px 4px', textAlign: 'center' }}>
              No matching repositories found.
            </div>
          )}
        </div>
      )}

      {browsing && (
        <FolderBrowser
          initialDir={currentCwd || project?.root}
          onSelect={(selected) => void openAndClose(selected)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}
