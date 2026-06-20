import { useState } from 'react';
import FilePreview from './FilePreview';

const EXT_ICONS: Record<string, string> = {
  py: '🐍', ts: '📘', tsx: '📘', js: '📜', jsx: '📜',
  md: '📝', json: '📋', go: '🔷', yaml: '📄', yml: '📄',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', svg: '🖼️',
};

function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXT_ICONS[ext] || '📄';
}

export default function ArtifactPanel({
  artifacts, projectId,
}: {
  artifacts: any[]; projectId: string;
}) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  return (
    <div className="page-card" style={{ padding: '12px 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 14px 8px' }}>
        Artifacts · {artifacts.length}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {artifacts.length === 0 && (
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-3)' }}>
            No artifacts yet
          </div>
        )}
        {artifacts.map((a, i) => (
          <div
            key={i}
            onClick={() => setPreviewPath(a.file)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-1)',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--sidebar-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 14 }}>{fileIcon(a.file)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.file}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{a.action}</span>
          </div>
        ))}
      </div>
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
