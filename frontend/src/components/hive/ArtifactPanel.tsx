import { useState } from 'react';
import FilePreview from './FilePreview';

export default function ArtifactPanel({
  artifacts, projectId,
}: {
  artifacts: any[]; projectId: string;
}) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  return (
    <div className="page-card" style={{ overflowY: 'auto', padding: '8px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8 }}>产出文件</div>
      {artifacts.length === 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-3)' }}>暂无产出</p>
      )}
      {artifacts.map((a, i) => (
        <div
          key={i}
          style={{
            padding: '6px 0', borderBottom: '1px solid var(--border)',
            cursor: 'pointer', fontSize: 12,
          }}
          onClick={() => setPreviewPath(a.file)}
        >
          📄 {a.file}
          <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8 }}>{a.action}</span>
        </div>
      ))}
      {previewPath && (
        <FilePreview
          projectId={projectId}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  );
}
