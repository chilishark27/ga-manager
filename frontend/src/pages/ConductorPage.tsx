import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API = '/api/conductor';

interface Subagent {
  id: string;
  prompt: string;
  reply: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface ChatMsg {
  id: string;
  role: string;
  msg: string;
  ts: number;
  read: boolean;
}

function ConductorPage() {
  const [status, setStatus] = useState<'stopped' | 'running' | 'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [actionInput, setActionInput] = useState<Record<string, string>>({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    checkStatus();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const checkStatus = async () => {
    try {
      const r = await fetch(`${API}/status`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setStatus(d.status === 'running' ? 'running' : 'stopped');
      if (d.status === 'running') connectWs();
    } catch (e: any) {
      setStatus('stopped');
      setErrorMsg('');
    }
  };

  const startConductor = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const r = await fetch(`${API}/start`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.status === 'running') {
        setStatus('running');
        connectWs();
      } else {
        setStatus('error');
        setErrorMsg(d.error || 'Failed to start conductor');
      }
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message || 'Network error');
    }
  };

  const stopConductor = async () => {
    try {
      await fetch(`${API}/stop`, { method: 'POST' });
    } catch {}
    setStatus('stopped');
    if (wsRef.current) wsRef.current.close();
    setSubagents([]);
    setChat([]);
  };

  const connectWs = () => {
    if (wsRef.current) wsRef.current.close();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}${API}/ws`);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'hello') {
          setSubagents(data.subagents || []);
          setChat(data.chat || []);
        } else if (data.type === 'subagents') {
          setSubagents(data.items || []);
        } else if (data.type === 'chat') {
          setChat(prev => [...prev.slice(-50), data.item]);
        } else if (data.type === 'chat_read') {
          // Refresh chat on read event
        }
      } catch {}
    };
    ws.onclose = () => { wsRef.current = null; };
    ws.onerror = () => { wsRef.current = null; };
    wsRef.current = ws;
  };

  // Poll subagents and chat as fallback (WebSocket may miss messages)
  useEffect(() => {
    if (status !== 'running') return;
    const poll = setInterval(async () => {
      try {
        const [subRes, chatRes] = await Promise.all([
          fetch(`${API}/subagents`),
          fetch(`${API}/chat`),
        ]);
        if (subRes.ok) {
          const data = await subRes.json();
          if (Array.isArray(data)) setSubagents(data);
        }
        if (chatRes.ok) {
          const data = await chatRes.json();
          if (data.items) setChat(data.items);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, [status]);

  const createSubagent = async () => {
    if (!newPrompt.trim()) return;
    try {
      await fetch(`${API}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt }),
      });
      setNewPrompt('');
    } catch {}
  };

  const doAction = async (sid: string, action: string, msg?: string) => {
    try {
      await fetch(`${API}/subagents/${sid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, msg: msg || '' }),
      });
    } catch {}
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    // Send via WebSocket to trigger conductor agent wake
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ msg: chatInput }));
      setChatInput('');
    } else {
      // Fallback to REST (won't wake conductor but at least stores the message)
      try {
        await fetch(`${API}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg: chatInput, role: 'user' }),
        });
        setChatInput('');
      } catch {}
    }
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="conductor-page">
        <div className="conductor-center">
          <div className="conductor-loading-spinner" />
          <p style={{ color: 'var(--text-3)', marginTop: '12px' }}>Connecting to conductor...</p>
        </div>
      </div>
    );
  }

  // Stopped or error state - show centered start button
  if (status === 'stopped' || status === 'error') {
    return (
      <div className="conductor-page">
        <div className="conductor-center">
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.6 }}>&#9881;</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-1)', marginBottom: '8px' }}>
            Conductor
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '24px', maxWidth: '360px', textAlign: 'center', lineHeight: 1.6 }}>
            Multi-agent orchestrator. Start the conductor to manage subagents and coordinate tasks.
          </p>
          {errorMsg && (
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '12px' }}>{errorMsg}</p>
          )}
          <button className="conductor-start-btn" onClick={startConductor}>
            Start Conductor
          </button>
          <p className="conductor-hint" style={{ marginTop: '12px' }}>Runs on port 8900</p>
        </div>
      </div>
    );
  }

  // Running state - full interface with subagents + embedded chat
  return (
    <div className="conductor-page conductor-running">
      {/* Left: Subagents panel */}
      <div className="conductor-left">
        <div className="conductor-header">
          <span className="conductor-status-dot" />
          <span>Conductor</span>
          <span className="conductor-count">{subagents.length} agents</span>
          <button className="conductor-stop-btn" onClick={stopConductor}>Stop</button>
        </div>

        <div className="conductor-create">
          <input
            className="conductor-input"
            placeholder="New subagent task..."
            value={newPrompt}
            onChange={e => setNewPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSubagent(); }}
          />
          <button className="conductor-create-btn" onClick={createSubagent}>+</button>
        </div>

        <div className="conductor-agents">
          {subagents.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
              No subagents yet. Create one above.
            </p>
          )}
          {subagents.map(sa => {
            const isExpanded = expandedAgents.has(sa.id);
            const timeSince = sa.updated_at ? Math.round((Date.now() / 1000 - sa.updated_at)) : 0;
            const timeLabel = timeSince < 60 ? `${timeSince}s ago` : timeSince < 3600 ? `${Math.floor(timeSince / 60)}m ago` : `${Math.floor(timeSince / 3600)}h ago`;
            const isRecent = timeSince < 30;
            // Use prompt as name — short prompts are role names, long ones get truncated
            const name = sa.prompt.length <= 20 ? sa.prompt : sa.prompt.slice(0, 20) + '...';
            return (
            <div key={sa.id} className={`conductor-agent-card ${sa.status} ${isRecent ? 'recent' : ''}`}>
              <div className="conductor-agent-header">
                <span className={`conductor-agent-dot ${sa.status}`} />
                <span className="conductor-agent-name">{name}</span>
                <span className="conductor-agent-time">{timeLabel}</span>
                <span className={`conductor-agent-status ${sa.status}`}>{sa.status}</span>
              </div>
              {sa.prompt.length > 20 && (
                <div className="conductor-agent-prompt-full">{sa.prompt}</div>
              )}
              {sa.reply && (
                <div className="conductor-agent-reply" onClick={() => {
                  setExpandedAgents(prev => {
                    const next = new Set(prev);
                    if (next.has(sa.id)) next.delete(sa.id); else next.add(sa.id);
                    return next;
                  });
                }}>
                  {isExpanded ? sa.reply : (sa.reply.slice(0, 150) + (sa.reply.length > 150 ? ' ▸' : ''))}
                </div>
              )}
              <div className="conductor-agent-actions">
                <input
                  className="conductor-action-input"
                  placeholder="msg..."
                  value={actionInput[sa.id] || ''}
                  onChange={e => setActionInput(prev => ({ ...prev, [sa.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { doAction(sa.id, 'input', actionInput[sa.id]); setActionInput(prev => ({ ...prev, [sa.id]: '' })); } }}
                />
                <button className="conductor-action-btn" onClick={() => doAction(sa.id, 'abort')}>Abort</button>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Right: Embedded chat */}
      <div className="conductor-right">
        <div className="conductor-chat-header">
          <span style={{ fontWeight: 600, fontSize: '13px' }}>Conductor Chat</span>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', marginLeft: 'auto' }}>{chat.length} messages</span>
        </div>
        <div className="conductor-chat-messages-full">
          {chat.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
              No messages yet.
            </p>
          )}
          {chat.map(m => (
            <div key={m.id} className={`conductor-chat-msg ${m.role}`}>
              <span className="conductor-chat-role">{m.role}</span>
              {m.role === 'user' ? (
                <span className="conductor-chat-text">{m.msg}</span>
              ) : (
                <div className="conductor-chat-text markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.msg}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="conductor-chat-input-full">
          <input
            placeholder="Message conductor..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
          />
          <button onClick={sendChat}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default ConductorPage;
