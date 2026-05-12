import { useState } from 'react';
import { useStore } from '../store';

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
    createInstance, deleteInstance, llmConfigs, fetchLLMs,
  } = useStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedLLM, setSelectedLLM] = useState(1);

  const handleCreate = async () => {
    const name = newName.trim() || `GA-${instances.length + 1}`;
    await createInstance({ name, llm_no: selectedLLM });
    setNewName('');
    setSelectedLLM(1);
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

  return (
    <div className="sidebar">
      <div className="logo">
        <div className="logo-icon"><img src="/app.png" alt="GA" style={{width:'28px',height:'28px',borderRadius:'6px'}} /></div>
        <div className="logo-text">GA Manager</div>
        <div className="theme-btn" onClick={toggleTheme}>
          {theme === 'dark' ? '🌙' : '☀️'}
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat-mini">
          <div className="sv">{runningCount()}</div>
          <div className="sl">运行中</div>
        </div>
        <div className="stat-mini">
          <div className="sv">{totalTokens()}</div>
          <div className="sl">Tokens</div>
        </div>
        <div className="stat-mini">
          <div className="sv">{healthPercent()}</div>
          <div className="sl">健康</div>
        </div>
      </div>

      <div className="inst-list">
        {instances.map(inst => (
          <div
            key={inst.id}
            className={`inst-card ${inst.id === activeInstanceId ? 'active' : ''}`}
            onClick={() => selectInstance(inst.id)}
          >
            <div className="ic-top">
              <div className={getDotClass(inst)} />
              <span className="ic-name">{inst.name}</span>
              <span className="ic-mode" style={{ background: getModeColor(inst.mode) }}>
                {inst.mode}
              </span>
              <span className="ic-right">
                <span
                  className={`toggle ${(inst.status === 'running' || inst.status === 'busy' || inst.status === 'starting') ? 'on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleInstance(inst.id); }}
                />
                <span
                  className="ic-del"
                  title="删除实例"
                  onClick={(e) => { e.stopPropagation(); if(confirm('确定删除实例 '+inst.name+'？')) deleteInstance(inst.id); }}
                >✕</span>
              </span>
            </div>
            <div className="ic-meta">
              PID {inst.pid} · {formatUptime(inst.uptime)} · {inst.tokens_used >= 1000 ? `${(inst.tokens_used / 1000).toFixed(1)}K` : inst.tokens_used} tok
            </div>
            <div className="ic-tags">
              <span className={`ic-tag ${inst.health === 'healthy' ? 'on' : ''}`}>健康</span>
              <span className={`ic-tag ${inst.autonomous ? 'on' : ''}`}>自主</span>
              <span className={`ic-tag ${inst.scheduler ? 'on' : ''}`}>定时</span>
              <span className={`ic-tag ${inst.goal ? 'on' : ''}`}>Goal</span>
            </div>
          </div>
        ))}
      </div>

      <div className="add-btn" onClick={() => { fetchLLMs(); setShowCreate(true); }}>
        + 新建实例
      </div>

      {/* Create Instance Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>创建新实例</h3>
            <input
              className="modal-input"
              placeholder="实例名称 (可选)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
            <div className="modal-llm-section">
              <label className="modal-label">选择 LLM 模型</label>
              {llmConfigs.length === 0 ? (
                <div className="llm-setup-hint">
                  ⚠️ 未检测到LLM配置，请先在 GA 目录下配置 mykey.py
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
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowCreate(false)}>取消</button>
              <button className="modal-btn confirm" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
