import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface HivePost {
  id: number;
  author: string;
  content: string;
  created_at: string;
}

interface HiveStatus {
  running: boolean;
  port: number;
  board_key: string;
  objective: string;
  budget: number;
  workers: number;
  logs: string[];
  elapsed_minutes?: number;
}

interface RunSummary {
  file: string;
  objective: string;
  stopped_at: string;
  posts: number;
}

const DEFAULT_STATUS: HiveStatus = {
  running: false, port: 0, board_key: '', objective: '',
  budget: 60, workers: 2, logs: [],
};

function HivePage() {
  const { lang } = useI18n();
  const isZh = lang === 'zh';
  const [status, setStatus] = useState<HiveStatus>(DEFAULT_STATUS);
  const [posts, setPosts] = useState<HivePost[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(60);
  const [workers, setWorkers] = useState(2);
  const [llmNo, setLlmNo] = useState(0);
  const [mode, setMode] = useState('hive');
  const [projectDir, setProjectDir] = useState('');
  const [msgInput, setMsgInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const postsEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = () => {
    fetch('/api/hive/status').then(r => r.json()).then(setStatus).catch(() => {});
  };
  const fetchPosts = () => {
    fetch('/api/hive/posts?limit=50').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPosts(d); }).catch(() => {});
  };
  const fetchAuthors = () => {
    fetch('/api/hive/authors').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAuthors(d.map((a: { name: string }) => a.name)); })
      .catch(() => {});
  };
  const fetchHistory = () => {
    fetch('/api/hive/history').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setHistory(d); }).catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    fetchHistory();
    const t = setInterval(() => {
      fetchStatus();
    }, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!status.running) return;
    fetchPosts();
    fetchAuthors();
    const t = setInterval(() => {
      fetchPosts();
      fetchAuthors();
    }, 2000);
    return () => clearInterval(t);
  }, [status.running]);

  useEffect(() => {
    postsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts.length]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status.logs.length]);

  const handleStart = async () => {
    if (!objective.trim()) {
      setError(isZh ? '目标不能为空' : 'Objective is required');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/hive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          budget_minutes: budget,
          workers,
          llm_no: llmNo,
          mode,
          project_dir: projectDir,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start');
        return;
      }
      fetchStatus();
      fetchPosts();
      fetchAuthors();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    await fetch('/api/hive/stop', { method: 'POST' });
    fetchStatus();
    fetchHistory();
  };

  const handleSend = async () => {
    if (!msgInput.trim()) return;
    await fetch('/api/hive/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msgInput }),
    });
    setMsgInput('');
    fetchPosts();
  };

  const bbsURL = status.port ? `http://127.0.0.1:${status.port}` : '';

  if (!status.running) {
    return (
      <div className="hive-page">
        <div className="page-container">
          <h2 className="page-header">Hive</h2>
          <div className="page-card">
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>
                {isZh ? '目标' : 'Objective'}
              </label>
              <textarea
                value={objective}
                onChange={e => setObjective(e.target.value)}
                placeholder={isZh ? '描述 Hive 要完成的目标...' : 'Describe what Hive should accomplish...'}
                style={{
                  width: '100%', minHeight: 80, padding: '8px 10px',
                  borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg2)', color: 'var(--text-1)',
                  fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? '时间预算 (分钟, 0=不限时)' : 'Budget (min, 0=unlimited)'}
                </label>
                <input type="number" min={0} value={budget} onChange={e => setBudget(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? 'Worker 数量' : 'Workers'}
                </label>
                <input type="number" min={1} max={5} value={workers} onChange={e => setWorkers(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? 'LLM 编号' : 'LLM No'}
                </label>
                <input type="number" min={0} value={llmNo} onChange={e => setLlmNo(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? '模式' : 'Mode'}
                </label>
                <select value={mode} onChange={e => setMode(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="hive">{isZh ? 'Hive (目标驱动)' : 'Hive (goal-driven)'}</option>
                  <option value="checklist">{isZh ? 'Checklist (结构化)' : 'Checklist (structured)'}</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                {isZh ? '项目目录 (可选)' : 'Project Dir (optional)'}
              </label>
              <input type="text" value={projectDir} onChange={e => setProjectDir(e.target.value)}
                placeholder={isZh ? '留空则自动创建临时目录' : 'Leave empty to auto-create temp dir'}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <button className="setup-btn" onClick={handleStart} disabled={starting}
              style={{ padding: '8px 24px', fontSize: 14 }}>
              {starting ? (isZh ? '启动中...' : 'Starting...') : (isZh ? '启动 Hive' : 'Start Hive')}
            </button>
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {isZh ? '历史运行' : 'Run History'} ({history.length})
              </div>
              {history.map(h => (
                <div key={h.file} className="page-card" style={{ padding: '10px 14px', marginBottom: 8, opacity: 0.8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.objective}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {h.stopped_at ? new Date(h.stopped_at).toLocaleString() : ''} &middot; {h.posts} posts
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Running view
  return (
    <div className="hive-page">
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', flexShrink: 0 }} />
          <h2 className="page-header" style={{ margin: 0, flex: 1 }}>Hive</h2>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {isZh ? `运行中 · ${status.elapsed_minutes ?? 0} 分钟` : `Running · ${status.elapsed_minutes ?? 0} min`}
          </span>
          <button className="ch-btn" onClick={handleStop} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
            {isZh ? '停止' : 'Stop'}
          </button>
        </div>

        {bbsURL && (
          <div className="page-card" style={{ marginBottom: 12, border: '1px solid var(--accent, #7c3aed)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', marginBottom: 8 }}>
              {isZh ? 'Claude Code 可通过以下信息接入:' : 'Connect Claude Code via:'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
              BBS URL: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{bbsURL}</code>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Board Key: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4, userSelect: 'all' }}>{status.board_key}</code>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {isZh
                ? 'MCP 工具: hive_bbs_posts / hive_bbs_post / hive_bbs_status'
                : 'MCP tools: hive_bbs_posts / hive_bbs_post / hive_bbs_status'}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
          <div>
            <div className="page-card" style={{ height: 360, overflowY: 'auto', marginBottom: 10, padding: '10px 12px' }}>
              {posts.map(p => (
                <div key={p.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent, #7c3aed)' }}>{p.author}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{new Date(p.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p.content}</div>
                </div>
              ))}
              {posts.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                  {isZh ? '等待 Worker 发帖...' : 'Waiting for Worker posts...'}
                </div>
              )}
              <div ref={postsEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={isZh ? '发送消息到 BBS...' : 'Send a message to BBS...'}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13 }}
              />
              <button className="setup-btn" onClick={handleSend} style={{ padding: '7px 16px', fontSize: 13 }}>
                {isZh ? '发送' : 'Send'}
              </button>
            </div>
          </div>

          <div>
            {authors.length > 0 && (
              <div className="page-card" style={{ marginBottom: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8 }}>
                  {isZh ? '在线作者' : 'Authors'} ({authors.length})
                </div>
                {authors.map(a => (
                  <div key={a} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                    {a}
                  </div>
                ))}
              </div>
            )}
            <div className="page-card" style={{ padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8 }}>
                {isZh ? '系统日志' : 'System Logs'}
              </div>
              {status.logs.map((line, i) => (
                <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HivePage;