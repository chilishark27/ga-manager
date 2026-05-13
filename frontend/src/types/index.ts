export interface Instance {
  id: string;
  name: string;
  status: string;        // "running" | "stopped" | "error"
  pid: number;
  llm_no: number;
  autonomous: boolean;
  goal: string;
  peer_hint: string;
  reflect: boolean;
  scheduler: boolean;
  team_worker: boolean;
  uptime: string;
  tokens_used: number;
  health: string;        // "healthy" | "warning" | "error"
  mode: string;          // "Web" | "IM" | "Goal" | "Sche"
  im_channel: string;    // "qq" | "telegram" | "discord" | etc
}

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp?: number;
  status?: 'streaming' | 'done' | 'error' | 'pending';
  images?: string[];  // base64 data URLs for pasted images
}

export interface CreateInstanceReq {
  name: string;
  llm_no: number;
  autonomous: boolean;
  goal: boolean;
  mode: string;
  im_channel: string;
}

export interface LLMConfig {
  index: number;
  name: string;
  type: string;
  key: string;
}

export interface Schedule {
  id: string;
  instance_id: string;
  cron: string;
  task: string;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
}

export interface DiscoveredInstance {
  port: number;
  url: string;
  status: string;     // "active"
}

export interface Resource {
  type: string;       // "cpu" | "memory" | "disk"
  usage: number;      // percentage 0-100
  detail: string;
}

export interface SophubSOP {
  id: string;
  title: string;
  description: string;
  tags: string[];
  author?: string;
  downloads?: number;
}
