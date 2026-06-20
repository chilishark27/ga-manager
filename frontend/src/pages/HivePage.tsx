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

  const statusIcon = (s: string) =>
    s === 'running' ? '🔄' : s === 'completed' ? '✅' : s === 'paused' ? '⏸' : '❌';

  return (
    <div className="hive-page">
      <div className="page-container">
        <h2 className="page-header">
          {lang === 'zh' ? 'Hive 项目' : 'Hive Projects'}
          <button className="ch-btn" style={{ marginLeft: 12 }} onClick={() => setShowNew(true)}>
            {lang === 'zh' ? '+ 新建' : '+ New'}
          </button>
        </h2>

        {poolStats && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
            GA Workers: {poolStats.busy}/{poolStats.max} busy | Claude Code: {poolStats.idle} idle
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
              {lang === 'zh' ? '暂无项目，点击新建开始' : 'No projects yet'}
            </p>
          )}
          {projects.map(p => (
            <div
              key={p.id}
              className="page-card"
              style={{ cursor: 'pointer', padding: '12px 16px' }}
              onClick={() => selectProject(p.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{statusIcon(p.status)}</span>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {p.task_count.done}/{p.task_count.total} ✅
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {p.elapsed_minutes || 0}min
                </span>
                <span style={{ fontSize: 11, color: p.priority === 'high' ? 'var(--red)' : 'var(--text-3)' }}>
                  {p.priority}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                {p.objective}
              </div>
            </div>
          ))}
        </div>

        {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
      </div>
    </div>
  );
}

export default HivePage;
