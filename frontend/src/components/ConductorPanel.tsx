import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

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

export default function ConductorPanel() {
  const [status, setStatus] = useState<'stopped' | 'running' | 'loading'>('loading');
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [actionInput, setActionInput] = useState<Record<string, string>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    checkStatus();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  const checkStatus = async () => {
    try {
      const r = await fetch(`${API}/status`);
      const d = await r.json();
      setStatus(d.status === 'running' ? 'running' : 'stopped');
      if (d.status === 'running') connectWs();
    } catch { setStatus('stopped'); }
  };

  const startConductor = async () => {
    setStatus('loading');
    const activeInst = useStore.getState().activeInstance();
    const r = await fetch(`${API}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llm_no: activeInst?.llm_no || 0 }) });
    const d = await r.json();
    if (d.status === 'running') {
      setStatus('running');
      connectWs();
    } else {
      setStatus('stopped');
    }
  };

  const stopConductor = async () => {
    await fetch(`${API}/stop`, { method: 'POST' });
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
        }
      } catch {}
    };
    ws.onclose = () => { wsRef.current = null; };
    wsRef.current = ws;
  };

  const createSubagent = async () => {
    if (!newPrompt.trim()) return;
    await fetch(`${API}/subagents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: newPrompt }),
    });
    setNewPrompt('');
  };

  const doAction = async (sid: string, action: string, msg?: string) => {
    await fetch(`${API}/subagents/${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, msg: msg || '' }),
    });
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: chatInput, role: 'user' }),
    });
    setChatInput('');
  };

  if (status === 'loading') return <div className="conductor-loading">Loading...</div>;

  if (status === 'stopped') {
    return (
      <div className="conductor-stopped">
        <p>Conductor is not running</p>
        <button className="conductor-start-btn" onClick={startConductor}>Start Conductor</button>
        <p className="conductor-hint">Multi-agent orchestrator on port 8900</p>
      </div>
    );
  }

  return (
    <div className="conductor-panel">
      {/* Header */}
      <div className="conductor-header">
        <span className="conductor-status-dot" />
        <span>Conductor</span>
        <span className="conductor-count">{subagents.length} agents</span>
        <button className="conductor-stop-btn" onClick={stopConductor}>Stop</button>
      </div>

      {/* Create Subagent */}
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

      {/* Subagent Cards */}
      <div className="conductor-agents">
        {subagents.map(sa => (
          <div key={sa.id} className={`conductor-agent-card ${sa.status}`}>
            <div className="conductor-agent-header">
              <span className={`conductor-agent-dot ${sa.status}`} />
              <span className="conductor-agent-id">{sa.id.slice(0, 6)}</span>
              <span className={`conductor-agent-status ${sa.status}`}>{sa.status}</span>
            </div>
            <div className="conductor-agent-prompt">{sa.prompt.slice(0, 80)}{sa.prompt.length > 80 ? '...' : ''}</div>
            {sa.reply && <div className="conductor-agent-reply">{sa.reply.slice(0, 120)}{sa.reply.length > 120 ? '...' : ''}</div>}
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
        ))}
      </div>

      {/* Chat */}
      <div className="conductor-chat">
        <div className="conductor-chat-messages">
          {chat.slice(-20).map(m => (
            <div key={m.id} className={`conductor-chat-msg ${m.role}`}>
              <span className="conductor-chat-role">{m.role}</span>
              <span className="conductor-chat-text">{m.msg}</span>
            </div>
          ))}
        </div>
        <div className="conductor-chat-input">
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
