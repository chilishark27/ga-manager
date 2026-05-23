import { useEffect } from 'react';
import './styles/global.css';
import NavBar from './components/NavBar';
import TopBar from './components/TopBar';
import SetupPage from './components/SetupPage';
import TodoPanel from './components/TodoPanel';
import ChatPage from './pages/ChatPage';
import ConductorPage from './pages/ConductorPage';
import MonitorPage from './pages/MonitorPage';
import SkillsPage from './pages/SkillsPage';
import SettingsPage from './pages/SettingsPage';
import HivePage from './pages/HivePage';
import MorphlingPage from './pages/MorphlingPage';
import HelpPage from './pages/HelpPage';
import UpdateNotifier from './components/UpdateNotifier';
import { useStore } from './store';
import { I18nProvider } from './i18n';

function AppInner() {
  const { theme, fetchInstances, currentPage, configured, checkConfigured, backendAlive, showTodoPanel, setPage } = useStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    checkConfigured();
  }, []);

  useEffect(() => {
    if (!configured) return;
    fetchInstances();
    useStore.getState().fetchTodos();
    const interval = setInterval(fetchInstances, 2000);
    return () => clearInterval(interval);
  }, [configured, fetchInstances]);

  // Global keyboard shortcuts
  useEffect(() => {
    const pages = ['chat', 'conductor', 'monitor', 'skills', 'settings', 'hive', 'morphling', 'help'] as const;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 7) { e.preventDefault(); setPage(pages[num - 1]); return; }
        if (e.key === 'k' || e.key === 'K') { e.preventDefault(); document.dispatchEvent(new CustomEvent('ga-search-focus')); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.dispatchEvent(new CustomEvent('ga-create-instance')); return; }
      }
      if (e.key === 'Escape') { document.dispatchEvent(new CustomEvent('ga-escape')); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setPage]);

  if (!configured) {
    return <SetupPage />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'chat': return <ChatPage />;
      case 'conductor': return <ConductorPage />;
      case 'monitor': return <MonitorPage />;
      case 'skills': return <SkillsPage />;
      case 'settings': return <SettingsPage />;
      case 'hive': return <HivePage />;
      case 'morphling': return <MorphlingPage />;
      case 'help': return <HelpPage />;
      default: return <ChatPage />;
    }
  };

  return (
    <div className="app-layout">
      <NavBar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          {renderPage()}
        </div>
      </div>
      {!backendAlive && (
        <div className="toast-msg" style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}>
          Backend disconnected — retrying...
        </div>
      )}
      {showTodoPanel && <TodoPanel />}
      <UpdateNotifier />
    </div>
  );
}

export default function App() {
  return <I18nProvider><AppInner /></I18nProvider>;
}
