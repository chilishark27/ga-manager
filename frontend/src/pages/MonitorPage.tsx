import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function MonitorPage() {
  const {
    activeInstanceId, activeInstance: getActiveInstance,
    fetchResources, resources, fetchTokenStats, tokenStats,
    fetchSchedules, schedules, addSchedule, deleteSchedule,
    fetchADBDevices, adbDevices, fetchScreenshots, screenshots,
    showToast,
  } = useStore();
  const { t } = useI18n();
  const inst = getActiveInstance();
  const id = activeInstanceId;
  const resourceTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [schedCron, setSchedCron] = useState('');
  const [schedTask, setSchedTask] = useState('');

  const CRON_PRESETS = [
    { label: '5m', value: '*/5 * * * *' },
    { label: '30m', value: '*/30 * * * *' },
    { label: '1h', value: '0 * * * *' },
    { label: '9am', value: '0 9 * * *' },
    { label: '6pm', value: '0 18 * * *' },
    { label: 'Weekday 9', value: '0 9 * * 1-5' },
  ];

  useEffect(() => {
    if (!id) return;
    fetchResources(id);
    fetchTokenStats(id);
    fetchScreenshots(id);
    fetchADBDevices();
    fetchSchedules(id);
    resourceTimer.current = setInterval(() => {
      fetchResources(id);
      fetchTokenStats(id);
    }, 10000);
    return () => { if (resourceTimer.current) clearInterval(resourceTimer.current); };
  }, [id]);

  if (!inst) {
    return (
      <div className="monitor-page">
        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px' }}>
          Select an instance to view monitoring data.
        </p>
      </div>
    );
  }

  return (
    <div className="monitor-page">
      <div className="monitor-grid">
        {/* Token Stats Card */}
        <div className="monitor-card">
          <h5>Token Stats</h5>
          {tokenStats ? (
            <>
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
            </>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>Loading...</p>
          )}
        </div>

        {/* Resource Usage Card */}
        <div className="monitor-card">
          <h5>Resource Usage</h5>
          {resources.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>{t.loading}</p>
          ) : (
            resources.map((r, i) => (
              <div key={i} className="resource-row">
                <span className="resource-label">
                  {r.type === 'cpu' ? 'CPU' : r.type === 'memory' ? 'MEM' : 'DISK'}
                </span>
                <div className="resource-bar">
                  <div
                    className={`resource-fill ${r.usage > 80 ? 'danger' : r.usage > 60 ? 'warn' : ''}`}
                    style={{ width: `${r.usage}%` }}
                  />
                </div>
                <span className="resource-pct" style={{ color: r.usage > 80 ? 'var(--red)' : 'var(--text-2)' }}>
                  {r.detail}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Scheduled Tasks Card */}
        <div className="monitor-card monitor-card-wide">
          <h5>Scheduled Tasks</h5>
          <div className="schedule-add-form">
            <div className="cron-presets-row">
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
            <div className="schedule-input-row">
              <input className="rp-input" placeholder="Cron expression" value={schedCron} onChange={e => setSchedCron(e.target.value)} style={{ fontFamily: 'monospace' }} />
              <input className="rp-input" placeholder="Task description" value={schedTask} onChange={e => setSchedTask(e.target.value)} />
              <button className="action-btn" onClick={() => {
                if (schedCron && schedTask && id) {
                  addSchedule(id, schedCron, schedTask);
                  setSchedCron('');
                  setSchedTask('');
                } else {
                  showToast('Fill cron and task');
                }
              }}>+ Add</button>
            </div>
          </div>
          {schedules.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '13px', padding: '12px 0' }}>No scheduled tasks</p>
          ) : (
            <div className="schedule-list">
              {schedules.map(s => (
                <div key={s.id} className="schedule-item">
                  <div className="schedule-info">
                    <span className="schedule-cron">{s.cron}</span>
                    <span className="schedule-action">{s.task}</span>
                    {s.next_run && <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Next: {s.next_run}</span>}
                  </div>
                  <button className="schedule-del" onClick={() => id && deleteSchedule(id, s.id)}>x</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Health Status Card */}
        <div className="monitor-card">
          <h5>Health Status</h5>
          <div className="health-info">
            <div className="health-row">
              <span>Status</span>
              <span className={`health-badge ${inst.status === 'running' ? 'ok' : 'off'}`}>{inst.status}</span>
            </div>
            <div className="health-row">
              <span>Health</span>
              <span className={`health-badge ${inst.health === 'healthy' ? 'ok' : 'warn'}`}>{inst.health}</span>
            </div>
            <div className="health-row">
              <span>PID</span>
              <span>{inst.pid || '-'}</span>
            </div>
            <div className="health-row">
              <span>Uptime</span>
              <span>{inst.uptime || '0'}s</span>
            </div>
            <div className="health-row">
              <span>Mode</span>
              <span>{inst.mode}</span>
            </div>
          </div>
        </div>

        {/* Vision Screenshots Card */}
        {screenshots.length > 0 && (
          <div className="monitor-card">
            <h5>Vision ({screenshots.length})</h5>
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

        {/* ADB Devices Card */}
        {adbDevices.length > 0 && (
          <div className="monitor-card">
            <h5>ADB Devices ({adbDevices.length})</h5>
            {adbDevices.map((dev: any) => (
              <div key={dev.serial} className="adb-device-item">
                <span className={`adb-status ${dev.state === 'device' ? 'online' : ''}`} />
                <span className="adb-name">{dev.model || dev.serial}</span>
                <span className="adb-serial">{dev.serial}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MonitorPage;
