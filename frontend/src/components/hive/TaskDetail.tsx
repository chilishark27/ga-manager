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
      <div className="hv2-detail" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#484f58', fontSize: 13 }}>Select a task to view details</div>
      </div>
    );
  }

  return (
    <div className="hv2-detail">
      <div className="hv2-detail-title">{task.title}</div>
      <div className="hv2-detail-meta">
        <span>Type: {task.type}</span>
        <span>Executor: {task.executor}</span>
        <span className={`hv2-status ${task.status}`}>{task.status}</span>
        {task.assigned_to && <span>Assigned: {task.assigned_to}</span>}
      </div>
      {task.error && (
        <div style={{ fontSize: 12, color: '#f85149', marginBottom: 8, padding: '8px 12px', background: 'rgba(248,81,73,0.08)', borderRadius: 6 }}>
          {task.error}
        </div>
      )}
      {task.outputs?.context_keys?.length > 0 && (
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>
          Context keys: {task.outputs.context_keys.join(', ')}
        </div>
      )}
      <div className="hv2-log-label">Execution log</div>
      <div className="hv2-log" style={{ flex: 1 }}>
        {log || '(no log yet)'}
      </div>
    </div>
  );
}
