import { useEffect, useRef, useState } from 'react';
import { useHiveStore } from '../store/hive';
import { useI18n } from '../i18n';
import TaskList from '../components/hive/TaskList';
import TaskDetail from '../components/hive/TaskDetail';
import ArtifactPanel from '../components/hive/ArtifactPanel';
import ContextBar from '../components/hive/ContextBar';

interface RunnerStatus {
  running: boolean;
  logs: string[];
}

function HiveProjectPage() {
  const { lang } = useI18n();
  const { selectedProjectId, projectDetail, fetchProjectDetail, selectProject, deleteProject } = useHiveStore();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>({ running: false, logs: [] });
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isZh = lang === 'zh';

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetail(selectedProjectId);
    }
    const t = setInterval(() => {
      if (selectedProjectId) fetchProjectDetail(selectedProjectId);
    }, 4000);
    return () => clearInterval(t);
  }, [selectedProjectId]);

  // Poll runner status every 3s
  useEffect(() => {
    if (!selectedProjectId) return;
    const poll = () => {
      fetch(`/api/hive2/projects/${encodeURIComponent(selectedProjectId)}/runner`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setRunnerStatus(data); })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [selectedProjectId]);

  // Auto-scroll logs to bottom when new entries arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runnerStatus.logs.length]);

  if (!projectDetail) {
    return (
      <div className="hive-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>
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

  const isRunning = project.status === 'running';
  const isPaused = project.status === 'paused';
  const isPending = project.status === 'pending';

  const handleStart = () => {
    fetch(`/api/hive2/projects/${encodeURIComponent(project.id)}/start`, { method: 'POST' })
      .then(() => fetchProjectDetail(project.id))
      .catch(() => {});
  };

  const handleStop = () => {
    fetch(`/api/hive2/projects/${encodeURIComponent(project.id)}/stop`, { method: 'POST' })
      .then(() => fetchProjectDetail(project.id))
      .catch(() => {});
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(project.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleDelete = () => {
    if (window.confirm(isZh ? `确定删除项目 "${project.name || project.objective.slice(0, 30)}"？此操作不可撤销。` : `Delete project "${project.name || project.objective.slice(0, 30)}"? This cannot be undone.`)) {
      deleteProject(project.id);
    }
  };

  return (
    <div className="hive-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="ch-btn" onClick={() => selectProject(null)}>
          ← {isZh ? '返回' : 'Back'}
        </button>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name || project.objective.slice(0, 40)}
        </div>
        <span className={`hive2-status ${project.status}`}>{project.status}</span>
        <div className="hive2-progress" style={{ flex: '0 0 80px' }}>
          <div
            className={`hive2-progress-bar ${progressPct === 100 ? 'done' : ''}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {project.task_count.done}/{project.task_count.total}
        </span>
        {(isPending || isPaused) && (
          <button className="setup-btn" onClick={handleStart} style={{ padding: '6px 16px', fontSize: 13 }}>
            ▶ {isZh ? '启动 Workers' : 'Start Workers'}
          </button>
        )}
        {isRunning && (
          <button className="ch-btn" onClick={handleStop}>
            ⏸ {isZh ? '暂停' : 'Pause'}
          </button>
        )}
        <button
          className="ch-btn"
          onClick={handleDelete}
          style={{ color: 'var(--red, #f87171)', borderColor: 'var(--red, #f87171)', opacity: 0.7 }}
          title={isZh ? '删除项目' : 'Delete project'}
        >
          🗑
        </button>
      </div>

      {/* Claude Code connection card — always visible */}
      <div className="hive2-cc-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>
            ⚡ {isZh ? '连接 Claude Code' : 'Connect Claude Code'}
          </div>
          <button
            className="ch-btn"
            onClick={handleCopyId}
            style={{ fontSize: 11 }}
          >
            {copied ? (isZh ? '已复制!' : 'Copied!') : (isZh ? '复制项目 ID' : 'Copy Project ID')}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
          {isZh ? '项目 ID:' : 'Project ID:'}{' '}
          <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, fontSize: 11, userSelect: 'all' }}>
            {project.id}
          </code>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {isZh ? '在 Claude Code 中运行:' : 'Run in Claude Code:'}{' '}
          <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
            claude mcp add ga-hive -- npx ga-hive-mcp
          </code>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          {isZh
            ? `设置环境变量: HIVE_URL=${window.location.origin}  HIVE_PROJECT=${project.id}`
            : `Set env: HIVE_URL=${window.location.origin}  HIVE_PROJECT=${project.id}`}
        </div>
      </div>

      {/* Worker status / logs card */}
      <div className="hive2-cc-card" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: runnerStatus.running ? '#22c55e' : 'var(--text-3)',
            boxShadow: runnerStatus.running ? '0 0 6px #22c55e' : 'none',
          }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>
            {isZh ? 'GA Worker 进程' : 'GA Workers'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>
            {runnerStatus.running
              ? (isZh ? '运行中' : 'Running')
              : (isZh ? '未启动' : 'Not started')}
          </span>
          {(isPending || isPaused) && !runnerStatus.running && (
            <button className="setup-btn" onClick={handleStart} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12 }}>
              ▶ {isZh ? '启动 Workers' : 'Start Workers'}
            </button>
          )}
        </div>
        {runnerStatus.logs.length > 0 && (
          <div style={{
            background: 'var(--bg3)',
            borderRadius: 6,
            padding: '8px 10px',
            maxHeight: 160,
            overflowY: 'auto',
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--text-2)',
            lineHeight: 1.6,
          }}>
            {runnerStatus.logs.map((line, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* 3-column grid */}
      <div className="hive2-exec-grid" style={{ flex: 1 }}>
        <TaskList tasks={tasks} selectedId={selectedTaskId} onSelect={setSelectedTaskId} />
        <TaskDetail tasks={tasks} projectId={project.id} selectedId={selectedTaskId} />
        <ArtifactPanel artifacts={artifacts} projectId={project.id} />
      </div>

      {/* Context bar */}
      <ContextBar context={context} projectId={project.id} />
    </div>
  );
}

export default HiveProjectPage;

