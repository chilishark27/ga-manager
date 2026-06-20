export default function ContextBar({ context }: { context: any[] }) {
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

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Context
      </span>
      {tags.map(tag =>
        counts[tag.key] ? (
          <div
            key={tag.key}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 10,
              background: 'var(--bg3)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            {tag.label}
            <span style={{ color: 'var(--text-1)', fontWeight: 600, marginLeft: 4 }}>
              {counts[tag.key]}
            </span>
          </div>
        ) : null
      )}
      {Object.entries(counts)
        .filter(([k]) => !tags.find(t => t.key === k))
        .map(([k, v]) => (
          <div
            key={k}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 10,
              background: 'var(--bg3)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            {k}
            <span style={{ color: 'var(--text-1)', fontWeight: 600, marginLeft: 4 }}>{v}</span>
          </div>
        ))}
    </div>
  );
}
