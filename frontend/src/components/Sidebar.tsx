import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useI18n } from '../i18n';

const formatUptime = (seconds: number | string): string => {
  const s = typeof seconds === 'string' ? parseInt(seconds) || 0 : seconds;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

function Sidebar() {
  const {
    instances, activeInstanceId, selectInstance, toggleInstance,
    toggleTheme, theme, runningCount, totalTokens, healthPercent,
    createInstance, deleteInstance, llmConfigs, fetchLLMs, moveInstance,
    discoveredInstances, discoverLoading, attachedPort, discoverInstances, attachInstance, adoptInstance,
    setInstanceProject,
  } = useStore();
  const { t, tf, lang, setLang } = useI18n();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedLLM, setSelectedLLM] = useState(1);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const defaultGaRoot = localStorage.getItem('ga_root') || '';
  const [gaRoot, setGaRoot] = useState(defaultGaRoot);
  const [projectDir, setProjectDir] = useState('');
  const [reflectScript, setReflectScript] = useState('');
  const [reflects, setReflects] = useState<{file: string; name: string}[]>([]);

  // Inline project edit per card (keyed by instance id)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectDir, setEditProjectDir] = useState('');
  const [editReflectScript, setEditReflectScript] = useState('');

  useEffect(() => {
    fetch('/api/config/reflects').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setReflects(data);
    }).catch(() => {});
  }, []);

  // Adopt modal state
  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptPort, setAdoptPort] = useState(0);
  const [adoptGaRoot, setAdoptGaRoot] = useState(localStorage.getItem('ga_root') || '');

  const handleCreate = async () => {
    const name = newName.trim() || `GA-${instances.length + 1}`;
    localStorage.setItem('ga_root', gaRoot);
    await createInstance({
      name,
      llm_no: selectedLLM,
      ga_root: gaRoot,
      project_dir: projectDir || undefined,
      reflect_script: reflectScript || undefined,
    });
    setNewName('');
    setSelectedLLM(1);
    setProjectDir('');
    setReflectScript('');
    setShowCreate(false);
  };

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'Web': return 'var(--accent)';
      case 'IM': return 'var(--accent2)';
      case 'Goal': return 'var(--accent3)';
      case 'Sche': return 'var(--yellow)';
      default: return 'var(--accent)';
    }
  };

  const getDotClass = (inst: { status: string; health: string }) => {
    if (inst.status !== 'running' && inst.status !== 'busy' && inst.status !== 'starting') return 'dot gray';
    if (inst.health === 'warning') return 'dot yellow';
    if (inst.health === 'error') return 'dot red';
    return 'dot green';
  };

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(400, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <div className={`sidebar-resize-handle ${isResizing ? 'dragging' : ''}`} onMouseDown={handleMouseDown} />
      <div className="logo">
        <div className="logo-icon"><img src="/app.png?v=2" alt="GA" style={{width:'28px',height:'28px',borderRadius:'6px'}} /></div>
        <div className="logo-text">GA Manager</div>
        <div className="lang-btn" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={t.language}>
          {lang === 'zh' ? 'EN' : '中'}
        </div>
        <div className="theme-btn" onClick={toggleTheme}>
          {theme === 'dark' ? '◐' : '○'}
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat-mini">
          <div className="sv">{runningCount()}</div>
          <div className="sl">{t.running}</div>
        </div>
        <div className="stat-mini">
          <div className="sv">{totalTokens()}</div>
          <div className="sl">{t.tokens}</div>
        </div>
        <div className="stat-mini">
          <div className="sv">{healthPercent()}</div>
          <div className="sl">{t.health}</div>
        </div>
      </div>

      <div className="inst-list">
        {instances.map((inst, idx) => (
          <div
            key={inst.id}
            className={`inst-card ${inst.id === activeInstanceId ? 'active' : ''}`}
            onClick={() => selectInstance(inst.id)}
          >
            <div className="ic-top">
              <div className={getDotClass(inst)} />
              <span className="ic-name">{inst.name}</span>
              {inst.project_dir ? (
                <span
                  title={inst.project_dir}
                  style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 4, cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProjectId(inst.id);
                    setEditProjectDir(inst.project_dir || '');
                    setEditReflectScript(inst.reflect_script || '');
                  }}
                >
                  [{inst.project_dir.split(/[/\\]/).filter(Boolean).pop()}]
                </span>
              ) : (
                <span
                  style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 4, cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProjectId(inst.id);
                    setEditProjectDir('');
                    setEditReflectScript('');
                  }}
                >{lang === 'zh' ? '设置项目' : 'set project'}</span>
              )}
              <span className="ic-mode" style={{ background: getModeColor(inst.mode) }}>
                {inst.mode}
              </span>
              <span className="ic-right">
                <span
                  className="ic-move"
                  title="上移"
                  onClick={(e) => { e.stopPropagation(); moveInstance(inst.id, -1); }}
                  style={{ opacity: idx === 0 ? 0.3 : 1 }}
                >▲</span>
                <span
                  className="ic-move"
                  title="下移"
                  onClick={(e) => { e.stopPropagation(); moveInstance(inst.id, 1); }}
                  style={{ opacity: idx === instances.length - 1 ? 0.3 : 1 }}
                >▼</span>
                <span
                  className={`toggle ${(inst.status === 'running' || inst.status === 'busy' || inst.status === 'starting') ? 'on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleInstance(inst.id); }}
                />
                <span
                  className="ic-del"
                  title={t.deleteInstance}
                  onClick={(e) => { e.stopPropagation(); if(confirm(tf('confirmDelete', { name: inst.name }))) deleteInstance(inst.id); }}
                >✕</span>
              </span>
            </div>
            <div className="ic-meta">
              PID {inst.pid} · {formatUptime(inst.uptime)} · {inst.tokens_used >= 1000 ? `${(inst.tokens_used / 1000).toFixed(1)}K` : inst.tokens_used} tok
            </div>
            <div className="ic-tags">
              <span className={`ic-tag ${inst.health === 'healthy' ? 'on' : ''}`}>{t.healthy}</span>
              <span className={`ic-tag ${inst.autonomous ? 'on' : ''}`}>{t.autonomous}</span>
              <span className={`ic-tag ${inst.scheduler ? 'on' : ''}`}>{t.scheduler}</span>
              <span className={`ic-tag ${inst.goal ? 'on' : ''}`}>{t.goal}</span>
            </div>
            {editingProjectId === inst.id && (
              <div
                style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg-3)', borderRadius: 6, border: '1px solid var(--border)' }}
                onClick={e => e.stopPropagation()}
              >
                <input
                  style={{ width: '100%', boxSizing: 'border-box', padding: '3px 6px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)',
                    fontSize: 11, marginBottom: 4 }}
                  placeholder={lang === 'zh' ? '项目目录路径' : 'project_dir path'}
                  value={editProjectDir}
                  onChange={e => setEditProjectDir(e.target.value)}
                  autoFocus
                />
                <input
                  style={{ width: '100%', boxSizing: 'border-box', padding: '3px 6px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)',
                    fontSize: 11, marginBottom: 6 }}
                  placeholder={lang === 'zh' ? 'reflect_script (可选)' : 'reflect_script (optional)'}
                  value={editReflectScript}
                  onChange={e => setEditReflectScript(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 5 }}>
                  <button
                    style={{ padding: '2px 10px', borderRadius: 4, border: 'none',
                      background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 11 }}
                    onClick={async () => {
                      await setInstanceProject(inst.id, editProjectDir, editReflectScript);
                      setEditingProjectId(null);
                    }}
                  >{lang === 'zh' ? '保存' : 'Save'}</button>
                  <button
                    style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11 }}
                    onClick={() => setEditingProjectId(null)}
                  >{lang === 'zh' ? '取消' : 'Cancel'}</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="add-btn" onClick={() => { fetchLLMs(); setShowCreate(true); }}>
        {t.newInstance}
      </div>

      <div className="add-btn discover-btn" onClick={() => discoverInstances()}>
        {discoverLoading ? 'Scan...' : 'Scan'}
      </div>

      {discoveredInstances.length > 0 && (
        <div className="discovered-list">
          <div className="discovered-title">已发现 ({discoveredInstances.length})</div>
          {discoveredInstances.map(d => (
            <div
              key={d.port}
              className="inst-card discovered"
            >
              <div className="ic-top">
                <span className="ic-name">GA :{d.port}</span>
                <span className="ic-status running">●</span>
              </div>
              <div className="ic-url">{d.url}</div>
              <button
                className="adopt-btn"
                onClick={() => { setAdoptPort(d.port); setShowAdopt(true); }}
              >Adopt</button>
            </div>
          ))}
        </div>
      )}

      {/* Create Instance Modal - Portal to body for proper centering */}
      {showCreate && createPortal(
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{t.createInstance}</h3>
            <input
              className="modal-input"
              placeholder={t.instanceName}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
            <div className="modal-llm-section">
              <label className="modal-label">GA 项目路径</label>
              <input
                className="modal-input"
                placeholder="GenericAgent project path"
                value={gaRoot}
                onChange={e => setGaRoot(e.target.value)}
              />
            </div>
            <div className="modal-llm-section">
              <label className="modal-label">{t.selectLLM}</label>
              {llmConfigs.length === 0 ? (
                <div className="llm-setup-hint">
                  {t.noLLMConfig}
                </div>
              ) : (
                <div className="llm-select-grid">
                  {llmConfigs.map(cfg => (
                    <div
                      key={cfg.index}
                      className={`llm-select-item ${selectedLLM === cfg.index ? 'active' : ''}`}
                      onClick={() => setSelectedLLM(cfg.index)}
                    >
                      <span className="llm-select-name">{cfg.name}</span>
                      <span className="llm-select-type">{cfg.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-llm-section">
              <label className="modal-label">项目目录 (可选)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="modal-input"
                  style={{ flex: 1 }}
                  placeholder="本地项目路径，如 D:\projects\my-app"
                  value={projectDir}
                  onChange={e => setProjectDir(e.target.value)}
                />
                <button className="ch-btn" style={{ flexShrink: 0 }} onClick={async () => {
                  try {
                    const res = await fetch('/api/project/browse', { method: 'POST' });
                    const data = await res.json();
                    if (data.path) setProjectDir(data.path);
                  } catch {}
                }}>📁</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                实例将以此目录为工作区，自动注入项目上下文
              </div>
            </div>
            {reflects.length > 0 && (
              <div className="modal-llm-section">
                <label className="modal-label">Reflect 脚本 (可选)</label>
                <select
                  className="modal-input"
                  value={reflectScript}
                  onChange={e => setReflectScript(e.target.value)}
                  style={{ height: 36 }}
                >
                  <option value="">无 (普通对话模式)</option>
                  {reflects.map(r => (
                    <option key={r.file} value={r.file}>{r.name} ({r.file})</option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreate(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={handleCreate}>{t.create}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showAdopt && createPortal(
        <div className="modal-overlay" onClick={() => setShowAdopt(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Adopt (端口 {adoptPort})</h3>
            <div className="form-group">
              <label>GA 项目路径 (ga_root)</label>
              <input
                type="text"
                value={adoptGaRoot}
                onChange={e => setAdoptGaRoot(e.target.value)}
                placeholder="GenericAgent project path"
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowAdopt(false)}>取消</button>
              <button className="modal-btn confirm" onClick={async () => {
                await adoptInstance(adoptPort, `GA-${adoptPort}`, adoptGaRoot);
                setShowAdopt(false);
              }}>确认纳管</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default Sidebar;
