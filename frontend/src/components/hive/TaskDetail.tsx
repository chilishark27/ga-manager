import { useState, useEffect } from 'react';
import ContextModal from './ContextModal';

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
  const [openContext, setOpenContext] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/hive2/projects/${encodeURIComponent(projectId)}/logs/${selectedId}`)
      .then(r => r.json())
      .then(d => setLog(d.log || ''))
      .catch(() => {});
    // reset outputs panel when switching tasks
    setOpenContext(null);
    setPreviewFile(null);
    setFileContent(null);
  }, [selectedId, projectId]);

  // Load file preview content when a file is selected
  useEffect(() => {
    if (!previewFile) { setFileContent(null); return; }
    fetch(`/api/hive2/projects/${encodeURIComponent(projectId)}/artifacts/preview?path=${encodeURIComponent(previewFile)}`)
      .then(r => r.text())
      .then(setFileContent)
      .catch(() => setFileContent('(failed to load)'));
  }, [previewFile, projectId]);

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

  const contextKeys: string[] = task.outputs?.context_keys || [];
  const files: string[] = task.outputs?.files || [];
  const hasOutputs = contextKeys.length > 0 || files.length > 0;

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

      {/* Outputs section */}
      {hasOutputs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            产出
          </div>
          {contextKeys.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contextKeys.map(key => (
                <button
                  key={key}
                  onClick={() => setOpenContext(key)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 10,
                    background: 'var(--bg3)', color: 'var(--accent)',
                    border: '1px solid var(--accent)', cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  📄 {key}
                </button>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {files.map(f => (
                <button
                  key={f}
                  onClick={() => setPreviewFile(previewFile === f ? null : f)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 10,
                    background: previewFile === f ? 'var(--accent)' : 'var(--bg3)',
                    color: previewFile === f ? '#fff' : 'var(--text-2)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  📎 {f}
                </button>
              ))}
            </div>
          )}
          {previewFile && fileContent !== null && (
            <div style={{
              background: 'var(--input-bg)', border: '1px solid var(--border)',
              borderRadius: 6, padding: 10, fontSize: 11,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: 'var(--text-2)', maxHeight: 200, overflowY: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {fileContent}
            </div>
          )}
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

      {openContext && (
        <ContextModal projectId={projectId} contextKey={openContext} onClose={() => setOpenContext(null)} />
      )}
    </div>
  );
}
