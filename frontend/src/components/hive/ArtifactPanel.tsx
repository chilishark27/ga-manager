import { useState } from 'react';
import FilePreview from './FilePreview';

export default function ArtifactPanel({
  artifacts, projectId,
}: {
  artifacts: any[]; projectId: string;
}) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  return (
    <div className="hv2-artifacts">
      <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
        Artifacts · {artifacts.length}
      </div>
      {artifacts.length === 0 && (
        <div style={{ fontSize: 12, color: '#484f58', padding: '8px 0' }}>No artifacts yet</div>
      )}
      {artifacts.map((a, i) => (
        <div
          key={i}
          className="hv2-artifact-item"
          onClick={() => setPreviewPath(a.file)}
        >
          <span className="hv2-artifact-icon">📄</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.file}
          </span>
          <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{a.action}</span>
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
