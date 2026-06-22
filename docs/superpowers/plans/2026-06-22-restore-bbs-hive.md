# Restore BBS-Based Hive with Unlimited Budget + project_dir + MCP Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original working BBS-based Hive interface (replacing the broken Hive v2 Task Engine UI) and add unlimited budget (0=no auto-stop), project_dir selection, and MCP BBS bridge tools.

**Architecture:** The original `HiveHandler` in `backend/handlers/hive.go` already works end-to-end (BBS + Workers + Master). Patch it with two small additions (budget=0 skip timer, project_dir CWD override), rewrite `HivePage.tsx` to use the BBS-based APIs, and add three new MCP tools that proxy the running BBS so Claude Code can read/post messages.

**Tech Stack:** Go (backend handler patch), TypeScript/React (frontend HivePage rewrite), JSON-RPC MCP over stdio (new BBS proxy tools in tools.go).

## Global Constraints

- Do NOT delete `backend/hive2/`, `backend/mcp/`, `store/hive.ts`, or any hive2 routes -- keep for future.
- Only touch: `backend/handlers/hive.go`, `backend/mcp/tools.go`, `backend/mcp/server.go`, `frontend/src/pages/HivePage.tsx`, `frontend/src/App.tsx`.
- All existing `/api/hive/` routes stay unchanged; only the body struct and one goroutine change in hive.go.
- Build commands: `cd backend && go build .` then `cd frontend && npm run build`
- Versioning: minor bump (restoring broken feature).
- Commit message: `feat: restore BBS-based Hive with unlimited budget + project_dir + MCP bridge`

---
## Task 1: Patch hive.go -- budget=0 unlimited + project_dir CWD

**Files:**
- Modify: `backend/handlers/hive.go`

**Interfaces:**
- Produces: POST /api/hive/start accepts `project_dir` string field; budget=0 means no auto-stop timer

- [ ] **Step 1: Add ProjectDir to request body struct**

Find the body struct around line 59. Change:

```go
// BEFORE:
var body struct {
    Objective string `json:"objective"`
    Budget    int    `json:"budget_minutes"`
    Workers   int    `json:"workers"`
    LLMNo     int    `json:"llm_no"`
    Mode      string `json:"mode"`
}

// AFTER:
var body struct {
    Objective  string `json:"objective"`
    Budget     int    `json:"budget_minutes"`
    Workers    int    `json:"workers"`
    LLMNo      int    `json:"llm_no"`
    Mode       string `json:"mode"`
    ProjectDir string `json:"project_dir"`
}
```

- [ ] **Step 2: Allow budget=0 to pass through (change `<= 0` to `< 0`)**

Find line ~70-72:

```go
// BEFORE:
if body.Budget <= 0 {
    body.Budget = 180
}

// AFTER (0 means unlimited, only default when explicitly negative):
if body.Budget < 0 {
    body.Budget = 180
}
```

- [ ] **Step 3: Use project_dir as bbsCwd when provided**

Find lines ~140-141:

```go
// BEFORE:
bbsCwd := filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
os.MkdirAll(bbsCwd, 0755)

// AFTER:
var bbsCwd string
if body.ProjectDir != "" {
    bbsCwd = body.ProjectDir
    os.MkdirAll(bbsCwd, 0755)
} else {
    bbsCwd = filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
    os.MkdirAll(bbsCwd, 0755)
}
```

- [ ] **Step 4: Wrap auto-stop goroutine in `if body.Budget > 0` guard**

Find lines ~387-398 (the auto-stop goroutine at the bottom of Start()):

