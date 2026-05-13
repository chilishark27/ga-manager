import { create } from 'zustand';
import { Instance, ChatMessage, LLMConfig } from '../types';

const API_BASE = '/api';

// Chat message persistence helpers
const MSG_STORAGE_PREFIX = 'ga_chat_';
const MAX_STORED_MESSAGES = 200;

function saveMessages(instanceId: string, messages: ChatMessage[]) {
  try {
    // Only save non-streaming messages, limit count
    const toSave = messages
      .filter(m => m.status !== 'streaming')
      .slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(MSG_STORAGE_PREFIX + instanceId, JSON.stringify(toSave));
  } catch { /* quota exceeded — silently ignore */ }
}

function loadMessages(instanceId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MSG_STORAGE_PREFIX + instanceId);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted — ignore */ }
  return [];
}

function clearStoredMessages(instanceId: string) {
  localStorage.removeItem(MSG_STORAGE_PREFIX + instanceId);
}

// WebSocket connection manager
let ws: WebSocket | null = null;
let wsInstanceId: string | null = null;

function getWsUrl(instanceId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/instances/${instanceId}/ws`;
}

interface AppState {
  // Setup / Configuration
  configured: boolean;
  checkConfigured: () => Promise<void>;
  setConfigured: (v: boolean) => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Instances
  instances: Instance[];
  activeInstanceId: string | null;
  fetchInstances: () => Promise<void>;
  selectInstance: (id: string) => void;
  toggleInstance: (id: string) => void;
  restartInstance: (id: string) => Promise<void>;
  createInstance: (data: Partial<Instance>) => Promise<void>;

  // Instance feature toggles
  toggleFeature: (id: string, feature: 'autonomous' | 'reflect' | 'scheduler' | 'team_worker') => Promise<void>;
  setStringConfig: (id: string, key: 'goal' | 'peer_hint', value: string) => Promise<void>;
  switchLLM: (id: string, llmNo: number) => Promise<void>;
  setIMChannel: (id: string, channel: string) => Promise<void>;
  showIMSelector: boolean;
  setShowIMSelector: (v: boolean) => void;

  // LLM configs
  llmConfigs: LLMConfig[];
  fetchLLMs: () => Promise<void>;

  // Chat (WebSocket-based)
  messages: ChatMessage[];
  wsConnected: boolean;
  connectWs: (instanceId: string) => void;
  disconnectWs: () => void;
  sendMessage: (content: string, images?: string[]) => void;
  clearChat: () => void;
  interruptChat: (id: string) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;

  // UI state
  showLLMSelector: boolean;
  setShowLLMSelector: (v: boolean) => void;
  toast: string | null;
  showToast: (msg: string) => void;

  // Resources
  resources: { type: string; usage: number; detail: string }[];
  fetchResources: (id: string) => Promise<void>;

  // Schedules
  schedules: any[];
  fetchSchedules: (id: string) => Promise<void>;
  addSchedule: (id: string, cron: string, task: string) => Promise<void>;
  deleteSchedule: (instanceId: string, scheduleId: string) => Promise<void>;

  // Actions
  exportChat: (id: string) => void;
  sendCommand: (id: string, cmd: string) => Promise<void>;
  forwardMessage: (fromId: string, toId: string, message: string) => Promise<void>;

  // Batch
  batchAction: (action: string, instanceIds: string[]) => Promise<void>;

  // Sophub
  sophubQuery: string;
  sophubResults: any[];
  sophubLoading: boolean;
  searchSophub: (query: string) => Promise<void>;
  downloadSop: (sopId: string, instanceId?: string) => Promise<void>;

  // Computed helpers
  activeInstance: () => Instance | null;
  runningCount: () => number;
  totalTokens: () => string;
  healthPercent: () => string;
}

export const useStore = create<AppState>((set, get) => ({
  configured: false,
  checkConfigured: async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      if (res.ok) {
        const data = await res.json();
        set({ configured: !!data.ga_root });
      }
    } catch { /* not configured */ }
  },
  setConfigured: (v: boolean) => set({ configured: v }),

  theme: 'dark',
  toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  instances: [],
  activeInstanceId: null,

  fetchInstances: async () => {
    try {
      const res = await fetch(`${API_BASE}/instances`);
      if (res.ok) {
        const raw = await res.json();
        // Map backend fields to frontend Instance type
        const instances: Instance[] = (raw || []).map((r: any) => ({
          id: r.id || '',
          name: r.name || '',
          status: r.state || r.status || 'stopped',
          pid: r.pid || 0,
          llm_no: r.llm_no || 0,
          autonomous: r.autonomous || false,
          goal: r.goal || '',
          reflect: r.reflect || false,
          scheduler: r.scheduler || false,
          team_worker: r.team_worker || false,
          uptime: r.uptime || '0',
          tokens_used: r.tokens_used || r.total_turns || 0,
          health: (r.state === 'running' || r.state === 'busy' || r.state === 'starting') ? 'healthy' : 'error',
          mode: r.mode || (r.autonomous ? 'Goal' : 'Web'),
          im_channel: r.im_channel || '',
        }));
        // Auto-select first instance if none selected
        const currentId = get().activeInstanceId;
        const shouldSelect = !currentId || !instances.find(i => i.id === currentId);
        if (shouldSelect && instances.length > 0) {
          const newId = instances[0].id;
          const cached = loadMessages(newId);
          set({ instances, activeInstanceId: newId, messages: cached });
        } else {
          set({ instances });
        }
        // Auto-connect WS for the selected running instance
        if (shouldSelect && instances.length > 0 && instances[0].status === 'running') {
          get().connectWs(instances[0].id);
        } else if (!shouldSelect && currentId) {
          const current = instances.find(i => i.id === currentId);
          if (current && current.status === 'running' && (!ws || ws.readyState !== WebSocket.OPEN)) {
            get().connectWs(currentId);
          }
        }
      }
    } catch {
      // Network error - keep existing state
    }
  },

  selectInstance: (id: string) => {
    // Save current instance's messages before switching
    const prevId = get().activeInstanceId;
    if (prevId && prevId !== id) {
      saveMessages(prevId, get().messages);
    }
    // Load cached messages for the new instance
    const cached = loadMessages(id);
    set({ activeInstanceId: id, messages: cached });
    // Always connect WebSocket when selecting an instance
    get().connectWs(id);
  },

  toggleInstance: async (id: string) => {
    const inst = get().instances.find(i => i.id === id);
    if (!inst) return;
    const action = inst.status === 'running' ? 'stop' : 'start';
    try {
      await fetch(`${API_BASE}/instances/${id}/${action}`, { method: 'POST' });
      await get().fetchInstances();
    } catch {
      get().showToast(`${action} 失败`);
    }
  },

  restartInstance: async (id: string) => {
    try {
      get().showToast('正在重启...');
      await fetch(`${API_BASE}/instances/${id}/stop`, { method: 'POST' });
      // Wait briefly for process cleanup
      await new Promise(r => setTimeout(r, 1000));
      await fetch(`${API_BASE}/instances/${id}/start`, { method: 'POST' });
      await get().fetchInstances();
      get().showToast('✅ 重启完成');
    } catch {
      get().showToast('❌ 重启失败');
    }
  },

  createInstance: async (data) => {
    try {
      await fetch(`${API_BASE}/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await get().fetchInstances();
    } catch {
      // ignore
    }
  },

  moveInstance: (id: string, direction: number) => {
    const { instances } = get();
    const idx = instances.findIndex(i => i.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= instances.length) return;
    const newList = [...instances];
    [newList[idx], newList[newIdx]] = [newList[newIdx], newList[idx]];
    set({ instances: newList });
  },

  messages: [],
  wsConnected: false,

  connectWs: (instanceId: string) => {
    // Disconnect existing connection if switching instances
    if (ws && wsInstanceId !== instanceId) {
      ws.close();
      ws = null;
      wsInstanceId = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) return; // Already connected

    // Clear stale ws reference so sendMessage's setInterval can detect new connection
    if (ws && ws.readyState !== WebSocket.OPEN) {
      ws = null;
    }

    const url = getWsUrl(instanceId);
    const socket = new WebSocket(url);
    wsInstanceId = instanceId;

    socket.onopen = () => {
      ws = socket;
      set({ wsConnected: true });
    };

    socket.onmessage = (evt) => {
      try {
        console.log('[WS_DEBUG] raw message:', evt.data);
        const data = JSON.parse(evt.data);
        const event = data.event || data.type;
        console.log('[WS_DEBUG] parsed event:', event, 'text:', data.text);

        if (event === 'reply_chunk' || event === 'next') {
          // Streaming partial — update or append agent message
          const rawText = data.text || '';
          // Extract actual content: strip thinking prefix like "**LLM Running (Turn N) ...**\n\n"
          // and strip <summary>...</summary> tags and code fences like [Info]...
          let text = rawText
            .replace(/^\s*\*\*LLM Running[^*]*\*\*\s*/g, '')
            .replace(/<summary>[\s\S]*?<\/summary>\s*/g, '')
            .replace(/`{3,}\s*\[Info\][^\n]*\n?/g, '')
            .replace(/`{3,}\s*$/g, '')
            .trim();

          if (!text) {
            // Only thinking prefix, no real content yet — show typing indicator
            set(state => {
              const msgs = [...state.messages];
              const lastMsg = msgs[msgs.length - 1];
              if (!(lastMsg && lastMsg.role === 'agent' && lastMsg.status === 'streaming')) {
                msgs.push({ role: 'agent', content: '⏳ 思考中...', timestamp: Date.now(), status: 'streaming' });
              }
              return { messages: msgs };
            });
          } else {
            // Real content available
            set(state => {
              const msgs = [...state.messages];
              const lastMsg = msgs[msgs.length - 1];
              if (lastMsg && lastMsg.role === 'agent' && lastMsg.status === 'streaming') {
                msgs[msgs.length - 1] = { ...lastMsg, content: text };
              } else {
                msgs.push({ role: 'agent', content: text, timestamp: Date.now(), status: 'streaming' });
              }
              return { messages: msgs };
            });
          }
        } else if (event === 'reply_done' || event === 'done') {
          // Final response — strip thinking prefix same as streaming
          const rawText = data.text || '';
          let text = rawText
            .replace(/^\s*\*\*LLM Running[^*]*\*\*\s*/g, '')
            .replace(/<summary>[\s\S]*?<\/summary>\s*/g, '')
            .replace(/`{3,}\s*\[Info\][^\n]*\n?/g, '')
            .replace(/`{3,}\s*$/g, '')
            .trim();
          set(state => {
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'agent' && lastMsg.status === 'streaming') {
              msgs[msgs.length - 1] = { ...lastMsg, content: text || lastMsg.content, status: 'done' as const };
            } else {
              msgs.push({ role: 'agent' as const, content: text, timestamp: Date.now(), status: 'done' as const });
            }
            // Persist after receiving final reply
            if (wsInstanceId) saveMessages(wsInstanceId, msgs);
            return { messages: msgs };
          });
        } else if (event === 'queued') {
          // Supplementary message queued while GA is busy - show as system info
          const queueMsg = data.msg || data.text || '消息已排队';
          get().showToast(`📨 ${queueMsg}`);
        } else if (event === 'error') {
          const errText = data.text || data.error || data.msg || '未知错误';
          set(state => {
            const msgs = [...state.messages, { role: 'agent' as const, content: `⚠️ ${errText}`, timestamp: Date.now(), status: 'error' as const }];
            if (wsInstanceId) saveMessages(wsInstanceId, msgs);
            return { messages: msgs };
          });
        }
      } catch {
        // Non-JSON message, ignore
      }
    };

    socket.onclose = () => {
      ws = null;
      wsInstanceId = null;
      set({ wsConnected: false });
    };

    socket.onerror = () => {
      get().showToast('WebSocket 连接失败');
    };
  },

  disconnectWs: () => {
    if (ws) {
      ws.close();
      ws = null;
      wsInstanceId = null;
    }
    set({ wsConnected: false });
  },

  sendMessage: async (content: string, images?: string[]) => {
    const id = get().activeInstanceId;
    if (!id) return;

    // Add user message to UI (with images if any)
    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now(), images };
    set(state => {
      const msgs = [...state.messages, userMsg];
      saveMessages(id, msgs);
      return { messages: msgs };
    });

    // Ensure WS is connected for receiving replies
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      get().connectWs(id);
    }

    // Send via HTTP POST (reliable, not affected by state checks in WS path)
    try {
      const body: Record<string, unknown> = { message: content };
      if (images && images.length > 0) {
        body.images = images;
      }
      const resp = await fetch(`${API_BASE}/instances/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.text();
        set(state => ({
          messages: [...state.messages, { role: 'agent', content: `⚠️ 发送失败: ${err}`, timestamp: Date.now(), status: 'error' }],
        }));
      }
    } catch (e) {
      set(state => ({
        messages: [...state.messages, { role: 'agent', content: `⚠️ 网络错误: ${e}`, timestamp: Date.now(), status: 'error' }],
      }));
    }
  },

  clearChat: async () => {
    const id = get().activeInstanceId;
    if (id) {
      try { await fetch(`${API_BASE}/instances/${id}/clear`, { method: 'POST' }); } catch {}
      clearStoredMessages(id);
    }
    set({ messages: [] });
    get().showToast('对话已清空');
    // Reconnect WS to get fresh state
    if (id) {
      get().disconnectWs();
      setTimeout(() => get().connectWs(id), 300);
    }
  },

  deleteInstance: async (id: string) => {
    try {
      const resp = await fetch(`${API_BASE}/instances/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        clearStoredMessages(id);
        set(state => ({
          instances: state.instances.filter(i => i.id !== id),
          activeInstanceId: state.activeInstanceId === id ? null : state.activeInstanceId,
          messages: state.activeInstanceId === id ? [] : state.messages,
        }));
        get().showToast('实例已删除');
      } else {
        get().showToast('删除失败');
      }
    } catch {
      get().showToast('删除失败');
    }
  },

  interruptChat: async (id: string) => {
    try {
      await fetch(`${API_BASE}/instances/${id}/interrupt`, { method: 'POST' });
      get().showToast('已发送中断指令');
    } catch {
      get().showToast('中断失败');
    }
  },

  toggleFeature: async (id: string, feature: 'autonomous' | 'reflect' | 'scheduler' | 'team_worker') => {
    const inst = get().instances.find(i => i.id === id);
    if (!inst) return;
    const newVal = !inst[feature];
    try {
      await fetch(`${API_BASE}/instances/${id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [feature]: newVal }),
      });
      // Optimistic update
      set(state => ({
        instances: state.instances.map(i =>
          i.id === id ? { ...i, [feature]: newVal } : i
        ),
      }));
      get().showToast(`${feature} ${newVal ? '已启用' : '已关闭'}`);
    } catch {
      get().showToast(`切换 ${feature} 失败`);
    }
  },

  setStringConfig: async (id: string, key: 'goal' | 'peer_hint', value: string) => {
    try {
      await fetch(`${API_BASE}/instances/${id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      set(state => ({
        instances: state.instances.map(i =>
          i.id === id ? { ...i, [key]: value } : i
        ),
      }));
      get().showToast(value ? `${key} 已设置` : `${key} 已清除`);
    } catch {
      get().showToast(`设置 ${key} 失败`);
    }
  },

  switchLLM: async (id: string, llmNo: number) => {
    try {
      await fetch(`${API_BASE}/instances/${id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_no: llmNo }),
      });
      set(state => ({
        instances: state.instances.map(i =>
          i.id === id ? { ...i, llm_no: llmNo } : i
        ),
        showLLMSelector: false,
      }));
      get().showToast(`已切换到 LLM #${llmNo}`);
    } catch {
      get().showToast('切换LLM失败');
    }
  },

  setIMChannel: async (id: string, channel: string) => {
    try {
      await fetch(`${API_BASE}/instances/${id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ im_channel: channel }),
      });
      set(state => ({
        instances: state.instances.map(i =>
          i.id === id ? { ...i, im_channel: channel } : i
        ),
        showIMSelector: false,
      }));
      get().showToast(`IM渠道已切换为 ${channel || '无'}`);
    } catch {
      get().showToast('切换IM渠道失败');
    }
  },

  showIMSelector: false,
  setShowIMSelector: (v: boolean) => set({ showIMSelector: v }),

  // LLM configs from backend
  llmConfigs: [],
  fetchLLMs: async () => {
    try {
      const res = await fetch(`${API_BASE}/config/llms`);
      if (res.ok) {
        const data = await res.json();
        set({ llmConfigs: data || [] });
      }
    } catch {
      // Keep empty list on error
    }
  },

  // UI state
  showLLMSelector: false,
  setShowLLMSelector: (v: boolean) => set({ showLLMSelector: v }),

  toast: null,
  showToast: (msg: string) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 2500);
  },

  activeInstance: () => {
    const { instances, activeInstanceId } = get();
    return instances.find(i => i.id === activeInstanceId) || null;
  },

  runningCount: () => get().instances.filter(i => i.status === 'running' || i.status === 'busy' || i.status === 'starting').length,

  totalTokens: () => {
    const total = get().instances.reduce((sum, i) => sum + (i.tokens_used || 0), 0);
    if (total >= 1000) return `${(total / 1000).toFixed(1)}K`;
    return String(total);
  },

  healthPercent: () => {
    const insts = get().instances;
    if (insts.length === 0) return '100%';
    const healthy = insts.filter(i => i.health === 'healthy').length;
    return `${Math.round((healthy / insts.length) * 100)}%`;
  },

  // === New Feature States ===
  resources: [] as { type: string; usage: number; detail: string }[],
  schedules: [] as { id: string; instance_id: string; cron: string; task: string; enabled: boolean; last_run?: string; next_run?: string }[],
  sophubResults: [] as { id: string; title: string; description: string; tags: string[]; author?: string; downloads?: number }[],
  sophubQuery: '',
  sophubLoading: false,

  // === Resources ===
  fetchResources: async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${id}/resources`);
      if (res.ok) {
        const data = await res.json();
        const raw = Array.isArray(data) ? data[0] : data;
        if (raw) {
          const cpuPct = Math.round(raw.cpu_percent || 0);
          const memMB = raw.memory_mb || 0;
          // Estimate memory percentage (cap at 100)
          const memPct = Math.min(100, Math.round(memMB / 100 * 100) || 1);
          const resources = [
            { type: 'cpu', usage: cpuPct, detail: `${cpuPct}%` },
            { type: 'memory', usage: memPct, detail: `${memMB.toFixed(1)} MB` },
          ];
          set({ resources });
        } else {
          set({ resources: [] });
        }
      }
    } catch {
      set({ resources: [] });
    }
  },

  // === Schedules ===
  fetchSchedules: async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${id}/tasks`);
      if (res.ok) {
        const data = await res.json();
        set({ schedules: data || [] });
      }
    } catch {
      set({ schedules: [] });
    }
  },

  addSchedule: async (id: string, cron: string, task: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron, command: task }),
      });
      if (res.ok) {
        get().showToast('定时任务已添加');
        get().fetchSchedules(id);
      } else {
        get().showToast('添加定时任务失败');
      }
    } catch {
      get().showToast('添加定时任务失败');
    }
  },

  deleteSchedule: async (instanceId: string, scheduleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${instanceId}/tasks/${scheduleId}`, { method: 'DELETE' });
      if (res.ok) {
        get().showToast('定时任务已删除');
        get().fetchSchedules(instanceId);
      } else {
        get().showToast('删除失败');
      }
    } catch {
      get().showToast('删除失败');
    }
  },

  // === Batch Actions ===
  batchAction: async (action: string, instanceIds: string[]) => {
    try {
      const res = await fetch(`${API_BASE}/instances/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, instance_ids: instanceIds }),
      });
      if (res.ok) {
        get().showToast(`批量${action}完成`);
        get().fetchInstances();
      } else {
        get().showToast(`批量操作失败`);
      }
    } catch {
      get().showToast('批量操作失败');
    }
  },

  // === Sophub Integration ===
  searchSophub: async (query: string) => {
    set({ sophubQuery: query, sophubLoading: true });
    try {
      const res = await fetch(`${API_BASE}/sophub/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        set({ sophubResults: data.items || data || [], sophubLoading: false });
      } else {
        set({ sophubResults: [], sophubLoading: false });
        get().showToast('Sophub 搜索失败');
      }
    } catch {
      set({ sophubResults: [], sophubLoading: false });
      get().showToast('Sophub 网络错误');
    }
  },

  downloadSop: async (sopId: string, instanceId?: string) => {
    try {
      const url = instanceId
        ? `${API_BASE}/instances/${instanceId}/sophub/download/${sopId}`
        : `${API_BASE}/sophub/download/${sopId}`;
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sop_${sopId}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
        get().showToast('SOP 下载成功');
      } else {
        get().showToast('SOP 下载失败');
      }
    } catch {
      get().showToast('SOP 下载失败');
    }
  },

  // === Export Chat ===
  exportChat: async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${id}/export`);
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chat_${id}_${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
        get().showToast('对话已导出');
      } else {
        get().showToast('导出失败');
      }
    } catch {
      get().showToast('导出失败');
    }
  },

  // === Send Command ===
  sendCommand: async (id: string, command: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      if (res.ok) {
        get().showToast('指令已发送');
      } else {
        get().showToast('指令发送失败');
      }
    } catch {
      get().showToast('指令发送失败');
    }
  },

  // === Forward Message ===
  forwardMessage: async (fromId: string, toId: string, message: string) => {
    try {
      const res = await fetch(`${API_BASE}/instances/${fromId}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: toId, message }),
      });
      if (res.ok) {
        get().showToast('消息已转发');
      } else {
        get().showToast('转发失败');
      }
    } catch {
      get().showToast('转发失败');
    }
  },
}));
