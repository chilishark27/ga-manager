import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import SkillTree from './SkillTree';

type Section = 'resources' | 'features' | 'overview' | 'schedules' | 'sophub' | 'skilltree';

function RightPanel() {
  const {
    activeInstance, instances, activeInstanceId,
    toggleFeature, setStringConfig, fetchResources, resources,
    fetchSchedules, schedules, addSchedule, deleteSchedule,
    searchSophub, sophubResults, sophubLoading, downloadSop,
    exportChat, sendCommand, forwardMessage, batchAction,
    llmConfigs, switchLLM, showLLMSelector, setShowLLMSelector,
    showIMSelector, setShowIMSelector, setIMChannel,
    showToast, fetchTokenStats, tokenStats,
    fetchADBDevices, adbDevices, fetchScreenshots, screenshots,
    saveSop, createSop, deleteSop,
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
  const [sopEditing, setSopEditing] = useState(false);
  const [sopEditContent, setSopEditContent] = useState('');
  const [showNewSop, setShowNewSop] = useState(false);
  const [newSopName, setNewSopName] = useState('');
  const [newSopContent, setNewSopContent] = useState('');
  const [sopCollapsed, setSopCollapsed] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [dirContents, setDirContents] = useState<Record<string, {name:string,type:string,size:number}[]>>({});

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
    autonomous: { icon: 'A', activeIcon: 'A', label: t.autonomous || 'Autonomous', color: '#f59e0b' },
    peer_hint: { icon: 'P', activeIcon: 'P', label: t.peerHint || 'Peer Hint', color: '#6366f1' },
    reflect: { icon: 'R', activeIcon: 'R', label: t.reflect || 'Reflect', color: '#06b6d4' },
    verbose: { icon: 'V', activeIcon: 'V', label: t.verbose || 'Verbose', color: '#78716c' },
    scheduler: { icon: 'S', activeIcon: 'S', label: t.scheduler || 'Scheduler', color: '#10b981' },
    team_worker: { icon: 'T', activeIcon: 'T', label: t.teamWorker || 'Team Worker', color: '#ec4899' },
  };

  // Auto-fetch resources every 10s when instance is active
  useEffect(() => {
    if (!id) return;
    fetchResources(id);
    fetchTokenStats(id);
    fetchScreenshots(id);
    fetchADBDevices();
    resourceTimer.current = setInterval(() => { fetchResources(id); fetchTokenStats(id); }, 10000);
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
      const r = await fetch(`/api/sops/local/${name}`);
      const d = await r.json();
      setSopViewer({ name: d.name, content: d.content || JSON.stringify(d.files, null, 2), type: d.type });
    } catch { setSopViewer({ name, content: 'Failed to load', type: 'error' }); }
    setSopLoading(false);
  };

  const toggleDir = async (dirName: string) => {
    if (expandedDirs[dirName]) {
      setExpandedDirs(prev => ({ ...prev, [dirName]: false }));
      return;
    }
    try {
      const r = await fetch(`/api/sops/local/${dirName}`);
      const d = await r.json();
      if (d.files) {
        const items = (d.files as string[]).map(f => ({
          name: f,
          type: f.endsWith('/') ? 'dir' : f.split('.').pop() || 'file',
          size: 0
        }));
        setDirContents(prev => ({ ...prev, [dirName]: items }));
      }
    } catch { /* ignore */ }
    setExpandedDirs(prev => ({ ...prev, [dirName]: true }));
  };

  const [goalInput, setGoalInput] = useState('');
  const [peerHintInput, setPeerHintInput] = useState('');

  // Right panel resize
  const [panelWidth, setPanelWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const handleResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(240, Math.min(500, startWidth - (ev.clientX - startX)));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

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
    { key: 'resources', icon: 'Sys', title: t.systemResources || 'Resources' },
    { key: 'features', icon: 'Feat', title: t.featureToggles || 'Features' },
    { key: 'skilltree', icon: 'Tree', title: 'Skill Tree' },
    { key: 'overview', icon: 'Info', title: t.tabOverview || 'Overview' },
    { key: 'schedules', icon: 'Sche', title: t.tabSchedules || 'Schedules' },
    { key: 'sophub', icon: 'Hub', title: t.tabSophub || 'Sophub' },
  ];

  return (
    <div className="right-panel" style={{ width: panelWidth, minWidth: panelWidth }}>
      <div className={`rp-resize-handle ${isResizing ? 'dragging' : ''}`} onMouseDown={handleResizeDown} />
      {/* Instance Header - Always visible */}
      <div className="rp-card rp-header">
        <h4>{inst.name}</h4>
        <div className="rp-row">
          <span>LLM</span>
          <span className="clickable" onClick={() => setShowLLMSelector(true)}>
            #{inst.llm_no} {llmConfigs.find(l => l.index === inst.llm_no)?.name || ''} ›
          </span>
        </div>
        <div className="rp-row">
          <span>IM {t.imChannel}</span>
          <span className="clickable" onClick={() => setShowIMSelector(true)}>
            {inst.im_channel || t.notConfigured} ›
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

      {/* Quick Actions - Always visible */}
      <div className="rp-card" style={{ padding: '10px 12px' }}>
        <h5 style={{ marginBottom: '6px' }}>{t.quickActions}</h5>
        <div className="action-grid">
          <button className="action-btn" onClick={() => id && exportChat(id)}>Export {t.exportChat}</button>
          <button className="action-btn" onClick={() => setShowConfig(true)}>Config {t.config}</button>
          <button className="action-btn" onClick={() => batchAction('restart', instances.filter(i => i.status === 'running').map(i => i.id))}>Restart {t.restartAll}</button>
          <button className="action-btn" onClick={() => batchAction('stop', instances.filter(i => i.status === 'running').map(i => i.id))}>Stop {t.stopAll}</button>
        </div>
        <h5 style={{ marginTop: '10px', marginBottom: '6px' }}>{t.sendCommand}</h5>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input className="rp-input" placeholder={t.commandPlaceholder} value={cmdInput} onChange={e => setCmdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && cmdInput.trim() && id) { sendCommand(id, cmdInput); setCmdInput(''); } }} />
          <button className="action-btn" onClick={() => { if (cmdInput.trim() && id) { sendCommand(id, cmdInput); setCmdInput(''); } }}>{t.send}</button>
        </div>
      </div>

      {/* Section Content - uses original card styles */}
      {activeSection === 'resources' && (<>
        <div className="rp-card">
          <h5 style={{ marginBottom: '10px' }}>Sys {t.systemResources}</h5>
          {resources.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>{t.loading}</p>
          ) : (
            resources.map((r, i) => (
              <div key={i} className="resource-row">
                <span className="resource-label">
                  {r.type === 'cpu' ? 'CPU' : r.type === 'memory' ? `MEM ${t.memory}` : `DISK ${t.disk}`}
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
              <div className="sop-section-header" onClick={() => setSopCollapsed(!sopCollapsed)}>
                <h5>SOP ({localSops.length})</h5>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button className="action-btn" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); setShowNewSop(true); }}>+ New</button>
                  <span className={`sop-fold-icon ${!sopCollapsed ? 'expanded' : ''}`}>▶</span>
                </div>
              </div>
              <div className={`sop-list-collapsible ${!sopCollapsed ? 'expanded' : ''}`}>
                <div className="sop-list">
                {localSops.map(sop => (
                  <div key={sop.name}>
                    <div className="sop-item" onClick={() => sop.type === 'dir' ? toggleDir(sop.name) : viewSop(sop.name)}>
                      <span className="sop-item-icon">{sop.type === 'dir' ? (expandedDirs[sop.name] ? '▾' : '▸') : sop.name.endsWith('.py') ? 'py' : 'md'}</span>
                      <span className="sop-item-name">{sop.name}</span>
                      {sop.type === 'dir' && <span className="sop-item-size" style={{fontSize:'10px'}}>{expandedDirs[sop.name] ? '▼' : '▶'}</span>}
                      {sop.size > 0 && <span className="sop-item-size">{(sop.size / 1024).toFixed(1)}K</span>}
                    </div>
                    {sop.type === 'dir' && expandedDirs[sop.name] && dirContents[sop.name] && (
                      <div style={{ paddingLeft: '16px' }}>
                        {dirContents[sop.name].map(child => (
                          <div key={child.name} className="sop-item" onClick={() => viewSop(`${sop.name}/${child.name}`)}>
                            <span className="sop-item-icon">{child.name.endsWith('.py') ? 'py' : 'md'}</span>
                            <span className="sop-item-name">{child.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              </div>
            </div>
          )}

          {/* Token Statistics */}
          {tokenStats && (
            <div className="rp-card" style={{ marginTop: '8px' }}>
              <h5 style={{ marginBottom: '8px' }}>Tokens Stats</h5>
              <div className="token-stats-grid">
                <div className="token-stat-item">
                  <span className="token-stat-label">Input</span>
                  <span className="token-stat-value">{((tokenStats.input_tokens || 0) / 1000).toFixed(1)}K</span>
                </div>
                <div className="token-stat-item">
                  <span className="token-stat-label">Output</span>
                  <span className="token-stat-value">{((tokenStats.output_tokens || 0) / 1000).toFixed(1)}K</span>
                </div>
                <div className="token-stat-item">
                  <span className="token-stat-label">Cache Hit</span>
                  <span className="token-stat-value">{(tokenStats.cache_hit_rate || 0).toFixed(1)}%</span>
                </div>
                <div className="token-stat-item">
                  <span className="token-stat-label">Turns</span>
                  <span className="token-stat-value">{tokenStats.total_turns || 0}</span>
                </div>
              </div>
              {tokenStats.history && tokenStats.history.length > 0 && (
                <div className="token-history-bar">
                  {tokenStats.history.slice(-20).map((h: any, i: number) => (
                    <div key={i} className="token-bar-item" style={{ height: `${Math.min(100, Math.max(4, (h.input_tokens + h.output_tokens) / 100))}%` }} title={`${h.input_tokens + h.output_tokens} tokens`} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div className="rp-card vision-card" style={{ marginTop: '8px' }}>
              <div className="vision-header">
                <h5>Vision</h5>
                <span className="vision-badge">{screenshots.length}</span>
              </div>
              <p className="vision-desc">Agent 的屏幕视觉 — 查看它在操作时看到的画面</p>
              <div className="screenshot-grid">
                {screenshots.slice(0, 6).map((s: any) => (
                  <div key={s.name} className="screenshot-thumb" onClick={() => window.open(`/api/instances/${id}/screenshots/${s.name}`, '_blank')}>
                    <img src={`/api/instances/${id}/screenshots/${s.name}`} alt={s.name} loading="lazy" />
                    <span>{s.name.slice(0, 12)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ADB Devices */}
          {adbDevices.length > 0 && (
            <div className="rp-card adb-card" style={{ marginTop: '8px' }}>
              <div className="vision-header">
                <h5>ADB Devices</h5>
                <span className="vision-badge adb">{adbDevices.length}</span>
              </div>
              {adbDevices.map((dev: any) => (
                <div key={dev.serial} className="adb-device-item">
                  <span className={`adb-status ${dev.state === 'device' ? 'online' : ''}`} />
                  <span className="adb-name">{dev.model || dev.serial}</span>
                  <span className="adb-serial">{dev.serial}</span>
                </div>
              ))}
            </div>
          )}
      </>)}

      {activeSection === 'features' && (
        <div className="rp-card">
          <h5 style={{ marginBottom: '10px' }}>Feat {t.featureToggles}</h5>
          {(['autonomous', 'peer_hint', 'reflect', 'verbose', 'scheduler', 'team_worker'] as const).map(feat => {
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

          {/* Goal */}
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-2)' }}>Goal {t.goalMode || 'Goal'}</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <input className="rp-input" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder={t.goalPlaceholder || 'Set goal...'} />
                <button className="action-btn" onClick={() => { if (id) setStringConfig(id, 'goal', goalInput); }}>✓</button>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
                {t.goalDesc || '设定当前任务目标，agent会在sys_prompt中看到'}
              </p>
            </div>
          </div>

          {/* GA Supported Commands Reference */}
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600 }}>Cmd {t.gaCommands || 'GA Commands'}</label>
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-2)', lineHeight: '1.8' }}>
              <div><code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: '3px' }}>/session.key=val</code> — 设置LLM参数 (model/temperature/...)</div>
              <div><code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: '3px' }}>/resume</code> — 恢复上次会话</div>
              <div><code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: '3px' }}>switch_llm</code> — 切换LLM (通过面板按钮)</div>
              <div><code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: '3px' }}>abort</code> — 中断当前任务</div>
              <div><code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: '3px' }}>ping</code> — 心跳检测</div>
            </div>
          </div>

        </div>
      )}

      {activeSection === 'overview' && (
        <div className="rp-card rp-tab-content">
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
          <h5 style={{ marginTop: '16px' }}>Keys {t.llmKeyConfig}</h5>
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
              Tip {t.mykeyFormat}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
              {t.mykeyLocation}: <code style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: '3px' }}>{configForm.ga_path || '<GA_PATH>'}/mykey.py</code>
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
              + {t.addTask}
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

      {activeSection === 'skilltree' && (
        <div className="rp-card rp-tab-content" style={{ padding: '8px' }}>
          <SkillTree onNodeClick={(nodeId) => viewSop(nodeId)} highlightNode={null} />
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
              {sophubLoading ? '...' : 'Go'}
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
                  {ch === 'qq' ? 'QQ' : ch === 'telegram' ? 'TG' : ch === 'discord' ? 'DC' : ch === 'dingtalk' ? 'DT' : ch === 'feishu' ? 'FS' : ch === 'wechat' ? 'WX' : 'WC'} {ch}
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

      {/* SOP Viewer/Editor Modal */}
      {sopViewer && (
        <div className="modal-overlay" onClick={() => { setSopViewer(null); setSopEditing(false); }}>
          <div className="sop-viewer-modal" onClick={e => e.stopPropagation()}>
            <div className="sop-viewer-header">
              <span className="sop-viewer-title">{sopViewer.name}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {!sopEditing && (
                  <button className="action-btn" style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => { setSopEditing(true); setSopEditContent(sopViewer.content); }}>Edit</button>
                )}
                {sopEditing && (
                  <button className="action-btn" style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--green)' }}
                    onClick={async () => {
                      const ok = await saveSop(sopViewer.name, sopEditContent);
                      if (ok) { setSopViewer({ ...sopViewer, content: sopEditContent }); setSopEditing(false); }
                    }}>Save</button>
                )}
                <button className="action-btn" style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--red)' }}
                  onClick={async () => {
                    if (confirm(`Delete ${sopViewer.name}?`)) {
                      const ok = await deleteSop(sopViewer.name);
                      if (ok) { setSopViewer(null); setLocalSops(prev => prev.filter(s => s.name !== sopViewer.name)); }
                    }
                  }}>Del</button>
                <button className="sop-viewer-close" onClick={() => { setSopViewer(null); setSopEditing(false); }}>✕</button>
              </div>
            </div>
            {sopEditing ? (
              <textarea className="sop-editor-textarea" value={sopEditContent} onChange={e => setSopEditContent(e.target.value)} />
            ) : (
              <pre className="sop-viewer-content">{sopLoading ? 'Loading...' : sopViewer.content}</pre>
            )}
          </div>
        </div>
      )}

      {/* New SOP Modal */}
      {showNewSop && (
        <div className="modal-overlay" onClick={() => setShowNewSop(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h4>Create New SOP</h4>
            <input className="rp-input" placeholder="filename.md" value={newSopName} onChange={e => setNewSopName(e.target.value)} style={{ marginBottom: '8px' }} />
            <textarea className="sop-editor-textarea" placeholder="SOP content..." value={newSopContent} onChange={e => setNewSopContent(e.target.value)} style={{ height: '200px' }} />
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowNewSop(false)}>Cancel</button>
              <button className="modal-btn confirm" onClick={async () => {
                if (!newSopName.trim()) return;
                const ok = await createSop(newSopName, newSopContent);
                if (ok) {
                  setShowNewSop(false);
                  setLocalSops(prev => [...prev, { name: newSopName, type: newSopName.endsWith('.py') ? 'py' : 'md', size: newSopContent.length }]);
                  setNewSopName(''); setNewSopContent('');
                }
              }}>Create</button>
            </div>
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
