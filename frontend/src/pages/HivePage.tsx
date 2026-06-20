import { useEffect, useState } from 'react';
import { useHiveStore } from '../store/hive';
import { useI18n } from '../i18n';
import NewProjectDialog from '../components/hive/NewProjectDialog';

function HivePage() {
  const { lang } = useI18n();
  const { projects, fetchProjects, selectProject } = useHiveStore();
  const [showNew, setShowNew] = useState(false);
  const isZh = lang === 'zh';

  useEffect(() => {
    fetchProjects();
    const t = setInterval(fetchProjects, 5000);
    return () => clearInterval(t);
  }, []);

  const active = projects.filter(p => p.status === 'running' || p.status === 'paused');
  const done = projects.filter(p => p.status === 'completed' || p.status === 'failed');

  return (
    <div className="hive-page">
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 className="page-header" style={{ margin: 0 }}>Hive v2</h2>
          <button className="setup-btn" onClick={() => setShowNew(true)} style={{ padding: '8px 20px', fontSize: 13 }}>
            + {isZh ? '新建项目' : 'New Project'}
          </button>
        </div>

        {projects.length === 0 && (
          <div className="page-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🐝</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
              {isZh ? '开始你的第一个 Hive 项目' : 'Start your first Hive project'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24, lineHeight: 1.8 }}>
              {isZh ? (
                <>1. 新建项目 — 输入目标，选择模板<br />2. 启动 GA Workers — 自动调研和设计<br />3. 连接 Claude Code — 通过 MCP 协议实现代码</>
              ) : (
                <>1. Create project — set objective, pick template<br />2. Start GA Workers — auto research &amp; design<br />3. Connect Claude Code — implement via MCP</>
              )}
            </div>
            <button className="setup-btn" onClick={() => setShowNew(true)}>
              {isZh ? '新建项目' : 'Create Project'}
            </button>
          </div>
        )}

        {active.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {isZh ? '进行中' : 'Active'} · {active.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {active.map(p => (
                <div
                  key={p.id}
                  className={`page-card hive2-project-card ${p.status}`}
                  style={{ cursor: 'pointer', padding: '14px 20px' }}
                  onClick={() => selectProject(p.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>
                        {p.name || p.objective.slice(0, 48)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.objective}
                      </div>
                    </div>
                    <div className="hive2-progress">
                      <div
                        className={`hive2-progress-bar ${p.task_count.done === p.task_count.total && p.task_count.total > 0 ? 'done' : ''}`}
                        style={{ width: `${p.task_count.total ? (p.task_count.done / p.task_count.total * 100) : 0}%` }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 40, textAlign: 'right' }}>
                      {p.task_count.done}/{p.task_count.total}
                    </span>
                    <span className={`hive2-status ${p.status}`}>{p.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {done.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {isZh ? '已完成' : 'Completed'} · {done.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {done.map(p => (
                <div
                  key={p.id}
                  className={`page-card hive2-project-card ${p.status}`}
                  style={{ cursor: 'pointer', padding: '14px 20px', opacity: 0.7 }}
                  onClick={() => selectProject(p.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>
                        {p.name || p.objective.slice(0, 48)}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {p.task_count.done}/{p.task_count.total}
                    </span>
                    <span className={`hive2-status ${p.status}`}>{p.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
      </div>
    </div>
  );
}

export default HivePage;
