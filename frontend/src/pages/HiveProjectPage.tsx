import { useEffect } from 'react';
import { useHiveStore } from '../store/hive';
import { useI18n } from '../i18n';
import TaskList from '../components/hive/TaskList';
import TaskDetail from '../components/hive/TaskDetail';
import ArtifactPanel from '../components/hive/ArtifactPanel';
import ContextBar from '../components/hive/ContextBar';

function HiveProjectPage() {
  const { lang } = useI18n();
  const { selectedProjectId, projectDetail, fetchProjectDetail, selectProject } = useHiveStore();

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetail(selectedProjectId);
    }
    const t = setInterval(() => {
      if (selectedProjectId) fetchProjectDetail(selectedProjectId);
    }, 4000);
    return () => clearInterval(t);
  }, [selectedProjectId]);

  if (!projectDetail) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        Loading...
      </div>
    );
  }

  const { project, tasks, context, artifacts } = projectDetail;

  return (
    <div className="hive-page">
      <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button className="ch-btn" onClick={() => selectProject(null)}>
            ← {lang === 'zh' ? '返回' : 'Back'}
          </button>
          <h3 style={{ margin: 0, flex: 1 }}>{project.name}</h3>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {project.task_count.done}/{project.task_count.total} ✅ | {project.elapsed_minutes}min
          </span>
          <span className={`hive-status-badge hive-status-${project.status}`}>
            {project.status}
          </span>
        </div>

        {/* 3-column layout */}
        <div
          style={{
            flex: 1, display: 'grid',
            gridTemplateColumns: '200px 1fr 240px',
            gap: 12, minHeight: 0,
          }}
        >
          <TaskList tasks={tasks} />
          <TaskDetail tasks={tasks} projectId={project.id} />
          <ArtifactPanel artifacts={artifacts} projectId={project.id} />
        </div>

        {/* Context bar */}
        <ContextBar context={context} />
      </div>
    </div>
  );
}

export default HiveProjectPage;
