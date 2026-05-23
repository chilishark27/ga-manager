import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

function LogViewer() {
  const { activeInstance: getActiveInstance } = useStore();
  const inst = getActiveInstance();
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inst) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/instances/${inst.id}/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [inst?.id]);

  useEffect(() => {
    if (autoScroll && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoScroll]);

  const filtered = filter
    ? logs.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  if (!inst) return <div className="log-viewer-empty">Select an instance to view logs</div>;

  return (
    <div className="log-viewer">
      <div className="log-viewer-toolbar">
        <input className="log-viewer-filter" placeholder="Filter logs..." value={filter} onChange={e => setFilter(e.target.value)} />
        <label className="log-viewer-auto">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> Auto-scroll
        </label>
      </div>
      <div className="log-viewer-content">
        {filtered.map((line, i) => (
          <div key={i} className={`log-line ${line.includes('ERROR') ? 'error' : line.includes('WARN') ? 'warn' : ''}`}>
            {line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default LogViewer;
