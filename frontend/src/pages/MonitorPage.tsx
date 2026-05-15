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
        <div className="page-container">
          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px' }}>
            Select an instance to view monitoring data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="monitor-page">
      <div className="page-container">
        <h2 className="page-header">Monitor</h2>

        {/* Top row: 4 token stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
          <div className="token-stat-item">
            <span className="token-stat-label">Input</span>
            <span className="token-stat-value">{tokenStats ? `${((tokenStats.input_tokens || 0) / 1000).toFixed(1)}K` : '-'}</span>
          </div>
          <div className="token-stat-item">
            <span className="token-stat-label">Output</span>
            <span className="token-stat-value">{tokenStats ? `${((tokenStats.output_tokens || 0) / 1000).toFixed(1)}K` : '-'}</span>
          </div>
          <div className="token-stat-item">
            <span className="token-stat-label">Cache Hit</span>
            <span className="token-stat-value">{tokenStats ? `${(tokenStats.cache_hit_rate || 0).toFixed(1)}%` : '-'}</span>
          </div>
          <div className="token-stat-item">
            <span className="token-stat-label">Turns</span>
            <span className="token-stat-value">{tokenStats ? (tokenStats.total_turns || 0) : '-'}</span>
          </div>
        </div>

        {/* Resource bars in a single card */}
        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">Resource Usage</div>
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

        {/* Two columns: Scheduled Tasks + Health Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          {/* Scheduled Tasks */}
          <div className="page-card">
            <div className="page-card-title">Scheduled Tasks</div>
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
                <input className="rp-input" placeholder="Cron" value={schedCron} onChange={e => setSchedCron(e.target.value)} style={{ fontFamily: 'monospace', flex: 1 }} />
                <input className="rp-input" placeholder="Task" value={schedTask} onChange={e => setSchedTask(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary btn-sm" onClick={() => {
                  if (schedCron && schedTask && id) {
                    addSchedule(id, schedCron, schedTask);
                    setSchedCron('');
                    setSchedTask('');
                  } else {
                    showToast('Fill cron and task');
                  }
                }}>+</button>
              </div>
            </div>
            {schedules.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: '13px', padding: '8px 0' }}>No scheduled tasks</p>
            ) : (
              <div className="schedule-list">
                {schedules.map(s => (
                  <div key={s.id} className="schedule-item">
                    <div className="schedule-info">
                      <span className="schedule-cron">{s.cron}</span>
                      <span className="schedule-action">{s.task}</span>
                    </div>
                    <button className="schedule-del" onClick={() => id && deleteSchedule(id, s.id)}>x</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Health Status */}
          <div className="page-card">
            <div className="page-card-title">Health Status</div>
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
        </div>

        {/* Vision screenshots + ADB devices */}
        {(screenshots.length > 0 || adbDevices.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: screenshots.length > 0 && adbDevices.length > 0 ? '1fr 1fr' : '1fr', gap: '16px' }}>
            {screenshots.length > 0 && (
              <div className="page-card">
                <div className="page-card-title">Vision ({screenshots.length})</div>
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

            {adbDevices.length > 0 && (
              <div className="page-card">
                <div className="page-card-title">ADB Devices ({adbDevices.length})</div>
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
        )}
      </div>
    </div>
  );
}

export default MonitorPage;
