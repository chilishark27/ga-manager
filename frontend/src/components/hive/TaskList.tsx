export default function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: any[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="hv2-timeline" style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '8px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 12px 4px' }}>
        Tasks · {tasks.length}
      </div>
      {tasks.map((t, idx) => (
        <div
          key={t.id}
          className={`hv2-timeline-item ${selectedId === t.id ? 'selected' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {/* Connector line */}
          {idx < tasks.length - 1 && <div className="hv2-timeline-line" />}
          {/* Status dot */}
          <div className={`hv2-timeline-dot ${t.status}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hv2-timeline-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}
            </div>
            <div className="hv2-timeline-meta">{t.type} · {t.executor}</div>
          </div>
        </div>
      ))}
      {tasks.length === 0 && (
        <div style={{ padding: '16px 12px', fontSize: 12, color: '#484f58' }}>No tasks yet</div>
      )}
    </div>
  );
}
