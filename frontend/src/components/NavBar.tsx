import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { parseSessionLog } from '../utils/chatUtils';
import {
  MessageOutlined, ClusterOutlined, DashboardOutlined, ThunderboltOutlined,
  ShopOutlined, ApartmentOutlined, ExperimentOutlined, SettingOutlined,
  QuestionCircleOutlined, AppstoreOutlined, HistoryOutlined, ControlOutlined,
  SunOutlined, MoonOutlined, PlusOutlined,
} from '@ant-design/icons';

const NAV_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageOutlined />,
  conductor: <ClusterOutlined />,
  monitor: <DashboardOutlined />,
  skills: <ThunderboltOutlined />,
  sophub: <ShopOutlined />,
  hive: <ApartmentOutlined />,
  morphling: <ExperimentOutlined />,
  settings: <SettingOutlined />,
  help: <QuestionCircleOutlined />,
};

const NAV_ITEMS: { key: 'chat' | 'conductor' | 'monitor' | 'skills' | 'settings' | 'hive' | 'morphling' | 'help' | 'sophub'; label: string; labelZh: string; icon: string; tip: string; tipZh: string }[] = [
  { key: 'chat', label: 'Chat', labelZh: '聊天', icon: '', tip: 'Chat with Agent', tipZh: '与 Agent 对话' },
  { key: 'conductor', label: 'Orch', labelZh: '编排', icon: '', tip: 'Multi-agent orchestration', tipZh: '多 Agent 编排协作' },
  { key: 'monitor', label: 'Monitor', labelZh: '监控', icon: '', tip: 'Token usage & system resources', tipZh: '费用追踪与系统资源' },
  { key: 'skills', label: 'Skills', labelZh: '技能', icon: '', tip: 'Skill tree & SOP editor', tipZh: '技能树与 SOP 编辑' },
  { key: 'sophub', label: 'Sophub', labelZh: 'Sophub', icon: '', tip: 'SOP marketplace', tipZh: 'SOP 市场' },
  { key: 'hive', label: 'Hive', labelZh: '蜂巢', icon: '', tip: 'Multi-agent goal collaboration', tipZh: '多 Agent 目标协作' },
  { key: 'morphling', label: 'Morph', labelZh: '吸收', icon: '', tip: 'Project capability absorption', tipZh: '项目能力吸收/替代' },
  { key: 'settings', label: 'Settings', labelZh: '设置', icon: '', tip: 'App configuration', tipZh: '应用配置' },
  { key: 'help', label: 'Help', labelZh: '帮助', icon: '', tip: 'User guide & shortcuts', tipZh: '使用说明与快捷键' },
];