```go
// BEFORE:
go func() {
    timeout := time.Duration(body.Budget) * time.Minute
    time.Sleep(timeout + 2*time.Minute)
    h.mu.Lock()
    if h.running {
        h.mu.Unlock()
        h.addLog(fmt.Sprintf("Budget expired (%d min), auto-stopping...", body.Budget))
        h.stopAll()
    } else {
        h.mu.Unlock()
    }
}()

// AFTER:
if body.Budget > 0 {
    go func() {
        timeout := time.Duration(body.Budget) * time.Minute
        time.Sleep(timeout + 2*time.Minute)
        h.mu.Lock()
        if h.running {
            h.mu.Unlock()
            h.addLog(fmt.Sprintf("Budget expired (%d min), auto-stopping...", body.Budget))
            h.stopAll()
        } else {
            h.mu.Unlock()
        }
    }()
}
```

- [ ] **Step 5: Build backend to verify no compile errors**

Run: `cd backend && go build .`
Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add backend/handlers/hive.go
git commit -m "fix: allow budget=0 for unlimited hive + project_dir cwd option"
```

---
## Task 2: Add BBS proxy tools to MCP server

**Files:**
- Modify: `backend/mcp/server.go` (add cfg field to Server struct)
- Modify: `backend/mcp/tools.go` (add three tool handlers + descriptions + needed imports)
- Modify: `backend/main.go` (pass cfg when constructing MCP server if applicable)

**Interfaces:**
- Consumes: `models.AppConfig.BBSBaseURL` and `models.AppConfig.BBSKey` (set by HiveHandler.Start)
- Produces: MCP tools `hive_bbs_posts`, `hive_bbs_post`, `hive_bbs_status`

- [ ] **Step 1: Add cfg field to mcp.Server struct**

In `backend/mcp/server.go`, add `ga_manager/models` import and cfg field:

```go
// In imports, add:
"ga_manager/models"

// In Server struct, add cfg field after tracker:
cfg     *models.AppConfig  // for BBS proxy (BBSBaseURL, BBSKey)
```

Update `NewServer` signature (add cfg param, assign to struct):

```go
// BEFORE:
func NewServer(store *hive2.ProjectStore, engine *hive2.TaskEngine, ctx *hive2.ContextStore, tracker *hive2.FileTracker) *Server {
    s := &Server{
        store:   store,
        engine:  engine,
        context: ctx,
        tracker: tracker,
        ...
    }

// AFTER:
func NewServer(store *hive2.ProjectStore, engine *hive2.TaskEngine, ctx *hive2.ContextStore, tracker *hive2.FileTracker, cfg *models.AppConfig) *Server {
    s := &Server{
        store:   store,
        engine:  engine,
        context: ctx,
        tracker: tracker,
        cfg:     cfg,
        ...
    }
```

Also update `NewServerWithIO` the same way (same new parameter in same position).

- [ ] **Step 2: Add imports to tools.go**

At the top of `backend/mcp/tools.go`, add to the import block:

```go
"io"
"net/http"
"strings"
```

(These are not already imported in tools.go since the existing tools only use encoding/json and fmt.)

- [ ] **Step 3: Register new tools in registerTools()**

In `backend/mcp/tools.go`, append to `registerTools()`:

```go
s.tools["hive_bbs_posts"]  = s.toolBBSPosts
s.tools["hive_bbs_post"]   = s.toolBBSPost
s.tools["hive_bbs_status"] = s.toolBBSStatus
```

- [ ] **Step 4: Implement the three tool handlers**

Add these functions after `toolProjectSummary` in `backend/mcp/tools.go`:

```go
func (s *Server) toolBBSPosts(params json.RawMessage) (interface{}, error) {
    var args struct {
        Limit int `json:"limit,omitempty"`
    }
    json.Unmarshal(params, &args) //nolint:errcheck
    if s.cfg == nil || s.cfg.BBSBaseURL == "" {
        return nil, fmt.Errorf("Hive BBS is not running")
    }
    limit := args.Limit
    if limit <= 0 {
        limit = 30
    }
    url := strings.TrimRight(s.cfg.BBSBaseURL, "/") + fmt.Sprintf("/posts?limit=%d", limit)
    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("X-API-Key", s.cfg.BBSKey)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("BBS request failed: %v", err)
    }
    defer resp.Body.Close()
    var result interface{}
    json.NewDecoder(resp.Body).Decode(&result) //nolint:errcheck
    return result, nil
}

func (s *Server) toolBBSPost(params json.RawMessage) (interface{}, error) {
    var args struct {
        Content string `json:"content"`
        Name    string `json:"name,omitempty"`
    }
    json.Unmarshal(params, &args) //nolint:errcheck
    if args.Content == "" {
        return nil, fmt.Errorf("content required")
    }
    if s.cfg == nil || s.cfg.BBSBaseURL == "" {
        return nil, fmt.Errorf("Hive BBS is not running")
    }
    name := args.Name
    if name == "" {
        name = "ClaudeCode"
    }
    baseURL := s.cfg.BBSBaseURL
    apiKey := s.cfg.BBSKey
    // Register to get a token
    regPayload := fmt.Sprintf(`{"name":%q}`, name)
    regReq, _ := http.NewRequest("POST", baseURL+"/register", strings.NewReader(regPayload))
    regReq.Header.Set("Content-Type", "application/json")
    regReq.Header.Set("X-API-Key", apiKey)
    var token string
    if regResp, err := http.DefaultClient.Do(regReq); err == nil {
        var rr map[string]string
        json.NewDecoder(regResp.Body).Decode(&rr) //nolint:errcheck
        regResp.Body.Close()
        token = rr["token"]
    }
    if token == "" {
        return nil, fmt.Errorf("failed to register with BBS")
    }
    postPayload, _ := json.Marshal(map[string]string{"token": token, "content": args.Content})
    postReq, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(postPayload)))
    postReq.Header.Set("Content-Type", "application/json")
    postReq.Header.Set("X-API-Key", apiKey)
    postResp, err := http.DefaultClient.Do(postReq)
    if err != nil {
        return nil, fmt.Errorf("post failed: %v", err)
    }
    defer postResp.Body.Close()
    var result interface{}
    json.NewDecoder(postResp.Body).Decode(&result) //nolint:errcheck
    return result, nil
}

