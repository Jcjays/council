import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Home } from './components/Home';
import { Settings } from './components/Settings';
import { ShortcutHelp } from './components/ShortcutHelp';
import { Sidebar } from './components/Sidebar';
import { TabView } from './components/TabView';
import { useNow } from './hooks/useNow';
import { laneOf, stepThrough, visibleOrder } from './lib/lanes';
import { shortcutAction } from './lib/shortcuts';
import type { BudgetState, CliHealth, ProjectInfo, Provider, Settings as SettingsT, Tab, TranscriptItem } from './types';
import { useSocket } from './useSocket';

const DETAILS_KEY = 'council.details';

/** `#tab=<id>` or `#settings`, so a reload or a shared link lands on the same place. */
function readHash(): { tab?: string; settings?: boolean } {
  const h = location.hash.replace(/^#/, '');
  if (h === 'settings') return { settings: true };
  const m = /^tab=([\w-]+)$/.exec(h);
  return m?.[1] ? { tab: m[1] } : {};
}

function writeHash(next: string) {
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname + location.search);
}

function readDetailsPref(): boolean {
  try {
    const v = localStorage.getItem(DETAILS_KEY);
    // Open by default only where the pane has its own column (see the 1200px breakpoint in styles.css).
    return v === null ? window.innerWidth > 1200 : v === '1';
  } catch {
    return true;
  }
}

export function App() {
  const [tabs, setTabs] = useState<Record<string, Tab>>({});
  const [budgets, setBudgets] = useState<Record<Provider, BudgetState> | null>(null);
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [health, setHealth] = useState<Record<Provider, CliHealth> | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'tabs' | 'settings'>(() => (readHash().settings ? 'settings' : 'tabs'));
  /** A tab id from the URL hash, honoured once that tab is known. */
  const [wantedTab, setWantedTab] = useState<string | null>(() => readHash().tab ?? null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [details, setDetails] = useState(readDetailsPref);
  /** Stall notices received per tab, so "Keep waiting" can tell a new stall from the one it answered. */
  const [stallSeq, setStallSeq] = useState<Record<string, number>>({});
  const now = useNow(10_000);

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
    onStall: (tabId: string) => setStallSeq((prev) => ({ ...prev, [tabId]: (prev[tabId] ?? 0) + 1 })),
    onBudgets: setBudgets,
  });

  const openProject = useCallback(async (path: string) => {
    const info = await api.openProject(path);
    setProject({ root: info.root, projectId: info.projectId, defaultBranch: info.defaultBranch });
    setTabs((prev) => ({ ...prev, ...Object.fromEntries(info.tabs.map((t) => [t.id, t])) }));
    setProjects(await api.projects());
    // Keep the selection when it belongs to the project just opened (a reload, or re-opening the same checkout).
    setSelectedId((cur) => (cur && info.tabs.some((t) => t.id === cur) ? cur : null));
  }, []);

  useEffect(() => {
    const wanted = wantedTab ? tabs[wantedTab] : undefined;
    if (!wanted || !project) return;
    setSelectedId(wanted.id);
    setWantedTab(null);
    // A link into another project's tab brings that project's sidebar with it.
    if (wanted.projectId !== project.projectId) openProject(wanted.projectRoot).catch((e: Error) => onError(e.message));
  }, [wantedTab, tabs, project, openProject, onError]);

  useEffect(() => {
    writeHash(view === 'settings' ? '#settings' : selectedId ? `#tab=${selectedId}` : '');
  }, [view, selectedId]);

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

  const projectTabs = useMemo(() => Object.values(tabs).filter((t) => project && t.projectId === project.projectId), [tabs, project]);
  const openTabs = useMemo(() => projectTabs.filter((t) => t.status !== 'closed'), [projectTabs]);
  const selected = selectedId ? tabs[selectedId] : undefined;

  const select = useCallback((id: string | null) => {
    if (id) setSelectedId(id);
    setView('tabs');
  }, []);

  const newTab = useCallback(async () => {
    if (!project) return;
    try {
      const tab = await api.createTab(project.root, '');
      setTabs((prev) => ({ ...prev, [tab.id]: tab }));
      select(tab.id);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [project, select, onError]);

  const toggleDetails = useCallback(() => {
    setDetails((d) => {
      try {
        localStorage.setItem(DETAILS_KEY, d ? '0' : '1');
      } catch {
        /* preference lives for this page only */
      }
      return !d;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutAction(e);
      if (!action) return;
      if (action.type === 'escape') {
        if (help) {
          e.preventDefault();
          setHelp(false);
        }
        return;
      }
      e.preventDefault();
      const order = visibleOrder(projectTabs);
      switch (action.type) {
        case 'new-tab':
          void newTab();
          break;
        case 'settings':
          setView((v) => (v === 'settings' ? 'tabs' : 'settings'));
          break;
        case 'help':
          setHelp((h) => !h);
          break;
        case 'toggle-details':
          toggleDetails();
          break;
        case 'next-tab':
          select(stepThrough(order, selectedId, 1));
          break;
        case 'prev-tab':
          select(stepThrough(order, selectedId, -1));
          break;
        case 'next-attention':
          select(stepThrough(order.filter((t) => laneOf(t) === 'needs-you'), selectedId, 1));
          break;
        case 'prev-attention':
          select(stepThrough(order.filter((t) => laneOf(t) === 'needs-you'), selectedId, -1));
          break;
        case 'jump': {
          const target = order[action.index];
          if (target) select(target.id);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, projectTabs, selectedId, newTab, select, toggleDetails]);

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        project={project}
        onOpenProject={async (p) => {
          try {
            await openProject(p);
            setView('tabs');
          } catch (err) {
            onError((err as Error).message);
          }
        }}
        tabs={projectTabs}
        selectedId={selectedId}
        onSelect={select}
        onNewTab={() => void newTab()}
        budgets={budgets}
        resetDay={settings?.resetDay ?? 1}
        view={view}
        onView={setView}
        onHelp={() => setHelp(true)}
        connected={connected}
        now={now}
      />
      <div className="content">
        {!connected && (
          <div className="banner tone-warn" role="status">
            <span>Reconnecting to the local Council server… Nothing is lost; the page catches up when it is back.</span>
          </div>
        )}
        {error && (
          <div className="banner tone-danger" role="alert">
            <span>{error}</span>
            <button className="link sm" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {view === 'settings' && settings ? (
          <Settings settings={settings} onSaved={setSettings} health={health} onError={onError} />
        ) : selected && settings ? (
          <TabView key={selected.id} tab={selected} settings={settings} project={project} stallSeq={stallSeq[selected.id] ?? 0} details={details} onToggleDetails={toggleDetails} onError={onError} />
        ) : (
          <Home
            projects={projects}
            project={project}
            openTabs={openTabs.length}
            onOpenProject={async (p) => {
              try {
                await openProject(p);
              } catch (err) {
                onError((err as Error).message);
              }
            }}
            onNewTab={() => void newTab()}
          />
        )}
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
