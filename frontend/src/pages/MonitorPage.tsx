import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

interface SysResources {
  cpu_percent: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
}

function MonitorPage() {
  const {
    activeInstanceId, activeInstance: getActiveInstance,
    fetchTokenStats, tokenStats,
    fetchCosts, costStats,
    fetchADBDevices, adbDevices, fetchScreenshots, screenshots,
  } = useStore();
  const { t, lang } = useI18n();
  const inst = getActiveInstance();
  const id = activeInstanceId;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sysRes, setSysRes] = useState<SysResources | null>(null);

  const fetchSysResources = async () => {
    try {
      const res = await fetch('/api/system/resources');
      if (res.ok) setSysRes(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchSysResources();
    if (id) {
      fetchTokenStats(id);
      fetchScreenshots(id);
      fetchADBDevices();
    }
    timer.current = setInterval(() => {
      fetchSysResources();
      if (id) { fetchTokenStats(id); fetchCosts(id); }
    }, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [id]);

  if (!inst) {
    return (
      <div className="monitor-page">
        <div className="page-container">
          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px' }}>
            {lang === 'zh' ? '请选择一个实例查看监控数据' : 'Select an instance to view monitoring data.'}
          </p>
        </div>
      </div>
    );
  }

  const cpuPct = sysRes ? Math.round(sysRes.cpu_percent) : 0;
  const memPct = sysRes ? Math.round(sysRes.mem_percent) : 0;
  const memUsed = sysRes ? (sysRes.mem_used_mb / 1024).toFixed(1) : '0';
  const memTotal = sysRes ? (sysRes.mem_total_mb / 1024).toFixed(1) : '0';

  return (
    <div className="monitor-page">
      <div className="page-container">
        <h2 className="page-header">{lang === 'zh' ? '监控' : 'Monitor'}</h2>

        {/* Cost Tracking */}
        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{lang === 'zh' ? '费用追踪' : 'Cost Tracking'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <div className="token-stat-item">
              <span className="token-stat-label">{lang === 'zh' ? '请求数' : 'Requests'}</span>
              <span className="token-stat-value">{costStats?.requests || 0}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">Input</span>
              <span className="token-stat-value">{tokenStats?.input_tokens ? `${(tokenStats.input_tokens / 1000).toFixed(1)}K` : '-'}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">Output</span>
              <span className="token-stat-value">{tokenStats?.output_tokens ? `${(tokenStats.output_tokens / 1000).toFixed(1)}K` : '-'}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">{lang === 'zh' ? '缓存命中' : 'Cache Hit'}</span>
              <span className="token-stat-value">{tokenStats?.cache_hit_rate ? `${tokenStats.cache_hit_rate.toFixed(1)}%` : '-'}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">Cache Read</span>
              <span className="token-stat-value">{tokenStats?.cache_read ? `${(tokenStats.cache_read / 1000).toFixed(1)}K` : '-'}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">Turns</span>
              <span className="token-stat-value">{tokenStats?.total_turns || 0}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">{lang === 'zh' ? '会话时长' : 'Duration'}</span>
              <span className="token-stat-value">{costStats?.elapsed_seconds ? `${Math.floor(costStats.elapsed_seconds / 60)}m` : '-'}</span>
            </div>
            <div className="token-stat-item">
              <span className="token-stat-label">{lang === 'zh' ? '总计' : 'Total'}</span>
              <span className="token-stat-value">{tokenStats ? `${(((tokenStats.input_tokens || 0) + (tokenStats.output_tokens || 0) + (tokenStats.cache_read || 0)) / 1000).toFixed(1)}K` : '-'}</span>
            </div>
          </div>
        </div>

        {/* System Resources */}
        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{lang === 'zh' ? '系统资源' : 'System Resources'}</div>
          <div className="resource-row">
            <span className="resource-label">CPU</span>
            <div className="resource-bar">
              <div className={`resource-fill ${cpuPct > 80 ? 'danger' : cpuPct > 60 ? 'warn' : ''}`} style={{ width: `${cpuPct}%` }} />
            </div>
            <span className="resource-pct" style={{ color: cpuPct > 80 ? 'var(--red)' : 'var(--text-2)' }}>{cpuPct}%</span>
          </div>
          <div className="resource-row">
            <span className="resource-label">{lang === 'zh' ? '内存' : 'Memory'}</span>
            <div className="resource-bar">
              <div className={`resource-fill ${memPct > 80 ? 'danger' : memPct > 60 ? 'warn' : ''}`} style={{ width: `${memPct}%` }} />
            </div>
            <span className="resource-pct" style={{ color: memPct > 80 ? 'var(--red)' : 'var(--text-2)' }}>{memUsed} / {memTotal} GB</span>
          </div>
        </div>

        {/* Health Status */}
        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{lang === 'zh' ? '实例状态' : 'Instance Status'}</div>
          <div className="health-info">
            <div className="health-row">
              <span>{lang === 'zh' ? '状态' : 'Status'}</span>
              <span className={`health-badge ${inst.status === 'running' ? 'ok' : 'off'}`}>{inst.status}</span>
            </div>
            <div className="health-row">
              <span>{lang === 'zh' ? '健康' : 'Health'}</span>
              <span className={`health-badge ${inst.health === 'healthy' ? 'ok' : 'warn'}`}>{inst.health}</span>
            </div>
            <div className="health-row">
              <span>PID</span>
              <span>{inst.pid || '-'}</span>
            </div>
            <div className="health-row">
              <span>{lang === 'zh' ? '运行时间' : 'Uptime'}</span>
              <span>{inst.uptime || '0'}s</span>
            </div>
            <div className="health-row">
              <span>{lang === 'zh' ? '模式' : 'Mode'}</span>
              <span>{inst.mode}</span>
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
                <div className="page-card-title">ADB ({adbDevices.length})</div>
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
