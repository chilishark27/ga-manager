import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { cleanReply, foldTurns, SessionFile, parseSessionLog } from '../utils/chatUtils';

function ChatPage() {
  const {
    messages, sendMessage, activeInstance: getActiveInstance, clearChat, interruptChat,
    toggleInstance, toggleFeature, fetchLLMs, attachedPort, detachInstance,
    replayMode, setReplayMode, replaySessions, replaySteps, replayIndex,
    fetchReplaySessions, loadReplaySession, setReplayIndex,
  } = useStore();
  const { t, tf } = useI18n();
  const activeInstance = getActiveInstance();
  const [input, setInput] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [showSessionRestore, setShowSessionRestore] = useState(false);
  const [sessions, setSessions] = useState<SessionFile[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [inputHistory, setInputHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ga_input_history') || '[]'); } catch { return []; }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState('');

  const MAX_VISIBLE = 150;
  const [showAll, setShowAll] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() && pastedImages.length === 0) return;
    if (input.trim()) {
      const newHistory = [input.trim(), ...inputHistory.filter(h => h !== input.trim())].slice(0, 50);
      setInputHistory(newHistory);
      localStorage.setItem('ga_input_history', JSON.stringify(newHistory));
    }
    sendMessage(input, pastedImages);
    setInput('');
    setPastedImages([]);
    setHistoryIndex(-1);
    setDraftInput('');
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            setPastedImages(prev => [...prev, ev.target?.result as string]);
            showToast(tf('pasteImage', { n: pastedImages.length + 1 }));
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const textarea = e.target as HTMLTextAreaElement;
      if (textarea.selectionStart === 0 || input === '') {
        if (inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
          e.preventDefault();
          const newIdx = historyIndex + 1;
          if (historyIndex === -1) setDraftInput(input);
          setHistoryIndex(newIdx);
          setInput(inputHistory[newIdx]);
        }
      }
    }
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const textarea = e.target as HTMLTextAreaElement;
      if (textarea.selectionStart === input.length || input === '') {
        if (historyIndex > 0) {
          e.preventDefault();
          const newIdx = historyIndex - 1;
          setHistoryIndex(newIdx);
          setInput(inputHistory[newIdx]);
        } else if (historyIndex === 0) {
          e.preventDefault();
          setHistoryIndex(-1);
          setInput(draftInput);
        }
      }
    }
  };

  const fetchSessions = async () => {
    if (!activeInstance) return;
    setSessionsLoading(true);
    try {
      const res = await fetch(`/api/instances/${activeInstance.id}/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data || []);
      }
    } catch { /* ignore */ }
    setSessionsLoading(false);
  };

  const restoreSession = async (filename: string) => {
    if (!activeInstance) return;
    try {
      const res = await fetch(`/api/instances/${activeInstance.id}/sessions/${encodeURIComponent(filename)}`);
      if (res.ok) {
        const text = await res.text();
        const msgs = parseSessionLog(text);
        if (msgs.length > 0) {
          useStore.setState({
            messages: msgs.map(m => ({ role: m.role, content: m.content, status: 'done' as const }))
          });
          showToast(`Restored ${msgs.length} messages`);
        } else {
          showToast('No messages parsed');
        }
      }
    } catch { showToast('Restore failed'); }
    setShowSessionRestore(false);
  };

  const toggleTurn = (key: string) => {
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Welcome screen when no instance selected
  if (!activeInstance && attachedPort) {
    return (
      <div className="chat-page">
        <div className="attached-ga-header">
          <span>External GA (Port {attachedPort})</span>
          <button className="detach-btn" onClick={detachInstance}>Detach</button>
        </div>
        <iframe
          className="attached-ga-iframe"
          src={`http://localhost:${attachedPort}`}
          title={`GA :${attachedPort}`}
        />
      </div>
    );
  }

  if (!activeInstance) {
    return (
      <div className="chat-page">
        <div className="welcome-screen">
          <img className="welcome-icon" src="/chilishark.png" alt="chilishark" />
          <h2>{t.welcomeTitle}</h2>
          <p>{t.welcomeDesc}</p>
          <div className="welcome-steps">
            <div className="welcome-step" dangerouslySetInnerHTML={{ __html: `<span class="step-num">1</span>${t.step1}` }} />
            <div className="welcome-step"><span className="step-num">2</span>{t.step2}</div>
            <div className="welcome-step"><span className="step-num">3</span>{t.step3}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      {/* Chat toolbar */}
      <div className="chat-toolbar">
        <button className="ch-btn" onClick={clearChat}>{t.newChat}</button>
        {(activeInstance.status === 'running' || activeInstance.status === 'busy') && (
          <button className="ch-btn danger" onClick={() => interruptChat(activeInstance.id)}>{t.interrupt}</button>
        )}
        <button className="ch-btn" onClick={() => { fetchSessions(); setShowSessionRestore(true); }}>Sessions</button>
        <button className={`ch-btn ${replayMode ? 'active' : ''}`} onClick={() => {
          if (!replayMode && activeInstance) { fetchReplaySessions(activeInstance.id); }
          setReplayMode(!replayMode);
        }}>Replay</button>
      </div>

      {/* Replay Mode */}
      {replayMode && (
        <div className="replay-panel">
          <div className="replay-header">
            <select className="replay-session-select" onChange={e => { if (e.target.value && activeInstance) loadReplaySession(activeInstance.id, e.target.value); }}>
              <option value="">Select session...</option>
              {replaySessions.map((s: any) => (
                <option key={s.filename} value={s.filename}>{s.filename.replace('model_responses_', '').replace('.txt', '')} ({(s.size / 1024).toFixed(0)}K)</option>
              ))}
            </select>
            <div className="replay-controls">
              <button onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))} disabled={replayIndex <= 0}>&#8249;</button>
              <span>{replayIndex + 1} / {replaySteps.length || 1}</span>
              <button onClick={() => setReplayIndex(Math.min(replaySteps.length - 1, replayIndex + 1))} disabled={replayIndex >= replaySteps.length - 1}>&#8250;</button>
            </div>
          </div>
          <div className="replay-timeline">
            {replaySteps.map((step: any, i: number) => (
              <div key={i} className={`replay-step ${step.type} ${i === replayIndex ? 'active' : ''} ${i <= replayIndex ? 'visible' : ''}`} onClick={() => setReplayIndex(i)}>
                <div className="replay-step-marker">
                  <span className={`replay-dot ${step.type}`} />
                  <span className="replay-step-type">{step.type}{step.tool_name ? `: ${step.tool_name}` : ''}</span>
                  {step.timestamp && <span className="replay-step-time">{step.timestamp.split(' ')[1] || step.timestamp}</span>}
                </div>
                {i === replayIndex && (
                  <pre className="replay-step-content">{step.content}</pre>
                )}
              </div>
            ))}
            {replaySteps.length === 0 && <p style={{ color: 'var(--text-3)', padding: '20px', textAlign: 'center' }}>Select a session to replay</p>}
          </div>
        </div>
      )}

      {/* Messages */}
      {!replayMode && <div className="messages-area">
        {(() => {
          const totalCount = messages.length;
          const visibleMessages = (!showAll && totalCount > MAX_VISIBLE)
            ? messages.slice(totalCount - MAX_VISIBLE)
            : messages;
          const startIdx = (!showAll && totalCount > MAX_VISIBLE) ? totalCount - MAX_VISIBLE : 0;
          return (
            <>
              {!showAll && totalCount > MAX_VISIBLE && (
                <div className="load-more-bar">
                  <button className="load-more-btn" onClick={() => setShowAll(true)}>
                    Show all {totalCount} messages (showing last {MAX_VISIBLE})
                  </button>
                </div>
              )}
              {visibleMessages.map((msg, idx) => {
                if (msg.role === 'agent') {
                  const turns = foldTurns(msg.content);
                  if (turns && turns.length > 1) {
                    return (
                      <div key={startIdx + idx} className="msg agent">
                        <div className="msg-bubble msg-folded-container">
                          {turns.map((turn, ti) => {
                            const turnKey = `${startIdx + idx}-${ti}`;
                            const isExpanded = turn.isLast || expandedTurns.has(turnKey);
                            return (
                              <div key={ti} className={`turn-block ${isExpanded ? 'expanded' : 'collapsed'}`}>
                                {!turn.isLast && (
                                  <div className="turn-header" onClick={() => toggleTurn(turnKey)}>
                                    <span className="turn-chevron">{isExpanded ? '&#9662;' : '&#9656;'}</span>
                                    <span className="turn-label">Turn {turn.turnNumber}</span>
                                    {!isExpanded && <span className="turn-summary">{turn.summary}</span>}
                                  </div>
                                )}
                                {isExpanded && (
                                  <div className="turn-content">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {msg.status === 'error' && <span className="msg-error">{t.sendFailed}</span>}
                      </div>
                    );
                  }
                  return (
                    <div key={startIdx + idx} className="msg agent">
                      <div className="msg-bubble">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanReply(msg.content)}</ReactMarkdown>
                      </div>
                      {msg.status === 'error' && <span className="msg-error">{t.sendFailed}</span>}
                    </div>
                  );
                }
                return (
                  <div key={startIdx + idx} className="msg user">
                    <div className="msg-bubble">
                      {msg.images && msg.images.length > 0 && (
                        <div className="msg-images">
                          {msg.images.map((img: string, i: number) => (
                            <img key={i} src={img} alt="" className="msg-image" />
                          ))}
                        </div>
                      )}
                      {msg.content}
                    </div>
                    {msg.status === 'error' && <span className="msg-error">{t.sendFailed}</span>}
                  </div>
                );
              })}
            </>
          );
        })()}
        <div ref={messagesEndRef} />
      </div>}

      {/* Autonomous Action Panel */}
      {activeInstance && activeInstance.status !== 'stopped' && (
        <div className="autonomous-panel">
          <div
            className="autonomous-idle-btn"
            onClick={() => {
              if (!activeInstance.autonomous) {
                toggleFeature(activeInstance.id, 'autonomous');
              }
              sendMessage('[AUTO] Idle autonomous action triggered.');
            }}
          >
            Idle Auto
          </div>
          <div
            className={`autonomous-toggle-btn ${activeInstance.autonomous ? 'active' : ''}`}
            onClick={() => toggleFeature(activeInstance.id, 'autonomous')}
          >
            <span className="autonomous-icon">{activeInstance.autonomous ? '||' : '|>'}</span>
            <span>{activeInstance.autonomous ? 'Stop Auto' : 'Start Auto'}</span>
          </div>
          <div className="autonomous-status">
            <span className={`autonomous-status-dot ${activeInstance.autonomous ? 'active' : 'stopped'}`} />
            <span className="autonomous-status-text">
              {activeInstance.autonomous ? 'Autonomous ON' : 'Autonomous OFF'}
            </span>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="input-area">
        <div className="ga-status-bar">
          <span className={`ga-status-dot ${activeInstance.status === 'busy' ? 'busy' : activeInstance.status === 'running' ? 'idle' : 'off'}`} />
          <span className="ga-status-text">
            {activeInstance.status === 'busy' ? 'GA processing...' : activeInstance.status === 'running' ? 'GA idle' : 'GA stopped'}
          </span>
        </div>
        {pastedImages.length > 0 && (
          <div className="image-preview-row">
            {pastedImages.map((img, idx) => (
              <div key={idx} className="img-preview-item">
                <img src={img} alt="" />
                <span className="img-remove" onClick={() => setPastedImages(prev => prev.filter((_, i) => i !== idx))}>x</span>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <textarea
            className="chat-input"
            placeholder={t.inputPlaceholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button className="send-btn" onClick={handleSend} disabled={!input.trim() && pastedImages.length === 0}>{t.send}</button>
          {activeInstance.status === 'busy' && (
            <button className="interrupt-btn" onClick={() => interruptChat(activeInstance.id)}>Stop</button>
          )}
        </div>
        <div className="input-hints">
          <span>{pastedImages.length > 0 ? tf('pastedCount', { n: pastedImages.length }) : t.supportPaste}</span>
        </div>
      </div>

      {/* Session Restore Modal */}
      {showSessionRestore && (
        <div className="modal-overlay" onClick={() => setShowSessionRestore(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Sessions</h3>
            {sessionsLoading ? (
              <p style={{textAlign:'center'}}>Loading...</p>
            ) : sessions.length === 0 ? (
              <p style={{textAlign:'center', color:'var(--text-dim)'}}>No sessions available</p>
            ) : (
              <div className="session-list">
                {sessions.map(s => (
                  <div key={s.name} className="session-item" onClick={() => restoreSession(s.name)}>
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">{s.modified} - {(s.size / 1024).toFixed(1)}KB</span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowSessionRestore(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast-msg">{toast}</div>}
    </div>
  );
}

export default ChatPage;
