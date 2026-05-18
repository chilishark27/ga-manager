import { useEffect, useState, useRef } from 'react';
import { useI18n } from '../i18n';

interface HiveStatus {
  running: boolean;
  port: number;
  board_key: string;
  objective: string;
  workers: number;
  elapsed_minutes?: number;
}

function HivePage() {
  const { lang } = useI18n();
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(180);
  const [workers, setWorkers] = useState(2);
  const [posts, setPosts] = useState<any[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/hive/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/hive/posts?limit=30');
      if (res.ok) setPosts(await res.json());
    } catch {}
  };

  const fetchAuthors = async () => {
    try {
      const res = await fetch('/api/hive/authors');
      if (res.ok) setAuthors(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    timer.current = setInterval(() => {
      fetchStatus();
      if (status?.running) { fetchPosts(); fetchAuthors(); }
    }, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (status?.running) { fetchPosts(); fetchAuthors(); }
  }, [status?.running]);

  const handleStart = async () => {
    if (!objective.trim()) { setError(lang === 'zh' ? '请输入目标' : 'Objective required'); return; }
    setStarting(true); setError('');
    try {
      const res = await fetch('/api/hive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: objective.trim(), budget_minutes: budget, workers }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Start failed');
      } else {
        fetchStatus();
      }
    } catch { setError('Network error'); }
    setStarting(false);
  };

  const handleStop = async () => {
    await fetch('/api/hive/stop', { method: 'POST' });
    fetchStatus();
    setPosts([]); setAuthors([]);
  };

  return (
    <div className="hive-page">
      <div className="page-container">
        <h2 className="page-header">{lang === 'zh' ? '蜂巢模式' : 'Goal Hive'}</h2>

        {!status?.running ? (
          <div className="page-card" style={{ maxWidth: '560px' }}>
            <div className="page-card-title">{lang === 'zh' ? '启动蜂巢' : 'Start Hive Session'}</div>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '16px' }}>
              {lang === 'zh' ? '输入目标，系统自动启动 BBS + Workers + Hive Master 协同工作' : 'Enter objective, system auto-launches BBS + Workers + Hive Master'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <textarea
                className="hive-input"
                style={{ minHeight: '80px', resize: 'vertical' }}
                placeholder={lang === 'zh' ? '输入目标，例如：设计一个中转站UI...' : 'Enter objective...'}
                value={objective}
                onChange={e => setObjective(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '4px' }}>
                    {lang === 'zh' ? '时间预算（分钟）' : 'Budget (min)'}
                  </label>
                  <input className="hive-input" type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} min={30} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '4px' }}>
                    {lang === 'zh' ? 'Worker 数量' : 'Workers'}
                  </label>
                  <input className="hive-input" type="number" value={workers} onChange={e => setWorkers(Number(e.target.value))} min={1} max={5} />
                </div>
              </div>
              {error && <div style={{ color: 'var(--red)', fontSize: '12px' }}>{error}</div>}
              <button className="setup-btn" onClick={handleStart} disabled={starting}>
                {starting ? (lang === 'zh' ? '启动中...' : 'Starting...') : (lang === 'zh' ? '启动蜂巢' : 'Start Hive')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="page-card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="page-card-title" style={{ marginBottom: '4px' }}>{lang === 'zh' ? '运行中' : 'Running'}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{status.objective}</div>
                </div>
                <button className="ch-btn danger" onClick={handleStop}>{lang === 'zh' ? '停止' : 'Stop'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' }}>
                <div className="token-stat-item">
                  <span className="token-stat-label">Workers</span>
                  <span className="token-stat-value">{status.workers}</span>
                </div>
                <div className="token-stat-item">
                  <span className="token-stat-label">Port</span>
                  <span className="token-stat-value">{status.port}</span>
                </div>
                <div className="token-stat-item">
                  <span className="token-stat-label">{lang === 'zh' ? '已运行' : 'Elapsed'}</span>
                  <span className="token-stat-value">{status.elapsed_minutes || 0}m</span>
                </div>
              </div>
            </div>

            {authors.length > 0 && (
              <div className="page-card" style={{ marginBottom: '16px' }}>
                <div className="page-card-title">{lang === 'zh' ? '参与者' : 'Participants'}</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {authors.map(a => <span key={a} className="hive-author-tag">{a}</span>)}
                </div>
              </div>
            )}

            <div className="page-card">
              <div className="page-card-title">{lang === 'zh' ? '消息流' : 'Message Feed'}</div>
              <div className="hive-posts">
                {posts.length === 0 ? (
                  <div style={{ color: 'var(--text-3)', fontSize: '12px', padding: '20px 0', textAlign: 'center' }}>
                    {lang === 'zh' ? '等待消息...' : 'Waiting for messages...'}
                  </div>
                ) : posts.map((p: any) => (
                  <div key={p.id} className="hive-post-item">
                    <div className="hive-post-header">
                      <span className="hive-post-author">{p.author}</span>
                      <span className="hive-post-time">{p.created_at ? new Date(p.created_at * 1000).toLocaleTimeString() : ''}</span>
                    </div>
                    <div className="hive-post-content">{p.content}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HivePage;
