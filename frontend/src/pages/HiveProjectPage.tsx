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
      <div className="hv2-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#8b949e', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  const { project, tasks: rawTasks, context: rawContext, artifacts: rawArtifacts } = projectDetail;
  const tasks = rawTasks || [];
  const context = rawContext || [];
  const artifacts = rawArtifacts || [];

  const progressPct = project.task_count.total > 0
    ? Math.round((project.task_count.done / project.task_count.total) * 100)
    : 0;

  return (
    <div className="hv2-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="hv2-exec-header">
        <button className="hv2-btn" onClick={() => selectProject(null)}>
          ← {lang === 'zh' ? '返回' : 'Back'}
        </button>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#f0f6fc', flex: 1 }}>
          {project.name || project.objective.slice(0, 40)}
        </div>
        <span className={`hv2-status ${project.status}`}>{project.status}</span>
        <div className="hv2-progress" style={{ flex: '0 0 80px' }}>
          <div
            className={`hv2-progress-fill ${project.status === 'running' ? 'running' : 'completed'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="hv2-stat">{project.task_count.done}/{project.task_count.total}</span>
        <span className="hv2-stat">{project.elapsed_minutes}m</span>
        <button
          className="hv2-cc-badge"
          onClick={() => setShowMcpConfig(!showMcpConfig)}
        >
          ⚡ Claude Code
        </button>
      </div>

      {/* MCP Config card */}
      {showMcpConfig && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#f0f6fc', marginBottom: 8 }}>
            {lang === 'zh' ? '连接 Claude Code — 将以下配置添加到 MCP 设置中：' : 'Connect Claude Code — add to your MCP settings:'}
          </div>
          <pre className="hv2-log" style={{ minHeight: 'unset' }}>
{JSON.stringify({
  mcpServers: {
    "ga-hive": {
      command: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
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
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>
            {lang === 'zh'
              ? '可用 MCP tools：hive_task_list, hive_context_read, hive_task_claim 等'
              : 'Available MCP tools: hive_task_list, hive_context_read, hive_task_claim, etc.'}
          </div>
        </div>
      )}

      {/* 3-column grid */}
      <div className="hv2-exec-grid" style={{ flex: 1 }}>
        <TaskList tasks={tasks} selectedId={selectedTaskId} onSelect={setSelectedTaskId} />
        <TaskDetail tasks={tasks} projectId={project.id} selectedId={selectedTaskId} />
        <ArtifactPanel artifacts={artifacts} projectId={project.id} />
      </div>

      {/* Context bar */}
      <ContextBar context={context} />
    </div>
  );
}

export default HiveProjectPage;
