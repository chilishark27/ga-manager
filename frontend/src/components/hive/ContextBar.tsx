import { useState } from 'react';
import ContextModal from './ContextModal';

export default function ContextBar({ context, projectId }: { context: any[]; projectId?: string }) {
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [openContext, setOpenContext] = useState<string | null>(null);

  const counts: Record<string, number> = {};
  context.forEach(c => {
    counts[c.type] = (counts[c.type] || 0) + 1;
  });

  const tags = [
    { key: 'finding', label: 'Findings' },
    { key: 'decision', label: 'Decisions' },
    { key: 'summary', label: 'Summaries' },
    { key: 'requirement', label: 'Requirements' },
  ];

  if (context.length === 0) return null;

  const allTypes = [
    ...tags.filter(t => counts[t.key]).map(t => ({ key: t.key, label: t.label })),
    ...Object.keys(counts).filter(k => !tags.find(t => t.key === k)).map(k => ({ key: k, label: k })),
  ];

  const entriesForType = (type: string) => context.filter(c => c.type === type);

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 12, padding: '10px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Context
        </span>
        {allTypes.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setExpandedType(expandedType === key ? null : key)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 10,
              background: expandedType === key ? 'var(--accent)' : 'var(--bg3)',
              color: expandedType === key ? '#fff' : 'var(--text-3)',
              border: `1px solid ${expandedType === key ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {label}
            <span style={{ color: expandedType === key ? '#fff' : 'var(--text-1)', fontWeight: 600, marginLeft: 4 }}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {expandedType && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingBottom: 10 }}>
          {entriesForType(expandedType).map(entry => (
            <button
              key={entry.key}
              onClick={() => projectId && setOpenContext(entry.key)}
              disabled={!projectId}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 6,
                background: 'var(--bg3)', color: 'var(--accent)',
                border: '1px solid var(--accent)', cursor: projectId ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
              title={entry.key}
            >
              📄 {entry.key}
            </button>
          ))}
        </div>
      )}

      {openContext && projectId && (
        <ContextModal projectId={projectId} contextKey={openContext} onClose={() => setOpenContext(null)} />
      )}
    </div>
  );
}