func (s *Server) toolBBSStatus(params json.RawMessage) (interface{}, error) {
    if s.cfg == nil {
        return map[string]interface{}{"running": false, "bbs_url": ""}, nil
    }
    return map[string]interface{}{
        "running":   s.cfg.BBSBaseURL != "",
        "bbs_url":   s.cfg.BBSBaseURL,
        "board_key": s.cfg.BBSKey,
    }, nil
}
```

Note: the `io` import may produce an "imported and not used" error if nothing uses it directly. Remove it if so -- it was listed as a candidate in case `io.Copy` was used. The three functions above use only `strings`, `net/http`, `fmt`, and `encoding/json`.

- [ ] **Step 5: Add descriptions to toolDescriptions map**

In `backend/mcp/server.go`, add to `toolDescriptions`:

```go
"hive_bbs_posts":  "Read posts from the running Hive BBS (optional limit, default 30)",
"hive_bbs_post":   "Post a message to the running Hive BBS as ClaudeCode",
"hive_bbs_status": "Get the current Hive BBS running status and connection info",
```

- [ ] **Step 6: Pass cfg to NewServer in main.go**

Search main.go for where `mcp.NewServer` is called. If found in a --mcp flag handler, add `cfg` as the 5th argument:

```go
// BEFORE:
mcp.NewServer(store, engine, ctx, tracker).Run()

