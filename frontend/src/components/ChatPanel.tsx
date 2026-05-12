import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';

function ChatPanel() {
  const { messages, sendMessage, activeInstance, clearChat, interruptChat, toggleInstance, setShowLLMSelector, showLLMSelector, switchLLM, toast, llmConfigs, fetchLLMs, showIMSelector, setShowIMSelector, setIMChannel, createInstance } = useStore();
  const inst = activeInstance();
  const [input, setInput] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchLLMs();
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target?.result as string;
          if (base64) {
            setPastedImages(prev => [...prev, base64]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeImage = (idx: number) => {
    setPastedImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = () => {
    if (!input.trim() && pastedImages.length === 0) return;
    sendMessage(input.trim(), pastedImages.length > 0 ? pastedImages : undefined);
    setInput('');
    setPastedImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!inst) {
    return (
      <div className="main">
        <div className="empty-state">
          <img src="/app.png" alt="GA" className="empty-logo" />
          <h2 className="empty-title">欢迎使用 GA Manager</h2>
          <p className="empty-desc">创建一个 Agent 实例，开始智能对话与自动化任务</p>
          <div className="empty-steps">
            <div className="step-item">
              <span className="step-num">1</span>
              <span>点击左侧 <strong>+ 新建实例</strong> 或下方按钮</span>
            </div>
            <div className="step-item">
              <span className="step-num">2</span>
              <span>选择 LLM 模型（如 Claude、GPT）</span>
            </div>
            <div className="step-item">
              <span className="step-num">3</span>
              <span>开始对话，启用自主行动、定时任务等功能</span>
            </div>
          </div>
          <button className="empty-create-btn" onClick={() => createInstance({ name: '新实例' })}>
            🚀 立即创建实例
          </button>
        </div>
      </div>
    );
  }

  const currentLLM = llmConfigs.find(c => c.index === inst.llm_no);

  return (
    <div className="main">
      <div className="topbar">
        <h3>{inst.name}</h3>
        <span className="badge">{(inst.status === 'running' || inst.status === 'busy' || inst.status === 'starting') ? '运行中' : '已停止'}</span>
        <div className="spacer" />
        <button onClick={() => toggleInstance(inst.id)} title="恢复/启动实例">
          ▶ 恢复
        </button>
        <button onClick={() => clearChat()} title="清空当前对话历史">
          🔄 新对话
        </button>
        <button onClick={() => setShowLLMSelector(!showLLMSelector)} title="切换LLM模型">
          🧠 {currentLLM ? currentLLM.name : `LLM #${inst.llm_no}`}
        </button>
        <button onClick={() => interruptChat(inst.id)} title="中断当前Agent执行">
          ⏹ 中断
        </button>
        <button onClick={() => setShowIMSelector(!showIMSelector)} title="设置IM渠道">
          📡 {inst.im_channel || '无IM'}
        </button>
      </div>

      {/* LLM Selector Dropdown */}
      {showLLMSelector && (
        <div className="llm-selector">
          <div className="llm-selector-title">选择LLM模型 (当前: {currentLLM ? currentLLM.name : `#${inst.llm_no}`})</div>
          <div className="llm-grid">
            {llmConfigs.length > 0 ? llmConfigs.map(cfg => (
              <div
                key={cfg.index}
                className={`llm-option ${cfg.index === inst.llm_no ? 'active' : ''}`}
                onClick={() => switchLLM(inst.id, cfg.index)}
                title={`${cfg.type} | ${cfg.key}`}
              >
                <span className="llm-name">{cfg.name}</span>
                <span className="llm-type">{cfg.type}</span>
              </div>
            )) : (
              <div className="llm-option">加载中...</div>
            )}
          </div>
        </div>
      )}

      {/* IM Channel Selector Dropdown */}
      {showIMSelector && (
        <div className="llm-selector">
          <div className="llm-selector-title">选择IM渠道 (当前: {inst.im_channel || '无'})</div>
          <div className="llm-grid">
            {[
              { ch: '', name: '无(仅Web)', hint: '' },
              { ch: 'qq', name: 'QQ', hint: '需配置: go-cqhttp地址 + QQ号' },
              { ch: 'telegram', name: 'Telegram', hint: '需配置: Bot Token (从@BotFather获取)' },
              { ch: 'discord', name: 'Discord', hint: '需配置: Bot Token + Channel ID' },
              { ch: 'wechat', name: '微信', hint: '需配置: itchat扫码登录' },
              { ch: 'wecom', name: '企业微信', hint: '需配置: CorpID + AgentID + Secret' },
              { ch: 'dingtalk', name: '钉钉', hint: '需配置: AppKey + AppSecret + 机器人Webhook' },
              { ch: 'feishu', name: '飞书', hint: '需配置: App ID + App Secret + 事件回调' },
            ].map(item => (
              <div
                key={item.ch}
                className={`llm-option ${item.ch === (inst.im_channel || '') ? 'active' : ''}`}
                onClick={() => setIMChannel(inst.id, item.ch)}
                title={item.hint}
              >
                <span className="llm-name">{item.name}</span>
                {item.hint && <span className="llm-type" style={{fontSize:'11px'}}>{item.hint}</span>}
              </div>
            ))}
          </div>
          {inst.im_channel && (
            <div style={{padding:'8px 12px', fontSize:'12px', color:'var(--accent2)', borderTop:'1px solid var(--border)'}}>
              💡 提示：请在GA项目的 mykey.py 中配置对应渠道的密钥信息，然后重启实例生效。
            </div>
          )}
        </div>
      )}

      {/* Chat Messages */}
      <div className="chat-area" ref={chatRef}>
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="icon">🤖</div>
            <div className="text">与 {inst.name} 开始对话</div>
            <div className="hint">输入消息或使用快捷操作</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role}`}>
            <div className="msg-content">
              {msg.images && msg.images.length > 0 && (
                <div className="msg-images">
                  {msg.images.map((img, idx) => (
                    <img key={idx} src={img} alt={`图片 ${idx + 1}`} className="msg-image" />
                  ))}
                </div>
              )}
              {msg.role === 'agent' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
            {msg.status === 'error' && <span className="msg-error">发送失败</span>}
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div className="input-area">
        {/* Image Preview */}
        {pastedImages.length > 0 && (
          <div className="image-preview-row">
            {pastedImages.map((img, idx) => (
              <div key={idx} className="image-preview-item">
                <img src={img} alt={`粘贴图片 ${idx + 1}`} />
                <button className="image-remove-btn" onClick={() => removeImage(idx)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <input
            ref={inputRef}
            type="text"
            placeholder="输入消息... (Ctrl+V 粘贴图片)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <button className="send-btn" onClick={handleSend}>发送</button>
        </div>
        <div className="input-hints">
          <span>🖼️ {pastedImages.length > 0 ? `已粘贴 ${pastedImages.length} 张图片` : '支持粘贴图片'}</span>
          <span style={{marginLeft:'auto', color:'var(--accent2)'}}>{currentLLM ? `${currentLLM.name} (mixin #${currentLLM.index})` : 'LLM 未配置'}</span>
        </div>
      </div>

      {/* Toast */}
      {toast && <div className="toast-msg">{toast}</div>}
    </div>
  );
}

export default ChatPanel;
