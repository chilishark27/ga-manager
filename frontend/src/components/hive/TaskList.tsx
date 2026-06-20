const TYPE_LABELS: Record<string, string> = {
  research: '研究',
  design: '设计',
  implement: '实现',
  verify: '验证',
};

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
    <div className="page-card" style={{ padding: '12px 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 14px 8px' }}>
        Tasks · {tasks.length}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tasks.map((t, idx) => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 14px',
              cursor: 'pointer',
              background: selectedId === t.id ? 'var(--sidebar-hover)' : 'transparent',
              transition: 'background 0.1s',
              position: 'relative',
            }}
            onMouseEnter={e => { if (selectedId !== t.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--sidebar-hover)'; }}
            onMouseLeave={e => { if (selectedId !== t.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            {/* Timeline dot + line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div className={`hive2-timeline-dot ${t.status === 'done' ? 'done' : t.status}`} />
              {idx < tasks.length - 1 && <div className="hive2-timeline-line" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                {t.type && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text-3)', fontWeight: 500 }}>
                    {TYPE_LABELS[t.type] || t.type}
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.executor}</span>
              </div>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-3)' }}>
            No tasks yet
          </div>
        )}
      </div>
    </div>
  );
}