function NavBar() {
  const {
    instances, activeInstanceId, selectInstance, currentPage, setPage,
    createInstance, deleteInstance, llmConfigs, fetchLLMs, toggleInstance,
    discoveredInstances, discoverLoading, discoverInstances, adoptInstance,
    toggleFeature, theme, toggleTheme, moveInstance,
    sidePanel, setSidePanel,
  } = useStore();
  const { t, tf, lang, setLang } = useI18n();
  const inst = instances.find(i => i.id === activeInstanceId) || null;

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedLLM, setSelectedLLM] = useState(1);
  const defaultGaRoot = localStorage.getItem('ga_root') || '';
  const [gaRoot, setGaRoot] = useState(defaultGaRoot);

  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptPort, setAdoptPort] = useState(0);
  const [adoptGaRoot, setAdoptGaRoot] = useState(localStorage.getItem('ga_root') || '');

  const [navWidth, setNavWidth] = useState(180);
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
  const [showFeatures, setShowFeatures] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingInstance, setRenamingInstance] = useState<string | null>(null);
  const [instRenameValue, setInstRenameValue] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleInstRename = async (id: string) => {
    if (!instRenameValue.trim()) { setRenamingInstance(null); return; }
    try {
      await fetch(`/api/instances/${id}/name`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: instRenameValue.trim() }) });
    } catch {}
    setRenamingInstance(null);
  };

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
      const newWidth = Math.max(160, Math.min(320, startWidth + ev.clientX - startX));
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
    const root = gaRoot.trim();
    if (!root) {
      try {
        const res = await fetch('/api/config/app');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.ga_root) {
            setGaRoot(cfg.ga_root);
            await createInstance({ name, llm_no: selectedLLM, ga_root: cfg.ga_root });
            setNewName('');
            setSelectedLLM(1);
            setShowCreate(false);
            return;
          }
        }
      } catch {}
    }
    await createInstance({ name, llm_no: selectedLLM, ga_root: root || undefined });
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

  const handleRename = async (filename: string) => {
    if (!inst || !renameValue.trim()) { setRenamingSession(null); return; }
    try {
      await fetch(`/api/instances/${inst.id}/sessions/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: filename, name: renameValue.trim() }),
      });
      setSessions(prev => prev.map(s => s.name === filename ? { ...s, display_name: renameValue.trim() } : s));
    } catch {}
    setRenamingSession(null);
  };

  const featurePills: { key: 'autonomous' | 'reflect' | 'scheduler' | 'dev_mode'; label: string; labelZh: string; tip: string; tipZh: string }[] = [
    { key: 'autonomous', label: 'Autonomous', labelZh: '自主行动', tip: 'Agent works independently after 30min idle', tipZh: '30分钟无操作后自动执行任务' },
    { key: 'reflect', label: 'Reflect', labelZh: '反思', tip: 'Self-check + auto review every 5 turns', tipZh: '每次行动自检 + 每5轮自动复盘' },
    { key: 'scheduler', label: 'Scheduler', labelZh: '定时任务', tip: 'Cron-based task execution', tipZh: '按 cron 表达式定时执行任务' },
    { key: 'dev_mode', label: 'Dev Mode', labelZh: '开发模式', tip: 'Inject dev best practices', tipZh: '注入开发最佳实践到系统提示词' },
  ];

  return (
    <>
    {/* Icon Rail */}
    <div className="icon-rail">
      <div className="icon-rail-top">
        <img src="/app.png?v=2" alt="GA" className="icon-rail-logo" />
      </div>
      <div className="icon-rail-nav">
        {NAV_ITEMS.map(item => (
          <div
            key={item.key}
            className={`icon-rail-item ${currentPage === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}
            title={lang === 'zh' ? item.tipZh : item.tip}
          >
            <span className="icon-rail-icon">{NAV_ICONS[item.key]}</span>
          </div>
        ))}
      </div>
      <div className="icon-rail-panels">
        <div className={`icon-rail-item ${sidePanel === 'instances' ? 'panel-active' : ''}`} onClick={() => setSidePanel('instances')} title={lang === 'zh' ? '实例列表' : 'Instances'}>
          <span className="icon-rail-icon"><AppstoreOutlined /></span>
        </div>
        <div className={`icon-rail-item ${sidePanel === 'history' ? 'panel-active' : ''}`} onClick={() => setSidePanel('history')} title={lang === 'zh' ? '对话历史' : 'History'}>
          <span className="icon-rail-icon"><HistoryOutlined /></span>
        </div>
        <div className={`icon-rail-item ${sidePanel === 'features' ? 'panel-active' : ''}`} onClick={() => setSidePanel('features')} title={lang === 'zh' ? '功能开关' : 'Features'}>
          <span className="icon-rail-icon"><ControlOutlined /></span>
        </div>
      </div>
      <div className="icon-rail-bottom">
        <div className="icon-rail-item" onClick={toggleTheme} title={lang === 'zh' ? '切换主题' : 'Toggle theme'}>
          <span className="icon-rail-icon">{theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}</span>
        </div>
        <div className="icon-rail-item" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={lang === 'zh' ? '切换语言' : 'Language'}>
          <span className="icon-rail-icon" style={{ fontSize: '11px', fontWeight: 600 }}>{lang === 'zh' ? 'En' : '中'}</span>
        </div>
      </div>
    </div>

    {/* Side Panel */}
    {sidePanel && (
      <div className="side-panel">
        {sidePanel === 'instances' && (
          <>
            <div className="side-panel-header">
              <span className="side-panel-title">{lang === 'zh' ? '实例' : 'Instances'} ({instances.length})</span>
              <button className="side-panel-action" onClick={() => { fetchLLMs(); fetch('/api/config/app').then(r => r.ok ? r.json() : {}).then((d: any) => { if (d.ga_root) setGaRoot(d.ga_root); }).catch(() => {}); setShowCreate(true); }}><PlusOutlined /></button>
            </div>
            <div className="side-panel-content">
              {instances.map(inst => (
                renamingInstance === inst.id ? (
                  <div key={inst.id} className="nav-inst-item active">
                    <input className="nav-rename-input" autoFocus value={instRenameValue}
                      onChange={e => setInstRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleInstRename(inst.id); if (e.key === 'Escape') setRenamingInstance(null); }}
                      onBlur={() => handleInstRename(inst.id)} />
                  </div>
                ) : (
                <div
                  key={inst.id}
                  className={`nav-inst-item ${getInstClass(inst)} ${inst.id === activeInstanceId ? 'active' : ''}`}
                  draggable
                  onDragStart={() => setDragIdx(instances.indexOf(inst))}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(instances.indexOf(inst)); }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={() => { if (dragIdx !== null && dragIdx !== instances.indexOf(inst)) { const dir = instances.indexOf(inst) - dragIdx; for (let i = 0; i < Math.abs(dir); i++) moveInstance(inst.id, dir > 0 ? -1 : 1); } setDragIdx(null); setDragOverIdx(null); }}
                  onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                  onClick={() => selectInstance(inst.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); setRenamingInstance(inst.id); setInstRenameValue(inst.name); }}
                  title={`${inst.name} (${inst.status})`}
                >
                  <span className={`nav-dot ${inst.status === 'running' || inst.status === 'busy' ? 'green' : inst.status === 'error' ? 'red' : 'gray'}`} />
                  <span className="nav-inst-name">{inst.name}</span>
                  <span className="nav-inst-delete" onClick={(e) => { e.stopPropagation(); if (confirm(lang === 'zh' ? `确定删除实例 "${inst.name}"？` : `Delete instance "${inst.name}"?`)) deleteInstance(inst.id); }}>×</span>
                </div>
                )
              ))}
              {discoveredInstances.length > 0 && (
                <>
                  <div className="nav-discovered-title">{lang === 'zh' ? '发现的实例' : 'Discovered'}</div>
                  {discoveredInstances.map(d => (
                    <div key={d.port} className="nav-inst-item discovered running" onClick={() => { setAdoptPort(d.port); setShowAdopt(true); }}>
                      <span className="nav-dot green" />
                      <span className="nav-inst-name">GA :{d.port}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="side-panel-footer">
              <button className="nav-action-btn scan" onClick={() => discoverInstances()}>
                {discoverLoading ? '...' : (lang === 'zh' ? '扫描' : 'Scan')}
              </button>
            </div>
          </>
        )}

        {sidePanel === 'history' && inst && (
          <>
            <div className="side-panel-header">
              <span className="side-panel-title">{lang === 'zh' ? '对话历史' : 'History'}</span>
            </div>
            <div className="side-panel-content">
              <input
                className="nav-session-search"
                placeholder={lang === 'zh' ? '搜索...' : 'Search...'}
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
                    return (s.display_name || s.preview || s.name).toLowerCase().includes(q);
                  })
                  .slice(0, sessionSearch.trim() ? 20 : 15)
                  .map(s => {
                    const label = s.display_name || s.preview || s.name.replace('model_responses_', '').replace('.txt', '');
                    if (renamingSession === s.name) {
                      return (
                        <div key={s.name} className="nav-session-item">
                          <input className="nav-session-search" style={{ marginBottom: 0 }} autoFocus value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(s.name); if (e.key === 'Escape') setRenamingSession(null); }}
                            onBlur={() => handleRename(s.name)} />
                        </div>
                      );
                    }
                    return (
                      <div key={s.name} className="nav-session-item" onClick={() => restoreSession(s.name)}
                        onDoubleClick={(e) => { e.stopPropagation(); setRenamingSession(s.name); setRenameValue(s.display_name || ''); }}
                        title={label}>
                        <span className="nav-session-preview">{label}</span>
                      </div>
                    );
                  })
              )}
            </div>
          </>
        )}

        {sidePanel === 'features' && inst && (
          <>
            <div className="side-panel-header">
              <span className="side-panel-title">{lang === 'zh' ? '功能' : 'Features'}</span>
            </div>
            <div className="side-panel-content">
              {featurePills.map(pill => {
                const isActive = !!(inst as any)[pill.key];
                return (
                  <div key={pill.key} className={`nav-feature-pill ${isActive ? 'active' : ''}`}
                    onClick={() => toggleFeature(inst.id, pill.key)}
                    title={lang === 'zh' ? pill.tipZh : pill.tip}>
                    {lang === 'zh' ? pill.labelZh : pill.label}
                  </div>
                );
              })}
              <div style={{ marginTop: 12 }}>
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
                        const gaRoot = localStorage.getItem('ga_root') || '';
                        await fetch('/api/supervisor/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ga_root: gaRoot }) });
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
            </div>
          </>
        )}
      </div>
    )}

      {/* Create Instance Modal */}
      {showCreate && createPortal(
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{t.createInstance}</h3>
            <input className="modal-input" placeholder={t.instanceName} value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <div className="modal-llm-section">
              <label className="modal-label">GA Root</label>
              <input className="modal-input" placeholder={lang === 'zh' ? 'GenericAgent 项目路径' : 'Path to GenericAgent'} value={gaRoot} onChange={e => setGaRoot(e.target.value)} />
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
              <input className="modal-input" value={adoptGaRoot} onChange={e => setAdoptGaRoot(e.target.value)} placeholder={lang === 'zh' ? 'GenericAgent 项目路径' : 'Path to GenericAgent'} />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowAdopt(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={async () => { await adoptInstance(adoptPort, `GA-${adoptPort}`, adoptGaRoot); setShowAdopt(false); }}>{t.create}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default NavBar;
