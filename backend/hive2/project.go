package hive2

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// ProjectStore manages Hive v2 projects on disk.
//
// Storage layout:
//
//	baseDir/
//	  {date}_{name}/       <- project directory (ID)
//	    project.json
//	    tasks/
//	      {id}_{type}_{title}.json
//	    context/
//	      _index.json
//	    artifacts/
//	    logs/
type ProjectStore struct {
	baseDir string
	mu      sync.RWMutex
}

// NewProjectStore creates a ProjectStore rooted at baseDir.
// baseDir is created if it does not exist.
func NewProjectStore(baseDir string) *ProjectStore {
	os.MkdirAll(baseDir, 0755)
	return &ProjectStore{baseDir: baseDir}
}

// Create initialises a new project directory and writes project.json.
func (s *ProjectStore) Create(name, objective string, budget int, config ExecutorConfig) (*Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	datePart := now.Format("20060102")
	safeName := sanitizeFilename(name)
	id := fmt.Sprintf("%s_%s", datePart, safeName)

	// Ensure uniqueness by appending a short UUID suffix when collision occurs.
	projectDir := filepath.Join(s.baseDir, id)
	if _, err := os.Stat(projectDir); err == nil {
		suffix := uuid.New().String()[:8]
		id = fmt.Sprintf("%s_%s_%s", datePart, safeName, suffix)
		projectDir = filepath.Join(s.baseDir, id)
	}

	// Create subdirectories.
	for _, sub := range []string{"tasks", "context", "artifacts", "logs"} {
		if err := os.MkdirAll(filepath.Join(projectDir, sub), 0755); err != nil {
			return nil, fmt.Errorf("create subdir %s: %w", sub, err)
		}
	}

	// Write empty context index.
	emptyIndex := []byte("[]")
	if err := os.WriteFile(filepath.Join(projectDir, "context", "_index.json"), emptyIndex, 0644); err != nil {
		return nil, fmt.Errorf("write context index: %w", err)
	}

	p := &Project{
		ID:            id,
		Name:          name,
		Objective:     objective,
		Status:        ProjectStatusRunning,
		Priority:      PriorityNormal,
		CreatedAt:     now,
		UpdatedAt:     now,
		BudgetMinutes: budget,
		ExecutorConfig: config,
		Automation:    AutomationConfig{},
		TaskCount:     TaskCount{},
		Webhooks:      []WebhookConfig{},
	}

	if err := writeJSON(projectDir, "project.json", p); err != nil {
		return nil, fmt.Errorf("write project.json: %w", err)
	}
	return p, nil
}

// Load reads a project by its ID (directory name).
func (s *ProjectStore) Load(id string) (*Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadLocked(id)
}

func (s *ProjectStore) loadLocked(id string) (*Project, error) {
	path := filepath.Join(s.baseDir, id, "project.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("load project %q: %w", id, err)
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("parse project %q: %w", id, err)
	}
	return &p, nil
}

// List returns all projects sorted by UpdatedAt descending.
func (s *ProjectStore) List() ([]*Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}

	var projects []*Project
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p, err := s.loadLocked(e.Name())
		if err != nil {
			// Skip directories that don't contain a valid project.
			continue
		}
		projects = append(projects, p)
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})
	return projects, nil
}

// Update writes the project record back to disk, bumping UpdatedAt.
func (s *ProjectStore) Update(p *Project) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	p.UpdatedAt = time.Now().UTC()
	projectDir := filepath.Join(s.baseDir, p.ID)
	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		return fmt.Errorf("project %q not found", p.ID)
	}
	return writeJSON(projectDir, "project.json", p)
}

// AddTask persists a new task file inside the project's tasks/ directory.
func (s *ProjectStore) AddTask(projectID string, t *Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasksDir := filepath.Join(s.baseDir, projectID, "tasks")
	if _, err := os.Stat(tasksDir); os.IsNotExist(err) {
		return fmt.Errorf("project %q not found", projectID)
	}

	filename := taskFilename(t)
	return writeJSON(tasksDir, filename, t)
}

// UpdateTask overwrites an existing task file.
func (s *ProjectStore) UpdateTask(projectID, taskID string, t *Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasksDir := filepath.Join(s.baseDir, projectID, "tasks")
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return fmt.Errorf("read tasks dir for project %q: %w", projectID, err)
	}

	// Find existing file for this taskID.
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		existing, err := readTask(filepath.Join(tasksDir, e.Name()))
		if err != nil {
			continue
		}
		if existing.ID == taskID {
			// Remove old file (filename may change if title changed).
			os.Remove(filepath.Join(tasksDir, e.Name()))
			break
		}
	}

	filename := taskFilename(t)
	return writeJSON(tasksDir, filename, t)
}

// GetTasks returns all tasks for a project, sorted by ID.
func (s *ProjectStore) GetTasks(projectID string) ([]*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tasksDir := filepath.Join(s.baseDir, projectID, "tasks")
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return nil, fmt.Errorf("read tasks for project %q: %w", projectID, err)
	}

	var tasks []*Task
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		t, err := readTask(filepath.Join(tasksDir, e.Name()))
		if err != nil {
			continue
		}
		tasks = append(tasks, t)
	}

	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].ID < tasks[j].ID
	})
	return tasks, nil
}

// BaseDir returns the root directory for all projects.
func (ps *ProjectStore) BaseDir() string { return ps.baseDir }

// ---------- helpers ----------

func writeJSON(dir, filename string, v interface{}) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", filename, err)
	}
	return os.WriteFile(filepath.Join(dir, filename), data, 0644)
}

func readTask(path string) (*Task, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var t Task
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// taskFilename builds a filename for a task: {id}_{type}_{title}.json
func taskFilename(t *Task) string {
	title := sanitizeFilename(t.Title)
	return fmt.Sprintf("%s_%s_%s.json", sanitizeFilename(t.ID), string(t.Type), title)
}

var unsafeCharsRe = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

// sanitizeFilename replaces unsafe filesystem characters, keeps CJK characters,
// and caps the result at 60 characters.
func sanitizeFilename(s string) string {
	// Replace unsafe characters with underscore.
	result := unsafeCharsRe.ReplaceAllString(s, "_")

	// Replace spaces with underscore.
	result = strings.ReplaceAll(result, " ", "_")

	// Remove characters that are neither safe ASCII printables, underscores,
	// hyphens, dots, digits, nor CJK/unicode letters.
	var b strings.Builder
	for _, r := range result {
		if r == '_' || r == '-' || r == '.' ||
			(r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			unicode.Is(unicode.Han, r) ||
			unicode.Is(unicode.Hangul, r) ||
			unicode.Is(unicode.Hiragana, r) ||
			unicode.Is(unicode.Katakana, r) {
			b.WriteRune(r)
		} else if r == '_' {
			b.WriteRune('_')
		}
	}
	result = b.String()

	// Trim leading/trailing underscores and dots.
	result = strings.Trim(result, "_.")

	if len([]rune(result)) > 60 {
		runes := []rune(result)
		result = string(runes[:60])
	}

	if result == "" {
		result = "unnamed"
	}
	return result
}
