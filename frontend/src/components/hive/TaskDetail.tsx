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
      <div className="page-card" style={{ padding: 20, color: 'var(--text-3)' }}>
        选择一个任务查看详情
      </div>
    );
  }

  return (
    <div className="page-card" style={{ overflowY: 'auto', padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{task.title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 16, marginBottom: 12 }}>
        <span>类型: {task.type}</span>
        <span>执行者: {task.executor}</span>
        <span>状态: {task.status}</span>
        {task.assigned_to && <span>分配: {task.assigned_to}</span>}
      </div>
      {task.error && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>错误: {task.error}</div>
      )}
      {task.outputs?.context_keys?.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
          产出 Context: {task.outputs.context_keys.join(', ')}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginTop: 12, marginBottom: 6 }}>执行日志</div>
      <pre style={{
        fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto',
        background: 'var(--bg-1)', padding: 10, borderRadius: 6,
      }}>
        {log || '(暂无日志)'}
      </pre>
    </div>
  );
}
