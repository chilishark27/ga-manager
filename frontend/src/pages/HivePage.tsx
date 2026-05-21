import { useEffect, useState, useRef } from 'react';
import { useI18n } from '../i18n';

interface HiveStatus {
  running: boolean;
  port: number;
  board_key: string;
  objective: string;
  budget: number;
  workers: number;
  elapsed_minutes?: number;
  logs?: string[];
}

function HivePage() {
  const { lang } = useI18n();
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(60);
  const [workers, setWorkers] = useState(2);
  const [posts, setPosts] = useState<any[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const postsEndRef = useRef<HTMLDivElement | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/hive/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/hive/posts?limit=30');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setPosts([...data].reverse());
      }
    } catch {}
  };

  const fetchAuthors = async () => {
    try {
      const res = await fetch('/api/hive/authors');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAuthors(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    timer.current = setInterval(() => {
      fetchStatus();
      fetchPosts();
      fetchAuthors();
    }, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (postsEndRef.current) postsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [posts]);

  const handleStart = async () => {
    if (!objective.trim()) { setError(lang === 'zh' ? '请输入目标' : 'Objective required'); return; }
    setStarting(true); setError('');
    try {
      const res = await fetch('/api/hive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: objective.trim(), budget_minutes: budget, workers }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || 'Start failed');
      else fetchStatus();
    } catch { setError('Network error'); }
    setStarting(false);
  };

  const handleStop = async () => {
    await fetch('/api/hive/stop', { method: 'POST' });
    fetchStatus();
  };

  const handleSendMsg = async () => {
    if (!newMsg.trim()) return;
    await fetch('/api/hive/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newMsg.trim() }),
    });
    setNewMsg('');
    fetchPosts();
  };

  const isRunning = status?.running;
  const statusLoaded = status !== null;

  return (
    <div className="hive-page">
      <div className="page-container">
        <h2 className="page-header">{lang === 'zh' ? '蜂巢模式' : 'Goal Hive'}</h2>

        {!statusLoaded ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>Loading...</div>
        ) : !isRunning ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '40px' }}>
          <div className="page-card" style={{ maxWidth: '560px', width: '100%' }}>
            <div className="page-card-title">{lang === 'zh' ? '启动蜂巢' : 'Start Hive'}</div>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '16px' }}>
              {lang === 'zh' ? '多 Agent 协作：自动启动 BBS + Workers + Master，围绕目标持续工作' : 'Multi-agent collaboration: auto-launches BBS + Workers + Master'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <textarea className="hive-input" style={{ minHeight: '80px', resize: 'vertical' }}
                placeholder={lang === 'zh' ? '输入目标...' : 'Enter objective...'}
                value={objective} onChange={e => setObjective(e.target.value)} />
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '4px' }}>
                    {lang === 'zh' ? '时间（分钟）' : 'Budget (min)'}
                  </label>
                  <input className="hive-input" type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} min={5} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '4px' }}>Workers</label>
                  <input className="hive-input" type="number" value={workers} onChange={e => setWorkers(Number(e.target.value))} min={1} max={5} />
                </div>
              </div>
              {error && <div style={{ color: 'var(--red)', fontSize: '12px' }}>{error}</div>}
              <button className="setup-btn" onClick={handleStart} disabled={starting}>
                {starting ? (lang === 'zh' ? '启动中...' : 'Starting...') : (lang === 'zh' ? '启动蜂巢' : 'Start Hive')}
              </button>
            </div>
          </div>
          </div>
        ) : (
          <div className="hive-running-layout">
            {/* Left: status + posts */}
            <div className="hive-running-main">
              <div className="page-card" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)' }}>{status?.objective}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>
                      {status?.workers} workers | port {status?.port} | {status?.elapsed_minutes || 0}m / {status?.budget || 0}m
                    </div>
                  </div>
                  <button className="ch-btn danger" onClick={handleStop}>{lang === 'zh' ? '停止' : 'Stop'}</button>
                </div>
                {authors.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {authors.map(a => <span key={a} className="hive-author-tag">{a}</span>)}
                  </div>
                )}
              </div>

              <div className="page-card">
                <div className="page-card-title">{lang === 'zh' ? '消息流' : 'Messages'}</div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input className="hive-input" style={{ flex: 1 }}
                    placeholder={lang === 'zh' ? '发送指令或追加任务...' : 'Send instruction or new task...'}
                    value={newMsg} onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendMsg(); }} />
                  <button className="ch-btn" onClick={handleSendMsg}>{lang === 'zh' ? '发送' : 'Send'}</button>
                </div>
                <div className="hive-posts" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {posts.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', fontSize: '12px', padding: '20px 0', textAlign: 'center' }}>
                      {lang === 'zh' ? 'Workers 每 60 秒检查一次任务，请稍候...' : 'Workers check every 60s, please wait...'}
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
                  <div ref={postsEndRef} />
                </div>
              </div>
            </div>

            {/* Right: logs */}
            <div className="hive-running-logs">
              <div className="page-card" style={{ height: '100%' }}>
                <div className="page-card-title">{lang === 'zh' ? '系统日志' : 'System Log'}</div>
                <div className="hive-log-list">
                  {(status?.logs || []).map((log, i) => (
                    <div key={i} className="hive-log-item">{log}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HivePage;
