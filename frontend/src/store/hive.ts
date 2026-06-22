import { create } from 'zustand';

interface HiveTask {
  id: string; type: string; title: string; status: string;
  executor: string; depends_on: string[]; assigned_to?: string;
  started_at?: string; finished_at?: string; budget_minutes?: number;
  error?: string;
  outputs?: { context_keys?: string[]; files?: string[] };
}

interface HiveProject {
  id: string; name: string; objective: string; status: string;
  priority: string; created_at: string; updated_at: string;
  budget_minutes: number; elapsed_minutes: number;
  task_count: { total: number; done: number; running: number; pending: number; failed: number };
  executor_config: { ga_llm_no: number; ga_workers: number; claude_code_enabled: boolean };
}

interface ContextEntry {
  key: string; file: string; type: string; source_task: string; tags: string[]; created_at: string;
}

interface FileChange {
  file: string; action: string; task_id: string; timestamp: string; size_bytes: number;
}

interface Template {
  name: string; description: string;
  variables: { name: string; label: string; required: boolean; default?: string }[];
}

interface HiveState {
  projects: HiveProject[];
  selectedProjectId: string | null;
  projectDetail: { project: HiveProject; tasks: HiveTask[]; context: ContextEntry[]; artifacts: FileChange[] } | null;
  templates: Template[];
  poolStats: { total: number; max: number; busy: number; idle: number } | null;
  loading: boolean;

  fetchProjects: () => Promise<void>;
  fetchProjectDetail: (id: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  fetchPoolStats: () => Promise<void>;
  createProject: (data: { name?: string; objective: string; budget_minutes?: number; template?: string; vars?: Record<string, string>; executor_config?: Record<string, unknown>; project_dir?: string }) => Promise<string | null>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string | null) => void;
  readContext: (projectId: string, key: string) => Promise<string>;
}

export const useHiveStore = create<HiveState>((set, get) => ({
  projects: [], selectedProjectId: null, projectDetail: null, templates: [], poolStats: null, loading: false,

  fetchProjects: async () => {
    const res = await fetch('/api/hive2/projects');
    if (res.ok) set({ projects: await res.json() || [] });
  },

  fetchProjectDetail: async (id: string) => {
    const res = await fetch(`/api/hive2/projects/${encodeURIComponent(id)}`);
    if (res.ok) set({ projectDetail: await res.json() });
  },

  fetchTemplates: async () => {
    const res = await fetch('/api/hive2/templates');
    if (res.ok) set({ templates: await res.json() || [] });
  },

  fetchPoolStats: async () => {
    const res = await fetch('/api/hive2/pool/stats');
    if (res.ok) set({ poolStats: await res.json() });
  },

  createProject: async (data) => {
    set({ loading: true });
    const res = await fetch('/api/hive2/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    set({ loading: false });
    if (res.ok) { const p = await res.json(); get().fetchProjects(); return p.id; }
    return null;
  },

  deleteProject: async (id: string) => {
    await fetch(`/api/hive2/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set({ selectedProjectId: null, projectDetail: null });
    get().fetchProjects();
  },

  selectProject: (id) => set({ selectedProjectId: id }),

  readContext: async (projectId: string, key: string): Promise<string> => {
    const res = await fetch(`/api/hive2/projects/${encodeURIComponent(projectId)}/context/${encodeURIComponent(key)}`);
    if (res.ok) { const d = await res.json(); return d.content || ''; }
    return '';
  },
}));