// AFTER:
mcp.NewServer(store, engine, ctx, tracker, cfg).Run()
```

If `NewServerWithIO` is also called in test files (`backend/mcp/server_test.go`), update it too -- pass `nil` for cfg in tests:

```go
mcp.NewServerWithIO(store, engine, ctx, tracker, nil, in, out)
```

- [ ] **Step 7: Build backend**

Run: `cd backend && go build .`
Expected: exits 0, no errors. If "imported and not used" for `io`, remove that import from tools.go.

- [ ] **Step 8: Commit**

```bash
git add backend/mcp/server.go backend/mcp/tools.go backend/main.go
git commit -m "feat: add BBS proxy tools to MCP (hive_bbs_posts, hive_bbs_post, hive_bbs_status)"
```

---
## Task 3: Rewrite HivePage.tsx (BBS-based UI)

**Files:**
- Rewrite: `frontend/src/pages/HivePage.tsx`

**Interfaces:**
- Consumes: /api/hive/start, /api/hive/stop, /api/hive/status, /api/hive/posts, /api/hive/authors, /api/hive/post, /api/hive/history
- Produces: BBS-based Hive UI exported as default HivePage

**Existing CSS classes available:** `hive-page`, `page-container`, `page-card`, `page-header`, `setup-btn`, `ch-btn`

- [ ] **Step 1: Write the full HivePage.tsx**

Replace `frontend/src/pages/HivePage.tsx` entirely with the following:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface HivePost {
  id: number;
  author: string;
  content: string;
  created_at: string;
}

interface HiveStatus {
  running: boolean;
  port: number;
  board_key: string;
  objective: string;
  budget: number;
  workers: number;
  logs: string[];
  elapsed_minutes?: number;
}

interface RunSummary {
  file: string;
  objective: string;
  stopped_at: string;
  posts: number;
}

const DEFAULT_STATUS: HiveStatus = {
  running: false, port: 0, board_key: '', objective: '',
  budget: 60, workers: 2, logs: [],
};

function HivePage() {
  const { lang } = useI18n();
  const isZh = lang === 'zh';
  const [status, setStatus] = useState<HiveStatus>(DEFAULT_STATUS);
  const [posts, setPosts] = useState<HivePost[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(60);
  const [workers, setWorkers] = useState(2);
  const [llmNo, setLlmNo] = useState(0);
  const [mode, setMode] = useState('hive');
  const [projectDir, setProjectDir] = useState('');
  const [msgInput, setMsgInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const postsEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = () => {
    fetch('/api/hive/status').then(r => r.json()).then(setStatus).catch(() => {});
  };
  const fetchPosts = () => {
    fetch('/api/hive/posts?limit=50').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPosts(d); }).catch(() => {});
  };
  const fetchAuthors = () => {
    fetch('/api/hive/authors').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAuthors(d.map((a: { name: string }) => a.name)); })
      .catch(() => {});
  };
  const fetchHistory = () => {
    fetch('/api/hive/history').then(r => r.json())
      .then(d => { if (Array.isArray(d)) setHistory(d); }).catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    fetchHistory();
    const t = setInterval(() => {
      fetchStatus();
    }, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!status.running) return;
    fetchPosts();
    fetchAuthors();
    const t = setInterval(() => {
      fetchPosts();
      fetchAuthors();
    }, 2000);
    return () => clearInterval(t);
  }, [status.running]);

  useEffect(() => {
    postsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts.length]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status.logs.length]);

  const handleStart = async () => {
    if (!objective.trim()) {
      setError(isZh ? '目标不能为空' : 'Objective is required');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/hive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          budget_minutes: budget,
          workers,
          llm_no: llmNo,
          mode,
          project_dir: projectDir,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start');
        return;
      }
      fetchStatus();
      fetchPosts();
      fetchAuthors();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    await fetch('/api/hive/stop', { method: 'POST' });
    fetchStatus();
    fetchHistory();
  };

  const handleSend = async () => {
    if (!msgInput.trim()) return;
    await fetch('/api/hive/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msgInput }),
    });
    setMsgInput('');
    fetchPosts();
  };

  const bbsURL = status.port ? `http://127.0.0.1:${status.port}` : '';

  if (!status.running) {
    return (
      <div className="hive-page">
        <div className="page-container">
          <h2 className="page-header">Hive</h2>
          <div className="page-card">
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>
                {isZh ? '目标' : 'Objective'}
              </label>
              <textarea
                value={objective}
                onChange={e => setObjective(e.target.value)}
                placeholder={isZh ? '描述 Hive 要完成的目标...' : 'Describe what Hive should accomplish...'}
                style={{
                  width: '100%', minHeight: 80, padding: '8px 10px',
                  borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg2)', color: 'var(--text-1)',
                  fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? '时间预算 (分钟, 0=不限时)' : 'Budget (min, 0=unlimited)'}
                </label>
                <input type="number" min={0} value={budget} onChange={e => setBudget(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? 'Worker 数量' : 'Workers'}
                </label>
                <input type="number" min={1} max={5} value={workers} onChange={e => setWorkers(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? 'LLM 编号' : 'LLM No'}
                </label>
                <input type="number" min={0} value={llmNo} onChange={e => setLlmNo(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  {isZh ? '模式' : 'Mode'}
                </label>
                <select value={mode} onChange={e => setMode(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="hive">{isZh ? 'Hive (目标驱动)' : 'Hive (goal-driven)'}</option>
                  <option value="checklist">{isZh ? 'Checklist (结构化)' : 'Checklist (structured)'}</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                {isZh ? '项目目录 (可选)' : 'Project Dir (optional)'}
              </label>
              <input type="text" value={projectDir} onChange={e => setProjectDir(e.target.value)}
                placeholder={isZh ? '留空则自动创建临时目录' : 'Leave empty to auto-create temp dir'}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <button className="setup-btn" onClick={handleStart} disabled={starting}
              style={{ padding: '8px 24px', fontSize: 14 }}>
              {starting ? (isZh ? '启动中...' : 'Starting...') : (isZh ? '启动 Hive' : 'Start Hive')}
            </button>
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {isZh ? '历史运行' : 'Run History'} ({history.length})
              </div>
              {history.map(h => (
                <div key={h.file} className="page-card" style={{ padding: '10px 14px', marginBottom: 8, opacity: 0.8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.objective}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {h.stopped_at ? new Date(h.stopped_at).toLocaleString() : ''} &middot; {h.posts} posts
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Running view
  return (
    <div className="hive-page">
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', flexShrink: 0 }} />
          <h2 className="page-header" style={{ margin: 0, flex: 1 }}>Hive</h2>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {isZh ? `运行中 · ${status.elapsed_minutes ?? 0} 分钟` : `Running · ${status.elapsed_minutes ?? 0} min`}
          </span>
          <button className="ch-btn" onClick={handleStop} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
            {isZh ? '停止' : 'Stop'}
          </button>
        </div>

        {bbsURL && (
          <div className="page-card" style={{ marginBottom: 12, border: '1px solid var(--accent, #7c3aed)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', marginBottom: 8 }}>
              {isZh ? 'Claude Code 可通过以下信息接入:' : 'Connect Claude Code via:'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
              BBS URL: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{bbsURL}</code>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Board Key: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4, userSelect: 'all' }}>{status.board_key}</code>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {isZh
                ? 'MCP 工具: hive_bbs_posts / hive_bbs_post / hive_bbs_status'
                : 'MCP tools: hive_bbs_posts / hive_bbs_post / hive_bbs_status'}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
          <div>
            <div className="page-card" style={{ height: 360, overflowY: 'auto', marginBottom: 10, padding: '10px 12px' }}>
              {posts.map(p => (
                <div key={p.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent, #7c3aed)' }}>{p.author}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{new Date(p.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p.content}</div>
                </div>
              ))}
              {posts.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                  {isZh ? '等待 Worker 发帖...' : 'Waiting for Worker posts...'}
                </div>
              )}
              <div ref={postsEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={isZh ? '发送消息到 BBS...' : 'Send a message to BBS...'}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-1)', fontSize: 13 }}
              />
              <button className="setup-btn" onClick={handleSend} style={{ padding: '7px 16px', fontSize: 13 }}>
                {isZh ? '发送' : 'Send'}
              </button>
            </div>
          </div>

          <div>
            {authors.length > 0 && (
              <div className="page-card" style={{ marginBottom: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8 }}>
                  {isZh ? '在线作者' : 'Authors'} ({authors.length})
                </div>
                {authors.map(a => (
                  <div key={a} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                    {a}
                  </div>
                ))}
              </div>
            )}
            <div className="page-card" style={{ padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8 }}>
                {isZh ? '系统日志' : 'System Logs'}
              </div>
              {status.logs.map((line, i) => (
                <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HivePage;
```

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: Builds successfully (chunk size warnings are OK, TypeScript errors are not OK).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/HivePage.tsx
git commit -m "feat: restore BBS-based HivePage with project_dir + unlimited budget + MCP info card"
```

---
## Task 4: Fix App.tsx routing

**Files:**
- Modify: `frontend/src/App.tsx` (line 69 and related imports)

**Interfaces:**
- Consumes: `HivePage` from Task 3
- Produces: case 'hive' always renders `<HivePage />` directly

- [ ] **Step 1: Change case 'hive' to always render HivePage**

In `frontend/src/App.tsx`, find line 69:

```tsx
// BEFORE:
case 'hive': return hiveSelectedProjectId ? <HiveProjectPage /> : <HivePage />;

// AFTER:
case 'hive': return <HivePage />;
```

- [ ] **Step 2: Remove unused imports and the hiveSelectedProjectId variable**

Remove from App.tsx (no longer needed):

```tsx
import HiveProjectPage from './pages/HiveProjectPage';
import { useHiveStore } from './store/hive';
// and inside AppInner:
const hiveSelectedProjectId = useHiveStore(s => s.selectedProjectId);
```

Note: HiveProjectPage.tsx stays in the codebase, just not imported in App.tsx.

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors. Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "fix: hive nav always routes to BBS-based HivePage"
```

---

## Task 5: Final build and push

- [ ] **Step 1: Clean backend build**

Run: `cd backend && go build .`
Expected: exits 0, ga_manager.exe produced.

- [ ] **Step 2: Clean frontend build**

Run: `cd frontend && npm run build`
Expected: dist/ populated, no TypeScript errors.

- [ ] **Step 3: Copy dist to static (packaging only)**

In development, `frontend/dist` is already found automatically (main.go candidate 4).
For a packaged build on Windows, run in PowerShell:

```
Remove-Item -Recurse -Force backend\static -ErrorAction SilentlyContinue
Copy-Item -Recurse frontend\dist backend\static
```

- [ ] **Step 4: Commit + version bump**

Check version in `frontend/package.json`. Bump patch (e.g. 3.2.2 -> 3.2.3).

```bash
git add -A
git commit -m "feat: restore BBS-based Hive with unlimited budget + project_dir + MCP bridge"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Verification Checklist

- [ ] Hive nav shows start form (not Hive v2 project list)
- [ ] budget=0 start -- hive does NOT auto-stop after 2 minutes
- [ ] project_dir set -- BBS uses that directory (visible in system logs)
- [ ] Running view shows Claude Code connection card with BBS URL + board key
- [ ] MCP hive_bbs_status returns running=true with bbs_url populated
- [ ] MCP hive_bbs_posts returns post array
- [ ] MCP hive_bbs_post posts successfully, message visible in UI
- [ ] Stop button stops all workers
- [ ] History shows completed runs after stop

## Notes on --mcp flag

Search main.go for "mcp". The current code (lines 876-882) only handles "--no-gui" and "-headless" -- there is no --mcp branch. If the MCP server is only used as a library, no main.go change is needed for Task 2 Step 6. Just ensure cfg is passed wherever mcp.NewServer is called. The BBS tools degrade gracefully when cfg.BBSBaseURL is empty.
