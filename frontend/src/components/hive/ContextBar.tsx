export default function ContextBar({ context }: { context: any[] }) {
  const counts: Record<string, number> = {};
  context.forEach(c => {
    counts[c.type] = (counts[c.type] || 0) + 1;
  });

  return (
    <div
      style={{
        padding: '8px 16px', borderTop: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16,
      }}
    >
      <span style={{ fontWeight: 600 }}>Context:</span>
      <span>调研结论({counts['finding'] || 0})</span>
      <span>设计决策({counts['decision'] || 0})</span>
      <span>总结({counts['summary'] || 0})</span>
      <span>需求({counts['requirement'] || 0})</span>
    </div>
  );
}
