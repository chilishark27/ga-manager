import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function ChatPanel() {
  const { messages, sendMessage, activeInstance, clearChat, interruptChat, toggleInstance, setSelectedLLM: storeSetLLM, setSelectedIM, llmConfigs, fetchLLMs } = useStore();
  const { t, tf } = useI18n();
  const [input, setInput] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [showLLMSelect, setShowLLMSelect] = useState(false);
  const [showIMSelect, setShowIMSelect] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() && pastedImages.length === 0) return;
    sendMessage(input, pastedImages);
    setInput('');
    setPastedImages([]);
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
  };

  const currentLLM = activeInstance ? llmConfigs.find(c => c.index === activeInstance.llm_no) : null;

  const imChannels = [
    { id: '', name: t.imNone },
    { id: 'qq', name: t.imQQ, hint: t.imHintQQ },
    { id: 'telegram', name: t.imTelegram, hint: t.imHintTelegram },
    { id: 'discord', name: t.imDiscord, hint: t.imHintDiscord },
    { id: 'wechat', name: t.imWechat, hint: t.imHintWechat },
    { id: 'wecom', name: t.imWecom, hint: t.imHintWecom },
    { id: 'dingtalk', name: t.imDingtalk, hint: t.imHintDingtalk },
    { id: 'feishu', name: t.imFeishu, hint: t.imHintFeishu },
  ];

  // Welcome screen when no instance selected
  if (!activeInstance) {
    return (
      <div className="chat-panel">
        <div className="welcome-screen">
          <div className="welcome-icon">🤖</div>
          <h2>{t.welcomeTitle}</h2>
          <p>{t.welcomeDesc}</p>
          <div className="welcome-steps">
            <div className="welcome-step" dangerouslySetInnerHTML={{ __html: `<span class="step-num">1</span>${t.step1}` }} />
            <div className="welcome-step"><span className="step-num">2</span>{t.step2}</div>
            <div className="welcome-step"><span className="step-num">3</span>{t.step3}</div>
          </div>
          <button className="welcome-create-btn" onClick={() => {
            fetchLLMs();
            document.querySelector('.add-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }}>{t.createNow}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="ch-left">
          <span className={`ch-dot ${activeInstance.status === 'running' || activeInstance.status === 'busy' ? 'green' : 'gray'}`} />
          <span className="ch-name">{activeInstance.name}</span>
          <span className="ch-status">{activeInstance.status === 'running' || activeInstance.status === 'busy' ? t.statusRunning : t.statusStopped}</span>
        </div>
        <div className="ch-actions">
          {activeInstance.status !== 'running' && activeInstance.status !== 'busy' && (
            <button className="ch-btn" onClick={() => toggleInstance(activeInstance.id)}>{t.resume}</button>
          )}
          <button className="ch-btn" onClick={clearChat}>{t.newChat}</button>
          {(activeInstance.status === 'running' || activeInstance.status === 'busy') && (
            <button className="ch-btn danger" onClick={interruptChat}>{t.interrupt}</button>
          )}
          <button className="ch-btn" onClick={() => { fetchLLMs(); setShowLLMSelect(true); }}>
            🤖 {currentLLM ? currentLLM.name : 'LLM'}
          </button>
          <button className="ch-btn" onClick={() => setShowIMSelect(true)}>
            📡 {activeInstance.im_channel || t.noIM}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.map((msg, idx) => (
          <div key={idx} className={`msg ${msg.role}`}>
            <div className="msg-bubble">
              {msg.images && msg.images.length > 0 && (
                <div className="msg-images">
                  {msg.images.map((img: string, i: number) => (
                    <img key={i} src={img} alt="" className="msg-img-thumb" />
                  ))}
                </div>
              )}
              {msg.role === 'agent' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
            {msg.status === 'error' && <span className="msg-error">{t.sendFailed}</span>}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="input-area">
        {/* Image Preview */}
        {pastedImages.length > 0 && (
          <div className="image-preview-row">
            {pastedImages.map((img, idx) => (
              <div key={idx} className="img-preview-item">
                <img src={img} alt="" />
                <span className="img-remove" onClick={() => setPastedImages(prev => prev.filter((_, i) => i !== idx))}>✕</span>
              </div>
            ))}
          </div>
        )}
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
        <div className="input-hints">
          <span>{pastedImages.length > 0 ? tf('pastedCount', { n: pastedImages.length }) : t.supportPaste}</span>
          <span style={{marginLeft:'auto', color:'var(--accent2)'}}>{currentLLM ? `${currentLLM.name} (mixin #${currentLLM.index})` : t.llmNotConfigured}</span>
        </div>
      </div>

      {/* LLM Select Modal */}
      {showLLMSelect && (
        <div className="modal-overlay" onClick={() => setShowLLMSelect(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{tf('selectLLMModel', { current: currentLLM?.name || '-' })}</h3>
            <div className="llm-select-grid">
              {llmConfigs.map(cfg => (
                <div
                  key={cfg.index}
                  className={`llm-select-item ${activeInstance.llm_no === cfg.index ? 'active' : ''}`}
                  onClick={() => { storeSetLLM(activeInstance.id, cfg.index); setShowLLMSelect(false); }}
                >
                  <span className="llm-select-name">{cfg.name}</span>
                  <span className="llm-select-type">{cfg.type}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowLLMSelect(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      {/* IM Select Modal */}
      {showIMSelect && (
        <div className="modal-overlay" onClick={() => setShowIMSelect(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{tf('selectIMChannel', { current: activeInstance.im_channel || t.imNone })}</h3>
            <div className="im-channel-list">
              {imChannels.map(ch => (
                <div
                  key={ch.id}
                  className={`im-channel-item ${activeInstance.im_channel === ch.id ? 'active' : ''}`}
                  onClick={() => { setSelectedIM(activeInstance.id, ch.id); setShowIMSelect(false); }}
                >
                  <span className="im-ch-name">{ch.name}</span>
                  {ch.hint && <span className="im-ch-hint">{ch.hint}</span>}
                </div>
              ))}
            </div>
            <p className="im-config-tip">{t.imConfigTip}</p>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowIMSelect(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast-msg">{toast}</div>}
    </div>
  );
}

export default ChatPanel;
