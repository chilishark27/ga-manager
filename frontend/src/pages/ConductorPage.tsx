import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { useI18n } from '../i18n';

const DEV_PREFIX = '[DEV] 分步交付，先设计后实现，模块化。\n';

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
  const { activeInstance: getActiveInstance } = useStore();
  const { lang } = useI18n();
  const inst = getActiveInstance();
  const devMode = !!(inst as any)?.dev_mode;

  const [status, setStatus] = useState<'stopped' | 'running' | 'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<Subagent | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [actionInput, setActionInput] = useState<Record<string, string>>({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Keep selectedAgent in sync with latest data
  useEffect(() => {
    if (selectedAgent) {
      const updated = subagents.find(s => s.id === selectedAgent.id);
      if (updated && updated.reply !== selectedAgent.reply) {
        setSelectedAgent(updated);
      }
    }
  }, [subagents]);

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
      if (d.status === 'running') {
        connectWs();
      } else {
        // Load cached state when conductor is stopped
        loadCachedState();
      }
    } catch (e: any) {
      setStatus('stopped');
      setErrorMsg('');
      loadCachedState();
    }
  };

  const loadCachedState = async () => {
    try {
      const [subRes, chatRes] = await Promise.all([
        fetch(`${API}/subagents`),
        fetch(`${API}/chat`),
      ]);
      if (subRes.ok) {
        const d = await subRes.json();
        const items = d.items || d.subagents || [];
        if (items.length > 0) setSubagents(items);
      }
      if (chatRes.ok) {
        const d = await chatRes.json();
        const items = d.items || d.chat || [];
        if (items.length > 0) setChat(items);
      }
    } catch { /* ignore */ }
  };

  const startConductor = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const r = await fetch(`${API}/start`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus('error');
        setErrorMsg(d.error || `HTTP ${r.status}`);
        return;
      }
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
          setSubagents(data.items || data.subagents || []);
        } else if (data.type === 'chat') {
          setChat(prev => [...prev.slice(-50), data.item]);
        }
      } catch {}
    };
    ws.onclose = () => {
      wsRef.current = null;
      // Auto-reconnect after 2s
      setTimeout(() => { if (status === 'running') connectWs(); }, 2000);
    };
    ws.onerror = () => { wsRef.current = null; };
    wsRef.current = ws;
  };

  // Poll subagents and chat every 1s for real-time updates
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
          if (data.items) setSubagents(data.items);
          else if (Array.isArray(data)) setSubagents(data);
        }
        if (chatRes.ok) {
          const data = await chatRes.json();
          if (data.items) setChat(data.items);
          else if (Array.isArray(data)) setChat(data);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(poll);
  }, [status]);

  const createSubagent = async () => {
    if (!newPrompt.trim()) return;
    const prompt = devMode ? DEV_PREFIX + newPrompt : newPrompt;
    try {
      await fetch(`${API}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
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
    const msg = devMode ? DEV_PREFIX + chatInput : chatInput;
    // Send via WebSocket to trigger conductor agent wake
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ msg }));
      setChatInput('');
    } else {
      // Fallback to REST (won't wake conductor but at least stores the message)
      try {
        await fetch(`${API}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg, role: 'user' }),
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
            {lang === 'zh' ? '编排模式' : 'Conductor'}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-3)', marginBottom: '24px', maxWidth: '360px', textAlign: 'center', lineHeight: 1.6 }}>
            {lang === 'zh'
              ? '创建多个子 Agent 并行工作，由 Conductor 统一调度分配任务。适合需要拆分的复杂任务。'
              : 'Create multiple sub-agents working in parallel, coordinated by a conductor. Best for complex tasks that can be split.'}
          </p>
          {errorMsg && (
            <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '12px' }}>{errorMsg}</p>
          )}
          <button className="conductor-start-btn" onClick={startConductor}>
            {lang === 'zh' ? '启动编排' : 'Start Conductor'}
          </button>
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
            const timeSince = sa.updated_at ? Math.round((Date.now() / 1000 - sa.updated_at)) : 0;
            const timeLabel = timeSince < 60 ? `${timeSince}s` : timeSince < 3600 ? `${Math.floor(timeSince / 60)}m` : `${Math.floor(timeSince / 3600)}h`;
            const isRecent = timeSince < 30;
            // Extract a readable name: first line, or before colon/period, max 30 chars
            let name = sa.prompt.split('\n')[0];
            if (name.includes('：')) name = name.split('：')[0];
            else if (name.includes(':') && name.indexOf(':') < 20) name = name.split(':')[0];
            if (name.length > 30) name = name.slice(0, 30) + '...';
            return (
            <div key={sa.id} className={`conductor-agent-card ${sa.status} ${isRecent ? 'recent' : ''} ${selectedAgent?.id === sa.id ? 'selected' : ''}`}
              onClick={() => setSelectedAgent(selectedAgent?.id === sa.id ? null : sa)}
            >
              <div className="conductor-agent-header">
                <span className={`conductor-agent-dot ${sa.status}`} />
                <span className="conductor-agent-name">{name}</span>
                <span className="conductor-agent-time">{timeLabel}</span>
                <span className={`conductor-agent-status ${sa.status}`}>{sa.status === 'running' ? 'working...' : sa.status}</span>
              </div>
              {sa.reply && selectedAgent?.id !== sa.id && (
                <div className="conductor-agent-reply-preview">
                  {sa.reply.slice(0, 80)}{sa.reply.length > 80 ? '...' : ''}
                </div>
              )}
              {sa.status === 'running' && !sa.reply && (
                <div className="conductor-agent-working">thinking...</div>
              )}
              <div className="conductor-agent-actions" onClick={e => e.stopPropagation()}>
                <input
                  className="conductor-action-input"
                  placeholder="msg..."
                  value={actionInput[sa.id] || ''}
                  onChange={e => setActionInput(prev => ({ ...prev, [sa.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { doAction(sa.id, 'input', actionInput[sa.id]); setActionInput(prev => ({ ...prev, [sa.id]: '' })); } }}
                />
                <button className="conductor-action-btn" onClick={() => doAction(sa.id, 'abort')}>Abort</button>
                <button className="conductor-action-btn" style={{ borderColor: 'rgba(255,77,79,0.3)', color: 'var(--red)' }} onClick={() => setSubagents(prev => prev.filter(s => s.id !== sa.id))}>Del</button>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Right: Agent Detail or Chat */}
      <div className="conductor-right">
        {selectedAgent ? (
          <>
            <div className="conductor-chat-header">
              <span style={{ fontWeight: 600, fontSize: '13px' }}>{selectedAgent.prompt.slice(0, 40)}</span>
              <span className={`conductor-agent-status ${selectedAgent.status}`} style={{ marginLeft: '8px' }}>{selectedAgent.status}</span>
              <button className="conductor-detail-close" onClick={() => setSelectedAgent(null)}>Back</button>
            </div>
            <div className="conductor-detail-content">
              {selectedAgent.reply ? (
                <div className="conductor-detail-reply">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedAgent.reply}</ReactMarkdown>
                </div>
              ) : (
                <p style={{ color: 'var(--text-3)', fontSize: '12px', padding: '20px', textAlign: 'center' }}>
                  {selectedAgent.status === 'running' ? 'Agent is working...' : 'No output yet.'}
                </p>
              )}
            </div>
            <div className="conductor-chat-input-full" onClick={e => e.stopPropagation()}>
              <input
                placeholder={`Message ${selectedAgent.prompt.slice(0, 20)}...`}
                value={actionInput[selectedAgent.id] || ''}
                onChange={e => setActionInput(prev => ({ ...prev, [selectedAgent.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { doAction(selectedAgent.id, 'input', actionInput[selectedAgent.id]); setActionInput(prev => ({ ...prev, [selectedAgent.id]: '' })); } }}
              />
              <button onClick={() => { doAction(selectedAgent.id, 'input', actionInput[selectedAgent.id] || ''); setActionInput(prev => ({ ...prev, [selectedAgent.id]: '' })); }}>Send</button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

export default ConductorPage;
