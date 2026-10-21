import { useEffect, useState } from 'react';
import { api } from '../api';
import { basename } from '../lib/format';
import type { DiscoveredProject, ProjectInfo } from '../types';

interface Options {
  /** Projects opened before, newest first. */
  projects: ProjectInfo[];
  /** The project already open: never offered again in either list. */
  exclude?: ProjectInfo | null;
  /** Whether the lists are on screen; discovery only runs while they are. */
  active?: boolean;
  onOpenProject: (path: string) => Promise<void>;
}

function matches(haystack: string[], needle: string): boolean {
  return needle === '' || haystack.some((h) => h.toLowerCase().includes(needle));
}

/**
 * The shared half of the two project pickers (the sidebar's and Home's): the typed
 * path, the search box, the discovered repositories, and opening one. Only the
 * markup around it differs.
 */
export function useProjectPicker({ projects, exclude = null, active = true, onOpenProject }: Options) {
  const [path, setPath] = useState('');
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredProject[]>([]);
  const [currentCwd, setCurrentCwd] = useState('');

  useEffect(() => {
    if (!active) return;
    api
      .discoverProjects()
      .then((res) => {
        setCurrentCwd(res.currentCwd);
        setDiscovered(res.projects);
      })
      .catch(() => {});
  }, [active]);

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

  const needle = search.toLowerCase().trim();
  const recent = projects.filter((p) => p.projectId !== exclude?.projectId && matches([basename(p.root), p.root], needle));
  const discoveredMatches = discovered.filter(
    (d) =>
      d.root !== exclude?.root &&
      !projects.some((p) => p.root.toLowerCase() === d.root.toLowerCase()) &&
      matches([d.name, d.root], needle),
  );

  return {
    path,
    setPath,
    search,
    setSearch,
    opening,
    browsing,
    setBrowsing,
    currentCwd,
    open,
    recent,
    discovered: discoveredMatches,
  };
}
