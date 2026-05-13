import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

type Section = 'resources' | 'features' | 'overview' | 'schedules' | 'sophub';

function RightPanel() {
  const {
    activeInstance, instances, activeInstanceId,
    toggleFeature, setStringConfig, fetchResources, resources,
    fetchSchedules, schedules, addSchedule, deleteSchedule,
    searchSophub, sophubResults, sophubLoading, downloadSop,
    exportChat, sendCommand, forwardMessage, batchAction,
    llmConfigs, switchLLM, showLLMSelector, setShowLLMSelector,
    showIMSelector, setShowIMSelector, setIMChannel,
    showToast,
  } = useStore();
  const { t } = useI18n();

  const [showConfig, setShowConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ ga_path: '', python_path: '' });
  const [schedCron, setSchedCron] = useState('');
  const [schedTask, setSchedTask] = useState('');
  const [sophubQ, setSophubQ] = useState('');
  const [cmdInput, setCmdInput] = useState('');
  const [fwdTarget, setFwdTarget] = useState('');
  const [fwdMsg, setFwdMsg] = useState('');
  const [localSops, setLocalSops] = useState<{name:string,type:string,size:number}[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('resources');
  const [sopViewer, setSopViewer] = useState<{name:string,content:string,type:string}|null>(null);
  const [sopLoading, setSopLoading] = useState(false);

  const inst = activeInstance();
  const id = activeInstanceId;
  const resourceTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const CRON_PRESETS = [
    { label: t.cronEvery5m, value: '*/5 * * * *' },
    { label: t.cronEvery30m, value: '*/30 * * * *' },
    { label: t.cronEveryHour, value: '0 * * * *' },
    { label: t.cronDaily9, value: '0 9 * * *' },
    { label: t.cronDaily18, value: '0 18 * * *' },
    { label: t.cronWeekday9, value: '0 9 * * 1-5' },
  ];

  const featureConfigs: Record<string, { icon: string; activeIcon: string; label: string; color: string }> = {
    autonomous: { icon: '⚡', activeIcon: '⚡', label: t.autonomous || 'Autonomous', color: '#f59e0b' },
    goal: { icon: '🎯', activeIcon: '🎯', label: t.goalMode || 'Goal Mode', color: '#8b5cf6' },
    reflect: { icon: '🪞', activeIcon: '🪞', label: t.reflect || 'Reflect', color: '#06b6d4' },
    scheduler: { icon: '📅', activeIcon: '📅', label: t.scheduler || 'Scheduler', color: '#10b981' },
    team_worker: { icon: '👥', activeIcon: '👥', label: t.teamWorker || 'Team Worker', color: '#ec4899' },
  };

  // Auto-fetch resources every 10s when instance is active
  useEffect(() => {
    if (!id) return;
    fetchResources(id);
    resourceTimer.current = setInterval(() => fetchResources(id), 10000);
    return () => { if (resourceTimer.current) clearInterval(resourceTimer.current); };
  }, [id]);

  // Load schedules when section opens
  useEffect(() => {
    if (activeSection === 'schedules' && id) fetchSchedules(id);
  }, [activeSection, id]);

  // Fetch local SOPs
  useEffect(() => {
    if (activeSection === 'resources' && localSops.length === 0) {
      fetch('/api/sops/local').then(r => r.json()).then(d => {
        if (d.sops) setLocalSops(d.sops);
      }).catch(() => {});
    }
  }, [activeSection]);

  // IM channels
  const imChannels = ['qq', 'telegram', 'discord', 'dingtalk', 'feishu', 'wechat', 'wecom'];

  const viewSop = async (name: string) => {
    setSopLoading(true);
    try {
      const r = await fetch(`/api/sops/local/${encodeURIComponent(name)}`);
      const d = await r.json();
      setSopViewer({ name: d.name, content: d.content || JSON.stringify(d.files, null, 2), type: d.type });
    } catch { setSopViewer({ name, content: 'Failed to load', type: 'error' }); }
    setSopLoading(false);
  };

  const [goalInput, setGoalInput] = useState('');
  const [peerHintInput, setPeerHintInput] = useState('');

  useEffect(() => {
    if (inst) {
      setGoalInput(inst.goal || '');
      setPeerHintInput(inst.peer_hint || '');
    }
  }, [inst?.id, inst?.goal, inst?.peer_hint]);

  if (!inst) {
    return null;
  }

  const sections: { key: Section; icon: string; title: string }[] = [
    { key: 'resources', icon: '💻', title: t.systemResources || 'Resources' },
    { key: 'features', icon: '⚡', title: t.featureToggles || 'Features' },
    { key: 'overview', icon: '📊', title: t.tabOverview || 'Overview' },
    { key: 'schedules', icon: '⏰', title: t.tabSchedules || 'Schedules' },
    { key: 'sophub', icon: '📦', title: t.tabSophub || 'Sophub' },
  ];

  return (
    <div className="right-panel">
      {/* Instance Header - Always visible */}
      <div className="rp-card rp-header">
        <h4>{inst.name}</h4>
        <div className="rp-row">
          <span>🤖 LLM</span>
          <span className="clickable" onClick={() => setShowLLMSelector(true)}>
            #{inst.llm_no} {llmConfigs.find(l => l.index === inst.llm_no)?.name || ''} ✏️
          </span>
        </div>
        <div className="rp-row">
          <span>📡 {t.imChannel}</span>
          <span className="clickable" onClick={() => setShowIMSelector(true)}>
            {inst.im_channel || t.notConfigured} ✏️
          </span>
        </div>
      </div>

      {/* VSCode-style Icon Bar */}
      <div className="rp-icon-bar">
        {sections.map(s => (
          <button
            key={s.key}
            className={`rp-icon-btn ${activeSection === s.key ? 'active' : ''}`}
            onClick={() => setActiveSection(s.key)}
            title={s.title}
          >
            {s.icon}
          </button>
        ))}
      </div>

      {/* Section Content - uses original card styles */}
      {activeSection === 'resources' && (<>
        <div className="rp-card">
          <h5 style={{ marginBottom: '10px' }}>💻 {t.systemResources}</h5>
          {resources.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>{t.loading}</p>
          ) : (
            resources.map((r, i) => (
              <div key={i} className="resource-row">
                <span className="resource-label">
                  {r.type === 'cpu' ? '🖥️ CPU' : r.type === 'memory' ? `🧠 ${t.memory}` : `💾 ${t.disk}`}
                </span>
                <div className="resource-bar">
                  <div
                    className={`resource-fill ${r.usage > 80 ? 'danger' : r.usage > 60 ? 'warn' : ''}`}
                    style={{ width: `${r.usage}%` }}
                  />
                </div>
                <span className="resource-pct" style={{ color: r.usage > 80 ? 'var(--red)' : 'var(--text-2)' }}>
                  {r.usage}%
                </span>
              </div>
            ))
          )}
          </div>

          {/* Local SOPs */}
          {localSops.length > 0 && (
            <div className="rp-card" style={{ marginTop: '8px' }}>
              <h5 style={{ marginBottom: '8px' }}>📂 SOP ({localSops.length})</h5>
              <div className="sop-list">
                {localSops.map(sop => (
                  <div key={sop.name} className="sop-item" onClick={() => sop.type !== 'dir' && viewSop(sop.name)}>
                    <span className="sop-item-icon">{sop.type === 'dir' ? '📁' : sop.name.endsWith('.py') ? '🐍' : '📄'}</span>
                    <span className="sop-item-name">{sop.name}</span>
                    {sop.size > 0 && <span className="sop-item-size">{(sop.size / 1024).toFixed(1)}K</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
      </>)}

      {activeSection === 'features' && (
        <div className="rp-card">
          <h5 style={{ marginBottom: '10px' }}>⚡ {t.featureToggles}</h5>
          {(['autonomous', 'goal', 'reflect', 'scheduler', 'team_worker'] as const).map(feat => {
            const featureConfig = featureConfigs[feat];
            const isActive = !!inst[feat];
            return (
              <div className={`feat-row ${isActive ? 'feat-active' : ''}`} key={feat}>
                <span className="feat-label">
                  <span className={`feat-icon ${isActive ? 'feat-icon-pulse' : ''}`} style={isActive ? { color: featureConfig.color } : {}}>
                    {isActive ? featureConfig.activeIcon : featureConfig.icon}
                  </span>
                  {featureConfig.label}
                </span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={isActive} onChange={() => toggleFeature(inst.id, feat)} />
                  <span className="toggle-slider" style={isActive ? { background: `linear-gradient(135deg, ${featureConfig.color}, ${featureConfig.color}88)` } : {}} />
                </label>
              </div>
            );
          })}

          {/* Goal & Peer Hint */}
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-2)' }}>🎯 {t.goalMode || 'Goal'}</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <input className="rp-input" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder={t.goalPlaceholder || 'Set goal...'} />
                <button className="action-btn" onClick={() => { if (id) setStringConfig(id, 'goal', goalInput); }}>✓</button>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-2)' }}>👥 {t.peerHint || 'Peer Hint'}</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <input className="rp-input" value={peerHintInput} onChange={e => setPeerHintInput(e.target.value)} placeholder={t.peerHintPlaceholder || 'Set peer hint...'} />
                <button className="action-btn" onClick={() => { if (id) setStringConfig(id, 'peer_hint', peerHintInput); }}>✓</button>
              </div>
            </div>
          </div>

        </div>
      )}

      {activeSection === 'overview' && (
        <div className="rp-card rp-tab-content">
          <h5>{t.quickActions}</h5>
          <div className="action-grid">
            <button className="action-btn" onClick={() => id && exportChat(id)}>📤 {t.exportChat}</button>
            <button className="action-btn" onClick={() => setShowConfig(true)}>⚙️ {t.config}</button>
            <button className="action-btn" onClick={() => batchAction('restart', instances.filter(i => i.status === 'running').map(i => i.id))}>🔄 {t.restartAll}</button>
            <button className="action-btn" onClick={() => batchAction('stop', instances.filter(i => i.status === 'running').map(i => i.id))}>⏹️ {t.stopAll}</button>
          </div>

          {/* Send Command */}
          <h5 style={{ marginTop: '16px' }}>{t.sendCommand}</h5>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="rp-input" placeholder={t.commandPlaceholder} value={cmdInput} onChange={e => setCmdInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && cmdInput.trim() && id) { sendCommand(id, cmdInput); setCmdInput(''); } }} />
            <button className="action-btn" onClick={() => { if (cmdInput.trim() && id) { sendCommand(id, cmdInput); setCmdInput(''); } }}>{t.send}</button>
          </div>

          {/* Forward Message */}
          <h5 style={{ marginTop: '16px' }}>{t.forwardMessage}</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <select className="rp-input" value={fwdTarget} onChange={e => setFwdTarget(e.target.value)}>
              <option value="">{t.selectTargetInstance}</option>
              {instances.filter(i => i.id !== id).map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="rp-input" placeholder={t.forwardContent} value={fwdMsg} onChange={e => setFwdMsg(e.target.value)} />
              <button className="action-btn" onClick={() => { if (fwdTarget && fwdMsg.trim() && id) { forwardMessage(id, fwdTarget, fwdMsg); setFwdMsg(''); } }}>{t.forward}</button>
            </div>
          </div>

          {/* mykey.py Configuration Guide */}
          <h5 style={{ marginTop: '16px' }}>🔑 {t.llmKeyConfig}</h5>
          <div className="mykey-guide" style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' }}>
            <p style={{ margin: '0 0 8px' }}>{t.mykeyGuide} <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>mykey.py</code></p>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', overflowX: 'auto', whiteSpace: 'pre' }}>
{`# mykey.py
# Claude
claude47 = "sk-ant-xxx..."
claude47_apibase = "https://api.anthropic.com"

# OpenAI
gpt4 = "sk-xxx..."
gpt4_apibase = "https://api.openai.com/v1"

# Custom proxy
claude47_apibase = "https://your-proxy.com"
`}
            </div>
            <p style={{ margin: '8px 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>
              💡 {t.mykeyFormat}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
              📂 {t.mykeyLocation}: <code style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: '3px' }}>{configForm.ga_path || '<GA_PATH>'}/mykey.py</code>
            </p>
          </div>
        </div>
      )}

      {activeSection === 'schedules' && (
        <div className="rp-card rp-tab-content">
          <h5>{t.addSchedule}</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {CRON_PRESETS.map(p => (
                <button
                  key={p.value}
                  className={`cron-preset ${schedCron === p.value ? 'active' : ''}`}
                  onClick={() => setSchedCron(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              className="rp-input"
              placeholder={t.cronPlaceholder}
              value={schedCron}
              onChange={e => setSchedCron(e.target.value)}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}
            />
            <input className="rp-input" placeholder={t.taskPlaceholder} value={schedTask} onChange={e => setSchedTask(e.target.value)} />
            <button
              className="action-btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (schedCron && schedTask && id) {
                  addSchedule(id, schedCron, schedTask);
                  setSchedCron('');
                  setSchedTask('');
                } else {
                  showToast(t.fillCronAndTask);
                }
              }}
            >
              ➕ {t.addTask}
            </button>
          </div>

          <h5>{t.taskList}</h5>
          {schedules.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '13px', padding: '12px 0' }}>{t.noSchedules}</p>
          ) : (
            <div className="schedule-list">
              {schedules.map(s => (
                <div key={s.id} className="schedule-item">
                  <div className="schedule-info">
                    <span className="schedule-cron">{s.cron}</span>
                    <span className="schedule-action">{s.task}</span>
                    {s.next_run && <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{t.nextRun}: {s.next_run}</span>}
                  </div>
                  <button className="schedule-del" onClick={() => id && deleteSchedule(id, s.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === 'sophub' && (
        <div className="rp-card rp-tab-content">
          <h5>{t.sophubSearch}</h5>
          <div className="sophub-search">
            <input
              placeholder={t.sophubPlaceholder}
              value={sophubQ}
              onChange={e => setSophubQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && sophubQ.trim()) searchSophub(sophubQ); }}
            />
            <button onClick={() => sophubQ.trim() && searchSophub(sophubQ)} disabled={sophubLoading}>
              {sophubLoading ? '⏳' : '🔍'}
            </button>
          </div>
          {sophubResults.length > 0 && (
            <div className="sophub-results">
              {sophubResults.map(sop => (
                <div key={sop.id} className="sophub-item">
                  <div className="sophub-item-title">{sop.title}</div>
                  <div className="sophub-item-desc">{sop.description}</div>
                  <div className="sophub-item-footer">
                    <div className="sophub-tags">
                      {sop.tags?.map((tag: string) => <span key={tag} className="sophub-tag">{tag}</span>)}
                    </div>
                    <button className="sophub-dl-btn" onClick={() => downloadSop(sop.id, id || undefined)}>{t.download}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!sophubLoading && sophubResults.length === 0 && sophubQ && (
            <p className="sophub-empty">{t.noResults}</p>
          )}
          <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-3)' }}>
            {t.source}: <a href="https://fudankw.cn/sophub/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>fudankw.cn/sophub</a>
          </p>
        </div>
      )}

      {/* LLM Selector Modal */}
      {showLLMSelector && (
        <div className="modal-overlay" onClick={() => setShowLLMSelector(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h4>{t.selectLLMTitle}</h4>
            <div className="llm-grid">
              {llmConfigs.map(llm => (
                <button key={llm.index} className={`llm-option ${inst.llm_no === llm.index ? 'active' : ''}`}
                  onClick={() => { switchLLM(inst.id, llm.index); }}>
                  <span className="llm-idx">#{llm.index}</span>
                  <span className="llm-name">{llm.name}</span>
                  <span className="llm-type">{llm.type}</span>
                </button>
              ))}
            </div>
            <button className="modal-btn cancel" onClick={() => setShowLLMSelector(false)}>{t.close}</button>
          </div>
        </div>
      )}

      {/* IM Selector Modal */}
      {showIMSelector && (
        <div className="modal-overlay" onClick={() => setShowIMSelector(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h4>{t.selectIMTitle}</h4>
            <div className="im-grid">
              {imChannels.map(ch => (
                <button key={ch} className={`im-option ${inst.im_channel === ch ? 'active' : ''}`}
                  onClick={() => { setIMChannel(inst.id, ch); }}>
                  {ch === 'qq' ? '🐧' : ch === 'telegram' ? '✈️' : ch === 'discord' ? '🎮' : ch === 'dingtalk' ? '💬' : ch === 'feishu' ? '🐦' : ch === 'wechat' ? '💚' : '🏢'} {ch}
                </button>
              ))}
              <button className="im-option" onClick={() => { setIMChannel(inst.id, ''); }}>{t.clearIM}</button>
            </div>
            <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg3)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-2)' }}>
              {t.imEnableTip}
            </div>
            <button className="modal-btn cancel" style={{ marginTop: '12px' }} onClick={() => setShowIMSelector(false)}>{t.close}</button>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {/* SOP Viewer Modal */}
      {sopViewer && (
        <div className="modal-overlay" onClick={() => setSopViewer(null)}>
          <div className="sop-viewer-modal" onClick={e => e.stopPropagation()}>
            <div className="sop-viewer-header">
              <span className="sop-viewer-title">{sopViewer.name}</span>
              <button className="sop-viewer-close" onClick={() => setSopViewer(null)}>✕</button>
            </div>
            <pre className="sop-viewer-content">{sopLoading ? 'Loading...' : sopViewer.content}</pre>
          </div>
        </div>
      )}

      {showConfig && (
        <div className="modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h4>{t.systemConfig}</h4>
            <label className="config-label">{t.gaPath}</label>
            <input className="rp-input" value={configForm.ga_path} onChange={e => setConfigForm(f => ({ ...f, ga_path: e.target.value }))} placeholder="D:\GenericAgent" />
            <label className="config-label">{t.pythonPath}</label>
            <input className="rp-input" value={configForm.python_path} onChange={e => setConfigForm(f => ({ ...f, python_path: e.target.value }))} placeholder="python" />
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowConfig(false)}>{t.cancel}</button>
              <button className="modal-btn confirm" onClick={() => { showToast(t.configSaved); setShowConfig(false); }}>{t.save}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RightPanel;
