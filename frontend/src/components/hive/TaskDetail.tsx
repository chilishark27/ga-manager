import { useState, useEffect } from 'react';

export default function TaskDetail({
  tasks,
  projectId,
  selectedId,
}: {
  tasks: any[];
  projectId: string;
  selectedId: string | null;
}) {
  const [log, setLog] = useState('');

  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/hive2/projects/${encodeURIComponent(projectId)}/logs/${selectedId}`)
      .then(r => r.json())
      .then(d => setLog(d.log || ''))
      .catch(() => {});
  }, [selectedId, projectId]);

  const task = tasks.find(t => t.id === selectedId);

  if (!task) {
    return (
      <div className="page-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
          Select a task to view details
        </div>
      </div>
    );
  }

  return (
    <div className="page-card" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{task.title}</div>

      {/* Metadata row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
        {task.type && <span>Type: <strong style={{ color: 'var(--text-2)' }}>{task.type}</strong></span>}
        {task.executor && <span>Executor: <strong style={{ color: 'var(--text-2)' }}>{task.executor}</strong></span>}
        {task.assigned_to && <span>Assigned: <strong style={{ color: 'var(--text-2)' }}>{task.assigned_to}</strong></span>}
        <span className={`hive2-status ${task.status}`}>{task.status}</span>
      </div>

      {task.error && (
        <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'rgba(251,113,133,0.08)', borderRadius: 6, border: '1px solid rgba(251,113,133,0.2)' }}>
          {task.error}
        </div>
      )}

      {task.outputs?.context_keys?.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Context keys: {task.outputs.context_keys.join(', ')}
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Execution Log
      </div>
      <div style={{
        flex: 1,
        background: 'var(--input-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: 'var(--text-2)',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        minHeight: 100,
      }}>
        {log || '(no log yet)'}
      </div>
    </div>
  );
}
