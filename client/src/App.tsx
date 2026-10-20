import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { TabView } from './components/TabView';
import type { BudgetState, CliHealth, ProjectInfo, Provider, Settings as SettingsT, Tab, TranscriptItem } from './types';
import { useSocket } from './useSocket';

export function App() {
  const [tabs, setTabs] = useState<Record<string, Tab>>({});
  const [budgets, setBudgets] = useState<Record<Provider, BudgetState> | null>(null);
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [health, setHealth] = useState<Record<Provider, CliHealth> | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'tabs' | 'settings'>('tabs');
  const [error, setError] = useState<string | null>(null);

  const onError = useCallback((message: string) => setError(message), []);

  const connected = useSocket({
    onHello: (all, b) => {
      setTabs(Object.fromEntries(all.map((t) => [t.id, t])));
      if (b) setBudgets(b);
    },
    onTab: (tab) => setTabs((prev) => ({ ...prev, [tab.id]: tab })),
    onItem: (tabId: string, item: TranscriptItem) =>
      setTabs((prev) => {
        const tab = prev[tabId];
        if (!tab) return prev;
        const idx = tab.transcript.findIndex((i) => i.id === item.id);
        const transcript = idx >= 0 ? tab.transcript.map((i, j) => (j === idx ? item : i)) : [...tab.transcript, item];
        return { ...prev, [tabId]: { ...tab, transcript } };
      }),
    onBudgets: setBudgets,
  });

  const openProject = useCallback(async (path: string) => {
    const info = await api.openProject(path);
    setProject({ root: info.root, projectId: info.projectId, defaultBranch: info.defaultBranch });
    setTabs((prev) => ({ ...prev, ...Object.fromEntries(info.tabs.map((t) => [t.id, t])) }));
    setProjects(await api.projects());
    setSelectedId(null);
  }, []);

  useEffect(() => {
    api.settings().then(setSettings).catch((e: Error) => onError(e.message));
    api.health().then(setHealth).catch(() => setHealth(null));
    api.budgets().then(setBudgets).catch(() => {});
    api
      .projects()
      .then(async (list) => {
        setProjects(list);
        if (list[0]) await openProject(list[0].root);
      })
      .catch((e: Error) => onError(e.message));
  }, [onError, openProject]);

  const projectTabs = useMemo(
    () =>
      Object.values(tabs)
        .filter((t) => project && t.projectId === project.projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tabs, project],
  );
  const selected = selectedId ? tabs[selectedId] : undefined;

  const newTab = async () => {
    if (!project) return;
    try {
      const tab = await api.createTab(project.root, '');
      setTabs((prev) => ({ ...prev, [tab.id]: tab }));
      setSelectedId(tab.id);
      setView('tabs');
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        project={project}
        onOpenProject={async (p) => {
          try {
            await openProject(p);
          } catch (err) {
            onError((err as Error).message);
          }
        }}
        tabs={projectTabs}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setView('tabs');
        }}
        onNewTab={() => void newTab()}
        budgets={budgets}
        resetDay={settings?.resetDay ?? 1}
        view={view}
        onView={setView}
        connected={connected}
      />
      <div className="content">
        {error && (
          <div className="banner" role="alert">
            <span>{error}</span>
            <button className="link" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {view === 'settings' && settings ? (
          <Settings settings={settings} onSaved={setSettings} health={health} onError={onError} />
        ) : selected && settings ? (
          <TabView tab={selected} settings={settings} project={project} onError={onError} />
        ) : (
          <main className="empty">
            <h2>Council</h2>
            <p>Open a project on the left, create a tab, and describe a task. The council votes on how hard it is and hands it to the cheapest capable agent in its own git worktree.</p>
            {!project && projects.length === 0 && <p className="muted">Paste the path of a git checkout to begin.</p>}
          </main>
        )}
      </div>
    </div>
  );
}
