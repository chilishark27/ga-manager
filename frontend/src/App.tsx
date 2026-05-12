import { useEffect } from 'react';
import './styles/global.css';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import RightPanel from './components/RightPanel';
import { useStore } from './store';

function App() {
  const { theme, fetchInstances } = useStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [fetchInstances]);

  return (
    <>
      <Sidebar />
      <ChatPanel />
      <RightPanel />
    </>
  );
}

export default App;
