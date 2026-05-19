import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { parseSessionLog } from '../utils/chatUtils';

const NAV_ITEMS: { key: 'chat' | 'conductor' | 'monitor' | 'skills' | 'settings' | 'hive'; label: string; labelZh: string }[] = [
  { key: 'chat', label: 'Chat', labelZh: '聊天' },
  { key: 'conductor', label: 'Orch', labelZh: '编排' },
  { key: 'monitor', label: 'Monitor', labelZh: '监控' },
  { key: 'skills', label: 'Skills', labelZh: '技能' },
  { key: 'hive', label: 'Hive', labelZh: '蜂巢' },
  { key: 'settings', label: 'Settings', labelZh: '设置' },
];

function NavBar() {
  const {
    instances, activeInstanceId, selectInstance, currentPage, setPage,
    createInstance, deleteInstance, llmConfigs, fetchLLMs, toggleInstance,
    discoveredInstances, discoverLoading, discoverInstances, adoptInstance,
    toggleFeature, theme, toggleTheme,
  } = useStore();
  const { t, tf, lang, setLang } = useI18n();
  const inst = instances.find(i => i.id === activeInstanceId) || null;

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedLLM, setSelectedLLM] = useState(1);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const defaultGaRoot = localStorage.getItem('ga_root') || (isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent');
  const [gaRoot, setGaRoot] = useState(defaultGaRoot);

  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptPort, setAdoptPort] = useState(0);
  const [adoptGaRoot, setAdoptGaRoot] = useState('D:\\python3_project\\GenericAgent');

  const [navWidth, setNavWidth] = useState(90);
  const [isResizing, setIsResizing] = useState(false);

  // Supervisor state
  const [supervisorStatus, setSupervisorStatus] = useState<string>('not_created');
  const [supervisorLoading, setSupervisorLoading] = useState(false);

  useEffect(() => {
    fetch('/api/supervisor/status').then(r => r.json()).then(d => setSupervisorStatus(d.status || 'not_created')).catch(() => {});
    const poll = setInterval(() => {
      fetch('/api/supervisor/status').then(r => r.json()).then(d => setSupervisorStatus(d.status || 'not_created')).catch(() => {});
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  // Session history
  const [sessions, setSessions] = useState<{ name: string; modified: string; size: number; preview?: string; display_name?: string }[]>([]);
  const [showSessions, setShowSessions] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');

  useEffect(() => {
    if (inst && showSessions) {
      fetch(`/api/instances/${inst.id}/sessions`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setSessions(data || []))
        .catch(() => {});
    }
  }, [inst?.id, showSessions]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = navWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(80, Math.min(220, startWidth + ev.clientX - startX));
      setNavWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleCreate = async () => {
    const name = newName.trim() || `GA-${instances.length + 1}`;
    localStorage.setItem('ga_root', gaRoot);
    await createInstance({ name, llm_no: selectedLLM, ga_root: gaRoot });
    setNewName('');
    setSelectedLLM(1);
    setShowCreate(false);
  };

  const getInstClass = (inst: { status: string; health: string }) => {
    if (inst.status === 'running' || inst.status === 'busy' || inst.status === 'starting') {
      if (inst.health === 'error') return 'error';
      return 'running';
    }
    return 'stopped';
  };

  const getStatusText = (status: string) => {
    if (status === 'running' || status === 'busy') return 'running';
    if (status === 'starting') return 'starting';
    return 'stopped';
  };

  const restoreSession = async (filename: string) => {
    if (!inst) return;
    try {
      const res = await fetch(`/api/instances/${inst.id}/sessions/${encodeURIComponent(filename)}`);
      if (res.ok) {
        const text = await res.text();
        const msgs = parseSessionLog(text);
        if (msgs.length > 0) {
          useStore.setState({
            messages: msgs.map(m => ({ role: m.role, content: m.content, status: 'done' as const }))
          });
          useStore.getState().setPage('chat');
        }
      }
    } catch { /* ignore */ }
  };

  const featurePills: { key: 'autonomous' | 'reflect' | 'scheduler' | 'dev_mode'; label: string; labelZh: string }[] = [
    { key: 'autonomous', label: 'Autonomous', labelZh: '自主行动' },
    { key: 'reflect', label: 'Reflect', labelZh: '反思' },
    { key: 'scheduler', label: 'Scheduler', labelZh: '定时任务' },
    { key: 'dev_mode', label: 'Dev Mode', labelZh: '开发模式' },
  ];

  return (
    <div className="nav-bar" style={{ width: navWidth, minWidth: navWidth, position: 'relative' }}>
      <div
        className={`nav-resize-handle ${isResizing ? 'dragging' : ''}`}
        onMouseDown={handleResizeMouseDown}
      />

      {/* Logo */}
      <div className="nav-logo">
        <img src="/app.png?v=2" alt="GA" className="nav-logo-img" />
      </div>

      {/* Navigation Items */}
      <div className="nav-items">
        {NAV_ITEMS.map(item => (
          <div
            key={item.key}
            className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}
            title={item.label}
          >
            <span className="nav-item-text">{lang === 'zh' ? item.labelZh : item.label}</span>
          </div>
        ))}
      </div>

      {/* Feature Toggles */}
      {inst && (
        <div className="nav-features">
          <div className="nav-features-title">Features</div>
          {featurePills.map(pill => {
            const isActive = !!(inst as any)[pill.key];
            return (
              <div
                key={pill.key}
                className={`nav-feature-pill ${isActive ? 'active' : ''}`}
                onClick={() => toggleFeature(inst.id, pill.key)}
                title={lang === 'zh' ? pill.labelZh : pill.label}
              >
                {lang === 'zh' ? pill.labelZh : pill.label}
              </div>
            );
          })}
        </div>
      )}

      {/* Supervisor Agent */}
      <div className="nav-supervisor">
        <div
          className={`nav-supervisor-btn ${supervisorStatus === 'running' || supervisorStatus === 'busy' ? 'active' : ''}`}
          onClick={async () => {
            if (supervisorLoading) return;
            setSupervisorLoading(true);
            try {
              if (supervisorStatus === 'running' || supervisorStatus === 'busy') {
                await fetch('/api/supervisor/stop', { method: 'POST' });
                setSupervisorStatus('stopped');
              } else {
                const gaRoot = localStorage.getItem('ga_root') || (isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent');
                await fetch('/api/supervisor/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ga_root: gaRoot }),
                });
                setSupervisorStatus('running');
              }
            } catch {}
            setSupervisorLoading(false);
          }}
        >
          <span className={`nav-supervisor-dot ${supervisorStatus === 'running' || supervisorStatus === 'busy' ? 'active' : ''}`} />
          <span>{lang === 'zh' ? '总管 Agent' : 'Supervisor'}</span>
        </div>
      </div>

      {/* Session History */}
      {inst && (
        <div className="nav-sessions">
          <div className="nav-sessions-header" onClick={() => setShowSessions(!showSessions)}>
            <span className="nav-sessions-title">{lang === 'zh' ? '对话历史' : 'History'}</span>
            <span className="nav-sessions-chevron">{showSessions ? '▾' : '▸'}</span>
          </div>
          {showSessions && (
            <div className="nav-sessions-list">
              <input
                className="nav-session-search"
                placeholder={lang === 'zh' ? '搜索会话...' : 'Search...'}
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
              />
              {sessions.length === 0 ? (
                <div className="nav-session-empty">{lang === 'zh' ? '暂无记录' : 'No sessions'}</div>
              ) : (
                sessions
                  .filter(s => {
                    if (!sessionSearch.trim()) return true;
                    const q = sessionSearch.toLowerCase();
                    const text = (s.display_name || s.preview || s.name).toLowerCase();
                    return text.includes(q);
                  })
                  .slice(0, sessionSearch.trim() ? 20 : 10)
                  .map(s => {
                  const label = s.display_name || s.preview || s.name.replace('model_responses_', '').replace('.txt', '');
                  return (
                  <div key={s.name} className="nav-session-item" onClick={() => restoreSession(s.name)} title={label}>
                    <span className="nav-session-preview">{label}</span>
                    <span className="nav-session-meta">{s.modified}</span>
                  </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Instance List */}
      <div className="nav-instances">
        <div className="nav-instances-header">
          <span className="nav-instances-title">Instances ({instances.length})</span>
        </div>
        <div className="nav-instances-list">
          {instances.map(inst => (
            <div
              key={inst.id}
              className={`nav-inst-item ${getInstClass(inst)} ${inst.id === activeInstanceId ? 'active' : ''}`}
              onClick={() => selectInstance(inst.id)}
              title={`${inst.name} (${inst.status})`}
            >
              <span className="nav-inst-name">{inst.name}</span>
              <span className="nav-inst-status">{getStatusText(inst.status)}</span>
              <span className="nav-inst-delete" onClick={(e) => { e.stopPropagation(); if (confirm(lang === 'zh' ? `确定删除实例 "${inst.name}"？` : `Delete instance "${inst.name}"?`)) deleteInstance(inst.id); }} title={lang === 'zh' ? '删除' : 'Delete'}>×</span>
            </div>
          ))}
        </div>

        {discoveredInstances.length > 0 && (
          <div className="nav-discovered">
            {discoveredInstances.map(d => (
              <div key={d.port} className="nav-inst-item discovered running" onClick={() => { setAdoptPort(d.port); setShowAdopt(true); }}>
                <span className="nav-inst-name">:{d.port}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom: Theme/Lang + Actions */}
      <div className="nav-bottom">
        <div className="nav-bottom-toggles">
          <div className="nav-toggle-btn" onClick={toggleTheme} title="Theme">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </div>
          <div className="nav-toggle-btn" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title="Language">
            {lang === 'zh' ? 'En' : '中文'}
          </div>
        </div>
        <div className="nav-actions">
          <button className="nav-action-btn create" onClick={() => { fetchLLMs(); setShowCreate(true); }} title={t.newInstance}>{lang === 'zh' ? '新建' : 'New'}</button>
          <button className="nav-action-btn scan" onClick={() => discoverInstances()} title="Scan">
            {discoverLoading ? '...' : (lang === 'zh' ? '扫描' : 'Scan')}
          </button>
        </div>
      </div>

      {/* Create Instance Modal */}
      {showCreate && createPortal(
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{t.createInstance}</h3>
            <input className="modal-input" placeholder={t.instanceName} value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <div className="modal-llm-section">
              <label className="modal-label">GA Root</label>
              <input className="modal-input" placeholder={isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent'} value={gaRoot} onChange={e => setGaRoot(e.target.value)} />
            </div>
            <div className="modal-llm-section">
              <label className="modal-label">{t.selectLLM}</label>
              {llmConfigs.length === 0 ? (
                <div className="llm-setup-hint">{t.noLLMConfig}</div>
              ) : (
                <div className="llm-select-grid">
                  {llmConfigs.map(cfg => (
                    <div key={cfg.index} className={`llm-select-item ${selectedLLM === cfg.index ? 'active' : ''}`} onClick={() => setSelectedLLM(cfg.index)}>
                      <span className="llm-select-name">{cfg.name}</span>
                      <span className="llm-select-type">{cfg.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreate(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={handleCreate}>{t.create}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Adopt Modal */}
      {showAdopt && createPortal(
        <div className="modal-overlay" onClick={() => setShowAdopt(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Adopt (Port {adoptPort})</h3>
            <div className="modal-llm-section">
              <label className="modal-label">GA Root (ga_root)</label>
              <input className="modal-input" value={adoptGaRoot} onChange={e => setAdoptGaRoot(e.target.value)} placeholder="D:\python3_project\GenericAgent" />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowAdopt(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={async () => { await adoptInstance(adoptPort, `GA-${adoptPort}`, adoptGaRoot); setShowAdopt(false); }}>{t.create}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default NavBar;
