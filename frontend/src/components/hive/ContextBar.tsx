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
    <div className="hv2-context-bar">
      <span style={{ fontSize: 11, fontWeight: 600, color: '#484f58', alignSelf: 'center' }}>Context</span>
      {tags.map(tag =>
        counts[tag.key] ? (
          <div key={tag.key} className="hv2-context-tag">
            {tag.label}<span className="count">{counts[tag.key]}</span>
          </div>
        ) : null
      )}
      {/* Catch-all for unlisted types */}
      {Object.entries(counts)
        .filter(([k]) => !tags.find(t => t.key === k))
        .map(([k, v]) => (
          <div key={k} className="hv2-context-tag">
            {k}<span className="count">{v}</span>
          </div>
        ))}
    </div>
  );
}
