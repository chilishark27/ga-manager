import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useStore } from '../store';

interface HivePost { id: number; author: string; content: string; created_at: number; }
interface HiveStatus { running: boolean; port: number; board_key: string; objective: string; budget: number; workers: number; logs?: string[]; elapsed_minutes?: number; subagent_mode?: boolean; mode?: string; }
interface RunSummary { file: string; objective: string; stopped_at: string; posts: number; project_dir?: string; }
interface SubagentInfo { id: string; name: string; status: string; last_reply: string; }

// Shows files in Hive working directory with directory navigation
function FileLister() {
  const [files, setFiles] = useState<{ name: string; path: string; size: number; is_dir: boolean }[]>([]);
  const [cwd, setCwd] = useState('');
  const [root, setRoot] = useState('');
  const [sub, setSub] = useState('');

  const fetchFiles = (subPath: string) => {
    const url = subPath ? `/api/hive/files?sub=${encodeURIComponent(subPath)}` : '/api/hive/files';
    fetch(url).then(r => r.ok ? r.json() : { files: [], cwd: '', root: '' })
      .then((d: any) => {
        if (Array.isArray(d.files)) setFiles(d.files);
        if (d.cwd) setCwd(d.cwd);
        if (d.root) setRoot(d.root);
      }).catch(() => {});
  };

  useEffect(() => {
    fetchFiles(sub);
    const t = setInterval(() => fetchFiles(sub), 5000);
    return () => clearInterval(t);
  }, [sub]);

  const goUp = () => {
    if (!sub) return;
    const parts = sub.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    setSub(parts.join('/'));
  };

  const enterDir = (name: string) => {
    setSub(sub ? `${sub}/${name}` : name);
  };

  return (
    <div style={{ marginTop: 4 }}>
      {cwd && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>{cwd}</div>}
      {sub && (
        <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={goUp}>
          <span>⬆</span><span style={{ textDecoration: 'underline' }}>返回上级</span>
        </div>
      )}
      {files.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>暂无文件</div>}
      {files.map(f => (
        <div key={f.name} style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          onClick={() => { if (f.is_dir) enterDir(f.name); else window.open(`/api/file?path=${encodeURIComponent(f.path)}`, '_blank'); }}
          title={f.path}>
          <span>{f.is_dir ? '📁' : '📄'}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: f.is_dir ? 'var(--text-1)' : 'var(--accent)', textDecoration: f.is_dir ? 'none' : 'underline' }}>{f.name}</span>
          {!f.is_dir && <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{f.size > 1024 ? `${(f.size/1024).toFixed(1)}K` : `${f.size}B`}</span>}
          {f.is_dir && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>→</span>}
        </div>
      ))}
    </div>
  );
}

