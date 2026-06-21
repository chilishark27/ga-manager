import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useHiveStore } from '../../store/hive';

export default function ContextModal({
  projectId,
  contextKey,
  onClose,
}: {
  projectId: string;
  contextKey: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const { readContext } = useHiveStore();

  useEffect(() => {
    readContext(projectId, contextKey).then(setContent);
  }, [projectId, contextKey]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="page-card"
        style={{ maxWidth: 700, width: '90%', maxHeight: '80vh', overflow: 'auto', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: 14, color: 'var(--text-1)' }}>{contextKey}</h4>
          <button className="ch-btn" onClick={onClose}>✕</button>
        </div>
        {content === null ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading...</p>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)' }}>
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
