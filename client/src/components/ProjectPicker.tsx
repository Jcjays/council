import { useState } from 'react';
import { basename } from '../lib/format';
import type { ProjectInfo } from '../types';

interface Props {
  projects: ProjectInfo[];
  project: ProjectInfo | null;
  onOpenProject: (path: string) => Promise<void>;
}

/** The current checkout, with a "change" link that reveals the path field and the recent list. */
export function ProjectPicker({ projects, project, onOpenProject }: Props) {
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState('');
  const [opening, setOpening] = useState(false);
  const open = async (target: string) => {
    if (!target.trim()) return;
    setOpening(true);
    try {
      await onOpenProject(target.trim());
      setPath('');
      setEditing(false);
    } finally {
      setOpening(false);
    }
  };
  const showForm = editing || !project;
  const others = projects.filter((p) => p.projectId !== project?.projectId);

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
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void open(path);
            }}
          >
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Path to a git checkout" aria-label="Project path" autoFocus={editing} />
            <button type="submit" disabled={opening || !path.trim()}>
              Open
            </button>
          </form>
          {others.length > 0 && (
            <div className="recent" aria-label="Recent projects">
              {others.map((pr) => (
                <button key={pr.projectId} onClick={() => void open(pr.root)} disabled={opening} title={pr.root}>
                  <span className="ellipsis">{basename(pr.root)}</span>
                  <span className="path ellipsis">{pr.root}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
