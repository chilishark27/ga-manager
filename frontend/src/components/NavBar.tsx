import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useI18n } from '../i18n';

const NAV_ITEMS: { key: 'chat' | 'conductor' | 'monitor' | 'skills' | 'settings'; icon: string; label: string }[] = [
  { key: 'chat', icon: 'C', label: 'Chat' },
  { key: 'conductor', icon: 'O', label: 'Orch' },
  { key: 'monitor', icon: 'M', label: 'Monitor' },
  { key: 'skills', icon: 'S', label: 'Skills' },
  { key: 'settings', icon: '⚙', label: 'Settings' },
];

function NavBar() {
  const {
    instances, activeInstanceId, selectInstance, currentPage, setPage,
    createInstance, deleteInstance, llmConfigs, fetchLLMs, toggleInstance,
    discoveredInstances, discoverLoading, discoverInstances, adoptInstance,
  } = useStore();
  const { t, tf } = useI18n();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedLLM, setSelectedLLM] = useState(1);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const defaultGaRoot = localStorage.getItem('ga_root') || (isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent');
  const [gaRoot, setGaRoot] = useState(defaultGaRoot);

  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptPort, setAdoptPort] = useState(0);
  const [adoptGaRoot, setAdoptGaRoot] = useState('D:\\python3_project\\GenericAgent');

  const handleCreate = async () => {
    const name = newName.trim() || `GA-${instances.length + 1}`;
    localStorage.setItem('ga_root', gaRoot);
    await createInstance({ name, llm_no: selectedLLM, ga_root: gaRoot });
    setNewName('');
    setSelectedLLM(1);
    setShowCreate(false);
  };

  const getDotClass = (inst: { status: string; health: string }) => {
    if (inst.status !== 'running' && inst.status !== 'busy' && inst.status !== 'starting') return 'nav-dot gray';
    if (inst.health === 'warning') return 'nav-dot yellow';
    if (inst.health === 'error') return 'nav-dot red';
    return 'nav-dot green';
  };

  const getStatusText = (status: string) => {
    if (status === 'running' || status === 'busy') return 'run';
    if (status === 'starting') return 'init';
    return 'off';
  };

  return (
    <div className="nav-bar">
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
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-item-label">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Instance List (bottom) */}
      <div className="nav-instances">
        <div className="nav-instances-header">
          <span className="nav-instances-title">Instances ({instances.length})</span>
        </div>
        <div className="nav-instances-list">
          {instances.map(inst => (
            <div
              key={inst.id}
              className={`nav-inst-item ${inst.id === activeInstanceId ? 'active' : ''}`}
              onClick={() => selectInstance(inst.id)}
              title={`${inst.name} (${inst.status})`}
            >
              <span className={getDotClass(inst)} />
              <span className="nav-inst-name">{inst.name}</span>
              <span className="nav-inst-status">{getStatusText(inst.status)}</span>
            </div>
          ))}
        </div>

        {/* Discovered instances */}
        {discoveredInstances.length > 0 && (
          <div className="nav-discovered">
            {discoveredInstances.map(d => (
              <div key={d.port} className="nav-inst-item discovered" onClick={() => { setAdoptPort(d.port); setShowAdopt(true); }}>
                <span className="nav-dot green" />
                <span className="nav-inst-name">:{d.port}</span>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="nav-actions">
          <button className="nav-action-btn create" onClick={() => { fetchLLMs(); setShowCreate(true); }} title={t.newInstance}>+</button>
          <button className="nav-action-btn scan" onClick={() => discoverInstances()} title="Scan">
            {discoverLoading ? '..' : 'S'}
          </button>
        </div>
      </div>

      {/* Create Instance Modal */}
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
              <label className="modal-label">GA Root</label>
              <input
                className="modal-input"
                placeholder={isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent'}
                value={gaRoot}
                onChange={e => setGaRoot(e.target.value)}
              />
            </div>
            <div className="modal-llm-section">
              <label className="modal-label">{t.selectLLM}</label>
              {llmConfigs.length === 0 ? (
                <div className="llm-setup-hint">{t.noLLMConfig}</div>
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
              <input
                className="modal-input"
                value={adoptGaRoot}
                onChange={e => setAdoptGaRoot(e.target.value)}
                placeholder="D:\python3_project\GenericAgent"
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowAdopt(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={async () => {
                await adoptInstance(adoptPort, `GA-${adoptPort}`, adoptGaRoot);
                setShowAdopt(false);
              }}>{t.create}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default NavBar;
