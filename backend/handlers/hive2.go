package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"ga_manager/hive2"
)

// Hive2Handler exposes all Hive v2 functionality as REST endpoints.
type Hive2Handler struct {
	store     *hive2.ProjectStore
	engine    *hive2.TaskEngine
	context   *hive2.ContextStore
	tracker   *hive2.FileTracker
	pool      *hive2.WorkerPool
	templates *hive2.TemplateLibrary
	eventBus  *hive2.EventBus
	gaRoot    string
}

// Hive2Config holds all dependencies for Hive2Handler.
type Hive2Config struct {
	GARoot    string
	Store     *hive2.ProjectStore
	Engine    *hive2.TaskEngine
	Context   *hive2.ContextStore
	Tracker   *hive2.FileTracker
	Pool      *hive2.WorkerPool
	Templates *hive2.TemplateLibrary
	EventBus  *hive2.EventBus
}

// NewHive2Handler constructs a Hive2Handler from the given config.
func NewHive2Handler(cfg Hive2Config) *Hive2Handler {
	return &Hive2Handler{
		store:     cfg.Store,
		engine:    cfg.Engine,
		context:   cfg.Context,
		tracker:   cfg.Tracker,
		pool:      cfg.Pool,
		templates: cfg.Templates,
		eventBus:  cfg.EventBus,
		gaRoot:    cfg.GARoot,
	}
}

// --- Project endpoints ---

// ListProjects handles GET /api/hive2/projects
func (h *Hive2Handler) ListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.store.List()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, projects)
}

// CreateProject handles POST /api/hive2/projects
func (h *Hive2Handler) CreateProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string               `json:"name"`
		Objective string               `json:"objective"`
		Budget    int                  `json:"budget_minutes"`
		Config    hive2.ExecutorConfig `json:"executor_config"`
		Template  string               `json:"template,omitempty"`
		Vars      map[string]string    `json:"vars,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Objective == "" {
		writeError(w, 400, "objective required")
		return
	}
	if body.Name == "" {
		end := len([]rune(body.Objective))
		if end > 30 {
			end = 30
		}
		body.Name = string([]rune(body.Objective)[:end])
	}
	if body.Budget <= 0 {
		body.Budget = 60
	}

	p, err := h.store.Create(body.Name, body.Objective, body.Budget, body.Config)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// If template specified, instantiate it; otherwise create a default decompose task.
	if body.Template != "" {
		tmpl, err := h.templates.Load(body.Template)
		if err != nil {
			writeError(w, 400, "template not found: "+body.Template)
			return
		}
		vars := body.Vars
		if vars == nil {
			vars = map[string]string{}
		}
		tasks, err := h.templates.Instantiate(tmpl, vars)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		h.engine.AddTasks(p.ID, tasks)
	} else {
		h.engine.AddTasks(p.ID, []*hive2.Task{{
			ID:            "00",
			Type:          hive2.TaskTypeDesign,
			Title:         "拆解目标为子任务",
			Executor:      hive2.ExecutorGA,
			BudgetMinutes: 10,
		}})
	}

	p, _ = h.store.Load(p.ID)
	writeJSON(w, 201, p)
}

// GetProject handles GET /api/hive2/projects/{id}
func (h *Hive2Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := h.store.Load(id)
	if err != nil {
		writeError(w, 404, "project not found")
		return
	}

	tasks, _ := h.store.GetTasks(id)
	contextEntries, _ := h.context.List(id)
	changes, _ := h.tracker.GetChanges(id)

	writeJSON(w, 200, map[string]interface{}{
		"project":   p,
		"tasks":     tasks,
		"context":   contextEntries,
		"artifacts": changes,
	})
}

// --- Task endpoints ---

// ListTasks handles GET /api/hive2/projects/{id}/tasks
func (h *Hive2Handler) ListTasks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tasks, err := h.store.GetTasks(id)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, tasks)
}

// AddTasks handles POST /api/hive2/projects/{id}/tasks
func (h *Hive2Handler) AddTasks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Tasks []*hive2.Task `json:"tasks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid body")
		return
	}
	if err := h.engine.AddTasks(id, body.Tasks); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ClaimTask handles POST /api/hive2/projects/{id}/tasks/{tid}/claim
