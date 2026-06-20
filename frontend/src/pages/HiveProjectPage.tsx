import { useEffect, useState } from 'react';
import { useHiveStore } from '../store/hive';
import { useI18n } from '../i18n';
import TaskList from '../components/hive/TaskList';
import TaskDetail from '../components/hive/TaskDetail';
import ArtifactPanel from '../components/hive/ArtifactPanel';
import ContextBar from '../components/hive/ContextBar';

function HiveProjectPage() {
  const { lang } = useI18n();
  const { selectedProjectId, projectDetail, fetchProjectDetail, selectProject } = useHiveStore();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showMcpConfig, setShowMcpConfig] = useState(false);

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

  const { project, tasks: rawTasks, context: rawContext, artifacts: rawArtifacts } = projectDetail;
  const tasks = rawTasks || [];
  const context = rawContext || [];
  const artifacts = rawArtifacts || [];

  return (
    <div className="hive-page">
      <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button className="ch-btn" onClick={() => selectProject(null)}>
            ← {lang === 'zh' ? '返回' : 'Back'}
          </button>
          <h3 style={{ margin: 0, flex: 1 }}>{project.name}</h3>
          <button className="ch-btn" onClick={() => setShowMcpConfig(!showMcpConfig)}
            style={{ fontSize: 11 }}>
            🔗 Claude Code
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {project.task_count.done}/{project.task_count.total} ✅ | {project.elapsed_minutes}min
          </span>
          <span className={`hive-status-badge hive-status-${project.status}`}>
            {project.status}
          </span>
        </div>

        {/* MCP Config panel */}
        {showMcpConfig && (
          <div className="page-card" style={{ marginBottom: 12, padding: '12px 16px', fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {lang === 'zh' ? '连接 Claude Code — 将以下配置添加到 Claude Code 的 MCP 设置中：' : 'Connect Claude Code — add this to your MCP settings:'}
            </div>
            <pre style={{ background: 'var(--bg-1)', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{JSON.stringify({
  mcpServers: {
    "ga-hive": {
      command: (window.location.origin.replace('http://', '').replace(':' + window.location.port, '') === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `ga_manager_mcp`
        : `curl -s ${window.location.origin}/api/hive2/mcp`,
      env: {
        HIVE_URL: window.location.origin,
        HIVE_PROJECT: project.id
      }
    }
  }
}, null, 2)}
            </pre>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              {lang === 'zh'
                ? '或在 Claude Code 中直接使用 MCP tools：hive_task_list, hive_context_read, hive_task_claim 等'
                : 'Or use MCP tools directly: hive_task_list, hive_context_read, hive_task_claim, etc.'}
            </div>
          </div>
        )}

        {/* 3-column layout */}
        <div
          style={{
            flex: 1, display: 'grid',
            gridTemplateColumns: '200px 1fr 240px',
            gap: 12, minHeight: 0,
          }}
        >
          <TaskList tasks={tasks} selectedId={selectedTaskId} onSelect={setSelectedTaskId} />
          <TaskDetail tasks={tasks} projectId={project.id} selectedId={selectedTaskId} />
          <ArtifactPanel artifacts={artifacts} projectId={project.id} />
        </div>

        {/* Context bar */}
        <ContextBar context={context} />
      </div>
    </div>
  );
}

export default HiveProjectPage;
