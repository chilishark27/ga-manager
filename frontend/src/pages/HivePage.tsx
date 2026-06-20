import { useEffect, useState } from 'react';
import { useHiveStore } from '../store/hive';
import { useI18n } from '../i18n';
import NewProjectDialog from '../components/hive/NewProjectDialog';

function HivePage() {
  const { lang } = useI18n();
  const { projects, poolStats, fetchProjects, fetchPoolStats, selectProject } = useHiveStore();
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchPoolStats();
    const t = setInterval(() => {
      fetchProjects();
      fetchPoolStats();
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const activeProjects = projects.filter(p => p.status === 'running' || p.status === 'paused');
  const completedProjects = projects.filter(p => p.status === 'completed' || p.status === 'failed');

  const progressPct = (p: { task_count: { done: number; total: number } }) =>
    p.task_count.total > 0 ? Math.round((p.task_count.done / p.task_count.total) * 100) : 0;

  const statusClass = (s: string) => {
    if (s === 'running') return 'status-running';
    if (s === 'completed') return 'status-completed';
    if (s === 'failed') return 'status-failed';
    if (s === 'paused') return 'status-paused';
    return '';
  };

  const workerDots = () => {
    if (!poolStats) return null;
    const dots = [];
    for (let i = 0; i < poolStats.max; i++) {
      dots.push(
        <div key={i} className={`hv2-worker-dot ${i < poolStats.busy ? 'busy' : 'idle'}`} />
      );
    }
    return dots;
  };

  const renderProjectCard = (p: typeof projects[0]) => {
    const pct = progressPct(p);
    const isRunning = p.status === 'running';
    return (
      <div
        key={p.id}
        className={`hv2-project-card ${statusClass(p.status)}`}
        onClick={() => selectProject(p.id)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f6fc', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name || p.objective.slice(0, 48)}
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.objective}
          </div>
        </div>
        <div className="hv2-progress">
          <div
            className={`hv2-progress-fill ${isRunning ? 'running' : 'completed'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="hv2-stat">{p.task_count.done}/{p.task_count.total}</span>
        <span className="hv2-stat">{p.elapsed_minutes || 0}m</span>
        <span className={`hv2-status ${p.status}`}>{p.status}</span>
      </div>
    );
  };

  return (
    <div className="hv2-page">
      {/* Header */}
      <div className="hv2-header">
        <div>
          <div className="hv2-title">HIVE</div>
          {poolStats && (
            <div className="hv2-subtitle">
              {lang === 'zh'
                ? `Workers: ${poolStats.busy}/${poolStats.max} 忙碌`
                : `Workers: ${poolStats.busy}/${poolStats.max} busy`}
            </div>
          )}
        </div>
        {poolStats && (
          <div className="hv2-workers">
            {workerDots()}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="hv2-btn primary" onClick={() => setShowNew(true)}>
          + {lang === 'zh' ? '新建' : 'New'}
        </button>
      </div>

      {/* Active projects */}
      {activeProjects.length > 0 && (
        <>
          <div className="hv2-section-label">
            {lang === 'zh' ? '进行中' : 'Active'} · {activeProjects.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeProjects.map(renderProjectCard)}
          </div>
        </>
      )}

      {/* Completed projects */}
      {completedProjects.length > 0 && (
        <>
          <div className="hv2-section-label">
            {lang === 'zh' ? '已完成' : 'Completed'} · {completedProjects.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {completedProjects.map(renderProjectCard)}
          </div>
        </>
      )}

      {projects.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#484f58' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
          <div style={{ fontSize: 14 }}>
            {lang === 'zh' ? '暂无项目，点击 New 开始' : 'No projects yet — click New to start'}
          </div>
        </div>
      )}

      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}

export default HivePage;