func (h *Hive2Handler) ClaimTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tid := r.PathValue("tid")
	var body struct {
		Assignee string `json:"assignee"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Assignee == "" {
		body.Assignee = "worker"
	}

	if err := h.engine.ClaimTask(id, tid, body.Assignee); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "claimed"})
}

// CompleteTask handles POST /api/hive2/projects/{id}/tasks/{tid}/complete
func (h *Hive2Handler) CompleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tid := r.PathValue("tid")
	var body struct {
		Summary string            `json:"summary"`
		Outputs hive2.TaskOutputs `json:"outputs"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if err := h.engine.CompleteTask(id, tid, body.Summary, body.Outputs); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "done"})
}

// FailTask handles POST /api/hive2/projects/{id}/tasks/{tid}/fail
func (h *Hive2Handler) FailTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tid := r.PathValue("tid")
	var body struct {
		Error string `json:"error"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if err := h.engine.FailTask(id, tid, body.Error); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "failed"})
}

// GetNextTask handles GET /api/hive2/projects/{id}/tasks/next
func (h *Hive2Handler) GetNextTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	executor := r.URL.Query().Get("executor")
	if executor == "" {
		executor = "ga"
	}

	task, err := h.engine.GetNextTask(id, hive2.ExecutorType(executor))
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if task == nil {
		writeJSON(w, 200, nil)
		return
	}
	writeJSON(w, 200, task)
}

// --- Context endpoints ---

// ListContext handles GET /api/hive2/projects/{id}/context
func (h *Hive2Handler) ListContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entries, _ := h.context.List(id)
	writeJSON(w, 200, entries)
}

// WriteContext handles POST /api/hive2/projects/{id}/context
func (h *Hive2Handler) WriteContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Key        string   `json:"key"`
		Type       string   `json:"type"`
		Content    string   `json:"content"`
		SourceTask string   `json:"source_task"`
		Tags       []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Key == "" || body.Content == "" {
		writeError(w, 400, "key and content required")
		return
	}
	if body.Type == "" {
		body.Type = "finding"
	}

	if err := h.context.Write(id, body.Key, body.Type, body.Content, body.SourceTask, body.Tags); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]string{"status": "written", "key": body.Key})
}

// ReadContext handles GET /api/hive2/projects/{id}/context/{key}
func (h *Hive2Handler) ReadContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	key := r.PathValue("key")
	body, err := h.context.ReadBody(id, key)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"key": key, "content": body})
}

// --- Artifact endpoints ---

// ListArtifacts handles GET /api/hive2/projects/{id}/artifacts
func (h *Hive2Handler) ListArtifacts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	changes, _ := h.tracker.GetChanges(id)
	writeJSON(w, 200, changes)
}

// PreviewArtifact handles GET /api/hive2/projects/{id}/artifacts/preview?path=...
func (h *Hive2Handler) PreviewArtifact(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, 400, "path required")
		return
	}

	fullPath := filepath.Join(h.store.BaseDir(), id, "artifacts", filepath.Clean(filePath))
	data, err := os.ReadFile(fullPath)
	if err != nil {
		writeError(w, 404, "file not found")
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".md":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	case ".py", ".go", ".js", ".ts", ".yaml", ".yml", ".json", ".toml":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Write(data)
}

// --- Task log endpoint ---

// GetTaskLog handles GET /api/hive2/projects/{id}/logs/{taskId}
func (h *Hive2Handler) GetTaskLog(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	taskID := r.PathValue("taskId")
	logPath := filepath.Join(h.store.BaseDir(), id, "logs", taskID+".log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		writeJSON(w, 200, map[string]string{"log": ""})
		return
	}
	writeJSON(w, 200, map[string]string{"log": string(data)})
}

// --- Template endpoints ---

// ListTemplates handles GET /api/hive2/templates
func (h *Hive2Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.templates.List()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, templates)
}

// --- Pool stats ---

// PoolStats handles GET /api/hive2/pool/stats
func (h *Hive2Handler) PoolStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, h.pool.Stats())
}
