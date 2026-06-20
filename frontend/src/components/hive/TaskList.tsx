const statusIcon: Record<string, string> = {
  done: '✅', running: '🔄', pending: '⏳', blocked: '🔒', failed: '❌', stalled: '⚠️',
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
    <div className="page-card" style={{ overflowY: 'auto', padding: '8px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, padding: '0 8px' }}>任务列表</div>
      {tasks.map(t => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            background: selectedId === t.id ? 'var(--bg-2)' : 'transparent',
            border: selectedId === t.id ? '1px solid var(--accent)' : '1px solid transparent',
          }}
        >
          <span style={{ marginRight: 6 }}>{statusIcon[t.status] || '⏳'}</span>
          <span style={{ color: 'var(--text-1)' }}>{t.title}</span>
        </div>
      ))}
    </div>
  );
}
