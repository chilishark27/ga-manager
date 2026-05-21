import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

export default function TodoPanel() {
  const { todos, addTodo, toggleTodo, deleteTodo, archiveDone, messages, activeInstanceId, sendMessage, fetchTodos, setPage, instances, toggleInstance } = useStore();
  const { lang } = useI18n();
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState(() => {
    const saved = localStorage.getItem('ga_todo_pos');
    return saved ? JSON.parse(saved) : { x: -1, y: -1 };
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showExecMenu, setShowExecMenu] = useState(false);

  useEffect(() => {
    if (pos.x === -1 && pos.y === -1) {
      setPos({ x: window.innerWidth - 280, y: window.innerHeight - 300 });
    }
    fetchTodos();
  }, []);

  // Auto-detect tasks from agent messages
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'agent' || !last.content) return;
    const lines = last.content.split('\n');
    const todoPatterns = /^[\s]*[-*]\s*(TODO|待办|需要|记得|别忘了|接下来|下一步)[：:]\s*(.+)/i;
    const found: string[] = [];
    for (const line of lines) {
      const m = line.match(todoPatterns);
      if (m && m[2]) {
        const text = m[2].trim();
        if (text.length > 2 && text.length < 100 && !todos.some(t => t.text === text)) {
          found.push(text);
        }
      }
    }
    if (found.length > 0) setSuggestions(found);
  }, [messages.length]);

  const pending = todos.filter(t => !t.done);
  const done = todos.filter(t => t.done);

  // Auto-archive completed tasks after 10 seconds
  useEffect(() => {
    if (done.length === 0 || pending.length > 0) return;
    const timer = setTimeout(() => { archiveDone(); }, 10000);
    return () => clearTimeout(timer);
  }, [done.length, pending.length]);

  // Auto-mark tasks as done when Agent reports completion
  useEffect(() => {
    if (messages.length === 0 || pending.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'agent' || !last.content) return;
    const content = last.content.toLowerCase();
    const doneKeywords = ['已完成', '完成了', '已执行', '任务完成', 'done', 'completed', 'finished', 'task complete'];
    if (!doneKeywords.some(k => content.includes(k))) return;
    for (const t of pending) {
      const words = t.text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      if (content.includes(t.text.toLowerCase()) || (words.length > 0 && words.every(w => content.includes(w)))) {
        toggleTodo(t.id);
      }
    }
  }, [messages.length]);

  const handleAdd = () => {
    const text = input.trim();
    if (!text) return;
    addTodo(text, 'manual');
    setInput('');
  };

  const acceptSuggestion = (text: string) => {
    addTodo(text, 'agent');
    setSuggestions(prev => prev.filter(s => s !== text));
  };

  const dismissSuggestion = (text: string) => {
    setSuggestions(prev => prev.filter(s => s !== text));
  };

  const executeAll = async (mode: 'chat' | 'auto' | 'hive') => {
    if (pending.length === 0) return;
    const taskList = pending.map(t => t.text).join('\n- ');

    if (mode === 'hive') {
      // Directly start Hive mode via API
      try {
        const res = await fetch('/api/hive/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objective: `完成以下任务:\n- ${taskList}`,
            budget_minutes: 30,
            workers: Math.min(pending.length, 3),
          }),
        });
        if (res.ok) {
          setPage('hive');
        }
      } catch {}
    } else {
      // Need a running instance
      if (!activeInstanceId) return;
      const inst = instances.find(i => i.id === activeInstanceId);
      if (inst && inst.status === 'stopped') {
        await toggleInstance(activeInstanceId);
        await new Promise(r => setTimeout(r, 3000));
      }
      if (mode === 'chat') {
        sendMessage(`请完成以下任务:\n- ${taskList}`);
      } else if (mode === 'auto') {
        sendMessage(`请依次自主完成以下任务:\n- ${taskList}`);
      }
    }
    setShowExecMenu(false);
  };

  const handleArchive = () => {
    if (done.length === 0) return;
    if (activeInstanceId) {
      const doneList = done.map(t => t.text).join('\n- ');
      sendMessage(`以下任务已完成，请归档总结:\n- ${doneList}`);
    }
    archiveDone();
  };

  // Drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.origY + dy));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (pos.x >= 0) localStorage.setItem('ga_todo_pos', JSON.stringify(pos));
  }, [pos]);

  const isZh = lang === 'zh';

  return (
    <div
      ref={widgetRef}
      className={`todo-widget ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
    >
      <div className="todo-widget-header" onMouseDown={onMouseDown} onClick={() => !dragging && setCollapsed(!collapsed)}>
        <span className="todo-widget-dot" />
        <span className="todo-widget-title">{isZh ? '待办事项' : 'Todos'}</span>
        {pending.length > 0 && <span className="todo-widget-badge">{pending.length}</span>}
        <span className="todo-widget-chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <>
          {suggestions.length > 0 && (
            <div className="todo-widget-suggestions">
              {suggestions.map((s, i) => (
                <div key={i} className="todo-widget-suggest">
                  <span className="todo-suggest-text">{s}</span>
                  <span className="todo-suggest-add" onClick={() => acceptSuggestion(s)}>+</span>
                  <span className="todo-suggest-dismiss" onClick={() => dismissSuggestion(s)}>×</span>
                </div>
              ))}
            </div>
          )}
          <div className="todo-widget-list">
            {pending.map(t => (
              <div key={t.id} className="todo-widget-item">
                <input type="checkbox" className="todo-checkbox" checked={false} onChange={() => toggleTodo(t.id)} />
                <span className="todo-widget-text" title={t.text}>{t.text}</span>
                <span className="todo-widget-del" onClick={() => deleteTodo(t.id)}>×</span>
              </div>
            ))}
            {done.map(t => (
              <div key={t.id} className="todo-widget-item done">
                <input type="checkbox" className="todo-checkbox" checked={true} onChange={() => toggleTodo(t.id)} />
                <span className="todo-widget-text">{t.text}</span>
                <span className="todo-widget-del" onClick={() => deleteTodo(t.id)}>×</span>
              </div>
            ))}
          </div>
          <div className="todo-widget-input">
            <input
              placeholder={isZh ? '添加任务...' : 'Add task...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          {(pending.length > 0 || done.length > 0) && (
            <div className="todo-widget-actions">
              {pending.length > 0 && (
                <div className="todo-exec-wrapper">
                  <button className="todo-exec-btn" onClick={() => setShowExecMenu(!showExecMenu)}>
                    {isZh ? '▶ 执行' : '▶ Run'}
                  </button>
                  {showExecMenu && (
                    <div className="todo-action-menu">
                      <div className="todo-action-item" onClick={() => executeAll('chat')}>{isZh ? '发送给 Agent' : 'Send to Agent'}</div>
                      <div className="todo-action-item" onClick={() => executeAll('auto')}>{isZh ? '自主执行' : 'Auto Execute'}</div>
                      <div className="todo-action-item" onClick={() => executeAll('hive')}>{isZh ? 'Hive 协作' : 'Hive Mode'}</div>
                    </div>
                  )}
                </div>
              )}
              {done.length > 0 && (
                <button className="todo-archive-btn" onClick={handleArchive}>
                  {isZh ? '归档已完成' : 'Archive Done'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