function HivePage() {
  const { lang } = useI18n();
  const isZh = lang === 'zh';
  const activeInstanceId = useStore(s => s.activeInstanceId);
  const instances = useStore(s => s.instances);
  const inst = activeInstanceId ? instances.find(i => i.id === activeInstanceId) : null;

  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [posts, setPosts] = useState<HivePost[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(0);
  const [workers, setWorkers] = useState(2);
  const [llmNo, setLlmNo] = useState(inst?.llm_no || 0);
  const [mode, setMode] = useState('hive');
  const [projectDir, setProjectDir] = useState(inst?.project_dir || '');
  const [planFirst, setPlanFirst] = useState(true);
  const [msgInput, setMsgInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const postsEndRef = useRef<HTMLDivElement>(null);
  const postsContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = () => { fetch('/api/hive/status').then(r => r.ok ? r.json() : null).then(d => { if (d) setStatus(d); }).catch(() => {}); };
  const fetchPosts = () => { fetch('/api/hive/posts?limit=50').then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setPosts(d); }).catch(() => {}); };
  const fetchAuthors = () => { fetch('/api/hive/authors').then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setAuthors(d.map((a: any) => a.name || a)); }).catch(() => {}); };
  const fetchHistory = () => { fetch('/api/hive/history').then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setHistory(d); }).catch(() => {}); };

  useEffect(() => { fetchStatus(); fetchHistory(); const t = setInterval(fetchStatus, 3000); return () => clearInterval(t); }, []);

  // Derive task status and worker status from posts
  const taskBoard = (() => {
    const tasks: { name: string; assignee: string; status: 'pending' | 'claimed' | 'done' | 'rejected' | 'verified' }[] = [];
    const workerStatus: Record<string, 'idle' | 'busy' | 'done' | 'rework'> = {};
    // Initialize all workers as idle
    authors.filter(a => a.includes('Worker')).forEach(a => { workerStatus[a] = 'idle'; });

    const allPosts = [...posts].reverse(); // chronological order
    for (const p of allPosts) {
      // Detect task assignments: [指派: Worker-XXX] pattern
      const assignMatches = p.content.matchAll(/\[指派[:：]\s*(Worker-\S+)\]\s*[^\n]*/g);
      for (const m of assignMatches) {
        const assignee = m[1];
        const taskLine = m[0].replace(/\[指派[:：]\s*Worker-\S+\]\s*/, '').trim().slice(0, 40);
        const existing = tasks.find(t => t.assignee === assignee);
        if (!existing) {
          tasks.push({ name: taskLine || `${assignee} 的任务`, assignee, status: 'pending' });
        }
      }
      // Detect claims: [接单] or [认领]
      if (p.content.includes('[接单]') || p.content.includes('[认领]')) {
        const t = tasks.find(t => t.assignee === p.author && (t.status === 'pending' || t.status === 'rejected'));
        if (t) { t.status = 'claimed'; workerStatus[p.author] = 'busy'; }
      }
      // Detect rejection: [驳回重做: Worker-XXX]
      const rejectMatch = p.content.match(/\[驳回重做[:：]\s*(Worker-\S+)\]/);
      if (rejectMatch) {
        const target = rejectMatch[1];
        const t = tasks.find(t => t.assignee === target);
        if (t) { t.status = 'rejected'; workerStatus[target] = 'rework'; }
      }
      // Detect verification pass: [验收通过]
      if (p.content.includes('[验收通过]') && p.author === 'Coordinator') {
        // Find which worker was just verified (look for worker name in the post)
        for (const t of tasks) {
          if (t.status === 'done' && p.content.includes(t.assignee)) {
            t.status = 'verified';
          }
        }
      }
      // Detect completion: [任务完成] or [完成] in worker posts
      if ((p.content.includes('[任务完成]') || p.content.includes('[完成]') || p.content.includes('任务完成')) && p.author.includes('Worker')) {
        const t = tasks.find(t => t.assignee === p.author && (t.status === 'claimed' || t.status === 'pending' || t.status === 'rejected'));
        if (t) { t.status = 'done'; workerStatus[p.author] = 'done'; }
      }
      // If a worker posted a substantial report (>200 chars), consider them busy/done
      if (p.author.includes('Worker') && p.content.length > 200 && !p.content.includes('[接单]')) {
        if (workerStatus[p.author] === 'idle') workerStatus[p.author] = 'busy';
      }
    }
    return { tasks, workerStatus };
  })();

  const isRunning = status?.running === true;
  useEffect(() => { if (!isRunning) return; fetchPosts(); fetchAuthors(); const t = setInterval(() => { fetchPosts(); fetchAuthors(); }, 3000); return () => clearInterval(t); }, [isRunning]);
  useEffect(() => { const el = postsContainerRef.current; if (!el) return; if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) postsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [posts.length]);

  const handleStart = async () => {
    if (!objective.trim()) { setError(isZh ? '目标不能为空' : 'Objective required'); return; }
    setStarting(true); setError('');
    try {
      const res = await fetch('/api/hive/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective, budget_minutes: budget, workers, llm_no: llmNo, mode, project_dir: projectDir, plan_first: planFirst }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || 'Failed'); else { fetchStatus(); fetchPosts(); }
    } catch (e: any) { setError(String(e)); }
    setStarting(false);
  };
  const handleStop = async () => { if (!confirm(isZh ? '确定停止 Hive？运行中的任务将被终止。' : 'Stop Hive? Running tasks will be terminated.')) return; await fetch('/api/hive/stop', { method: 'POST' }); fetchStatus(); fetchHistory(); };
  const handleSend = async () => { if (!msgInput.trim()) return; await fetch('/api/hive/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: msgInput }) }); setMsgInput(''); fetchPosts(); };
  const handleDeleteHistory = async (file: string) => { if (!confirm(isZh ? '删除此记录？' : 'Delete this record?')) return; await fetch(`/api/hive/history/record?file=${encodeURIComponent(file)}`, { method: 'DELETE' }); fetchHistory(); };
  const handleUploadImage = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/hive/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) { setMsgInput(prev => prev + (prev ? '\n' : '') + `[图片: ${data.url}]`); }
    } catch {}
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleUploadImage(file);
        return;
      }
    }
  };

  const logs = status?.logs || [];
  const bbsURL = status?.port ? `http://127.0.0.1:${status.port}` : '';
  const isSubagentMode = status?.subagent_mode === true;

  // Poll sub-agent status when in subagent mode
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  useEffect(() => {
    if (!isRunning || !isSubagentMode) { setSubagents([]); return; }
    const fetchSubagents = () => {
      fetch('/api/hive/subagents').then(r => r.ok ? r.json() : [])
        .then(d => { if (Array.isArray(d)) setSubagents(d); }).catch(() => {});
    };
    fetchSubagents();
    const t = setInterval(fetchSubagents, 5000);
    return () => clearInterval(t);
  }, [isRunning, isSubagentMode]);

  if (!isRunning) {
    return (
      <div className="hive-page"><div className="page-container">
        <h2 className="page-header">Hive</h2>
        <div className="page-card" style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 15, color: 'var(--text-1)', display: 'block', marginBottom: 6, fontWeight: 600 }}>{isZh ? '目标' : 'Objective'}</label>
            <textarea value={objective} onChange={e => setObjective(e.target.value)} placeholder={isZh ? '描述目标...' : 'Describe objective...'} style={{ width: '100%', minHeight: 90, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 15, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div><label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{isZh ? '时间 (0=不限时)' : 'Budget (0=unlimited)'}</label><input type="number" min={0} value={budget} onChange={e => setBudget(+e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 15, boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Workers</label><input type="number" min={1} max={5} value={workers} onChange={e => setWorkers(+e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 15, boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>LLM</label><input type="number" min={0} value={llmNo} onChange={e => setLlmNo(+e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 15, boxSizing: 'border-box' }} /></div>
            <div><label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{isZh ? '模式' : 'Mode'}</label><select value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 15, boxSizing: 'border-box' }}><option value="hive">Hive</option><option value="checklist">Checklist</option><option value="subagent">Hive (子Agent)</option></select></div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{isZh ? '项目目录 (Workers 的工作区)' : 'Project Dir (worker CWD)'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={projectDir} onChange={e => setProjectDir(e.target.value)} placeholder={isZh ? '留空=自动临时目录' : 'Empty=auto temp'} style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 14, fontFamily: 'monospace', boxSizing: 'border-box' }} />
              <button onClick={async () => { try { const r = await fetch('/api/project/browse', { method: 'POST' }); const d = await r.json(); if (d.path) setProjectDir(d.path); } catch {} }} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', cursor: 'pointer', fontSize: 16 }}>📁</button>
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={planFirst} onChange={e => setPlanFirst(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 14, color: 'var(--text-1)' }}>{isZh ? '先规划再执行 (Plan模式)' : 'Plan before execute'}</span>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, marginLeft: 24 }}>{isZh ? 'Coordinator 先扫描项目、制定计划，再分配任务。适合复杂项目或中途接入的项目' : 'Coordinator scans project and creates a plan before assigning tasks'}</div>
          </div>
          {error && <div style={{ color: 'var(--red)', fontSize: 14, marginBottom: 10 }}>{error}</div>}
          <button className="setup-btn" onClick={handleStart} disabled={starting} style={{ padding: '10px 28px', fontSize: 15 }}>{starting ? '...' : (isZh ? '▶ 启动 Hive' : '▶ Start Hive')}</button>
        </div>
        {history.length > 0 && (<div style={{ marginTop: 24 }}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>{isZh ? '历史记录' : 'History'}</div>{history.map(h => (<div key={h.file} className="page-card" style={{ padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 500 }}>{h.objective}</div><div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{h.stopped_at} · {h.posts} posts{h.project_dir ? ` · 📁 ${h.project_dir.split(/[/\\]/).pop()}` : ''}</div></div><button className="ch-btn" style={{ fontSize: 13, padding: '6px 14px' }} onClick={async () => { try { await fetch('/api/hive/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: h.file, workers, llm_no: llmNo, project_dir: h.project_dir || projectDir }) }); fetchStatus(); } catch {} }}>{isZh ? '▶ 继续' : '▶ Resume'}</button><button className="ch-btn" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--text-3)' }} onClick={() => handleDeleteHistory(h.file)}>✕</button></div>))}</div>)}
      </div></div>
    );
  }

  return (
    <div className="hive-page" style={{ padding: '16px 24px', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexShrink: 0 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
        <h2 className="page-header" style={{ margin: 0, flex: 1 }}>Hive</h2>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{status?.workers || 0} workers · {status?.elapsed_minutes || 0}min</span>
        <button className="ch-btn" onClick={handleStop} style={{ color: 'var(--red)', fontSize: 13, padding: '6px 14px' }}>{isZh ? '⏹ 停止' : '⏹ Stop'}</button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status?.objective}>📋 {status?.objective}</div>
      {bbsURL && (<div className="page-card" style={{ marginBottom: 10, padding: '8px 14px', borderColor: 'var(--accent)', flexShrink: 0 }}><span style={{ fontSize: 12, fontWeight: 600 }}>🔗 CC</span><span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 8 }}>BBS: <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{bbsURL}</code> Key: <code style={{ background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, fontSize: 11, userSelect: 'all' }}>{status?.board_key}</code></span></div>)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {authors.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              <button onClick={() => setFilterAuthor('')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: !filterAuthor ? 'var(--accent)' : 'var(--bg3)', color: !filterAuthor ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>{isZh ? '全部' : 'All'}</button>
              {authors.map(a => <button key={a} onClick={() => setFilterAuthor(a)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: filterAuthor === a ? 'var(--accent)' : 'var(--bg3)', color: filterAuthor === a ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>{a}</button>)}
            </div>
          )}
          <div ref={postsContainerRef} className="page-card" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', marginBottom: 10, minHeight: 0 }}>
            <div>
              {posts.length === 0 && <div style={{ color: 'var(--text-3)', textAlign: 'center', paddingTop: 60, fontSize: 14 }}>{isZh ? '等待 Worker 发帖...' : 'Waiting for posts...'}</div>}
              {[...posts].reverse().filter(p => !filterAuthor || p.author === filterAuthor).map(p => {
                const isSummary = p.content.includes('[最终总结]') || p.content.includes('## 最终总结');
                // Render images inline: [图片: URL] or direct image URLs
                const renderContent = (text: string) => {
                  const parts = text.split(/(\[图片[:：]\s*[^\]]+\])/g);
                  return parts.map((part, i) => {
                    const imgMatch = part.match(/\[图片[:：]\s*([^\]]+)\]/);
                    if (imgMatch) return <img key={i} src={imgMatch[1].trim()} style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6, marginTop: 6, display: 'block' }} />;
                    return <span key={i}>{part}</span>;
                  });
                };
                return (<div key={p.id} style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: isSummary ? 'var(--accent-bg, rgba(99,102,241,0.08))' : 'var(--bg3)', border: isSummary ? '2px solid var(--accent)' : '1px solid var(--border)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ fontSize: 13, fontWeight: 700, color: p.author.includes('Worker') ? 'var(--green)' : p.author === 'Coordinator' ? 'var(--accent)' : 'var(--text-1)' }}>{p.author}</span>{isSummary && <span style={{ fontSize: 11, background: 'var(--accent)', color: '#fff', padding: '1px 6px', borderRadius: 3 }}>总结</span>}<span style={{ fontSize: 11, color: 'var(--text-3)' }}>{new Date(p.created_at * 1000).toLocaleTimeString()}</span></div><div style={{ fontSize: 14, color: 'var(--text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{renderContent(p.content)}</div></div>);
              })}
              <div ref={postsEndRef} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <input value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }} onPaste={handlePaste} placeholder={isZh ? '发送指令或追加任务... (可粘贴图片)' : 'Send instruction... (paste image supported)'} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-1)', fontSize: 14 }} />
            <label style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center' }} title={isZh ? '上传图片' : 'Upload image'}>📎<input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadImage(f); e.target.value = ''; }} /></label>
            <button className="setup-btn" onClick={handleSend} style={{ padding: '10px 20px', fontSize: 14 }}>{isZh ? '发送' : 'Send'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', minHeight: 0 }}>
          <div className="page-card" style={{ padding: '10px 14px', flexShrink: 0, maxHeight: 180, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>{isZh ? '任务看板' : 'Task Board'}</div>
            {taskBoard.tasks.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{isZh ? '等待 Coordinator 分配任务...' : 'Waiting for task assignment...'}</div>}
            {taskBoard.tasks.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: t.status === 'verified' ? '#22c55e' : t.status === 'done' ? '#3b82f6' : t.status === 'claimed' ? '#f59e0b' : t.status === 'rejected' ? '#ef4444' : 'var(--text-3)' }} />
                <span style={{ flex: 1, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.assignee}</span>
                <span style={{ fontSize: 11, flexShrink: 0, color: t.status === 'verified' ? '#22c55e' : t.status === 'done' ? '#3b82f6' : t.status === 'claimed' ? '#f59e0b' : t.status === 'rejected' ? '#ef4444' : 'var(--text-3)' }}>
                  {t.status === 'verified' ? '✓ 验收' : t.status === 'done' ? '📋 待验收' : t.status === 'claimed' ? '⚡ 执行中' : t.status === 'rejected' ? '↩ 重做' : '○ 未接单'}
                </span>
              </div>
            ))}
            {Object.keys(taskBoard.workerStatus).length > 0 && taskBoard.tasks.length === 0 && (
              <div style={{ marginTop: 6 }}>
                {Object.entries(taskBoard.workerStatus).map(([name, st]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: st === 'busy' ? '#f59e0b' : st === 'done' ? '#22c55e' : 'var(--text-3)' }} />
                    <span style={{ color: 'var(--text-1)' }}>{name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{st === 'busy' ? '忙碌' : st === 'done' ? '完成' : '空闲'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="page-card" style={{ padding: '10px 14px', flex: 1, overflowY: 'auto', minHeight: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>{isZh ? '产出文件' : 'Files'}</div><FileLister /></div>
          {isSubagentMode && subagents.length > 0 && (
            <div className="page-card" style={{ padding: '10px 14px', flexShrink: 0, maxHeight: 140, overflowY: 'auto' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>{isZh ? '子 Agent' : 'Sub-Agents'} ({subagents.length})</div>
              {subagents.map(sa => (
                <div key={sa.id} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sa.status === 'running' ? '#22c55e' : 'var(--text-3)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-1)', flex: 1 }}>{sa.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{sa.status}</span>
                </div>
              ))}
            </div>
          )}
          <details open className="page-card" style={{ padding: '10px 14px', flexShrink: 0, maxHeight: 160, overflowY: 'auto' }}>
            <summary style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none' }}>{isZh ? '系统日志' : 'Logs'} ({logs.length})</summary>
            <div style={{ marginTop: 4 }}>{logs.slice(-20).map((l, i) => <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', lineHeight: 1.4 }}>{l}</div>)}<div ref={logsEndRef} /></div>
          </details>
        </div>
      </div>
    </div>
  );
}

export default HivePage;
