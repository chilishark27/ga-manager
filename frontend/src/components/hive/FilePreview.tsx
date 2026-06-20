import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function FilePreview({
  projectId, path, onClose,
}: {
  projectId: string; path: string; onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      `/api/hive2/projects/${encodeURIComponent(projectId)}/artifacts/preview?path=${encodeURIComponent(path)}`
    )
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent('(load failed)'));
  }, [projectId, path]);

  const isMarkdown = path.endsWith('.md');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-0)', borderRadius: 12, padding: 20,
          maxWidth: '80vw', maxHeight: '80vh', overflow: 'auto', minWidth: 400,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{path}</span>
          <button className="ch-btn" onClick={onClose}>✕</button>
        </div>
        {content === null ? (
          <p>Loading...</p>
        ) : isMarkdown ? (
          <ReactMarkdown>{content}</ReactMarkdown>
        ) : (
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
