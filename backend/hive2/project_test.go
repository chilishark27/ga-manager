package hive2

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProjectCreateAndLoad(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	cfg := ExecutorConfig{GALlmNo: 1, GAWorkers: 2, ClaudeCodeEnabled: true}
	p, err := store.Create("TestProject", "Build something great", 120, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Verify the project ID is non-empty and directory exists.
	if p.ID == "" {
		t.Fatal("expected non-empty project ID")
	}
	projectDir := filepath.Join(dir, p.ID)
	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		t.Fatalf("project directory %q not created", projectDir)
	}

	// Verify subdirectories exist.
	for _, sub := range []string{"tasks", "context", "artifacts", "logs"} {
		subPath := filepath.Join(projectDir, sub)
		if _, err := os.Stat(subPath); os.IsNotExist(err) {
			t.Errorf("subdirectory %q not created", subPath)
		}
	}

	// Verify context/_index.json contains "[]".
	indexPath := filepath.Join(projectDir, "context", "_index.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("read context index: %v", err)
	}
	if string(data) != "[]" {
		t.Errorf("expected context index to be '[]', got %q", string(data))
	}

	// Load and verify fields.
	loaded, err := store.Load(p.ID)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if loaded.Name != "TestProject" {
		t.Errorf("Name: got %q, want %q", loaded.Name, "TestProject")
	}
	if loaded.Objective != "Build something great" {
		t.Errorf("Objective: got %q, want %q", loaded.Objective, "Build something great")
	}
	if loaded.BudgetMinutes != 120 {
		t.Errorf("BudgetMinutes: got %d, want 120", loaded.BudgetMinutes)
	}
	if loaded.ExecutorConfig.GALlmNo != 1 {
		t.Errorf("GALlmNo: got %d, want 1", loaded.ExecutorConfig.GALlmNo)
	}
	if loaded.ExecutorConfig.GAWorkers != 2 {
		t.Errorf("GAWorkers: got %d, want 2", loaded.ExecutorConfig.GAWorkers)
	}
	if !loaded.ExecutorConfig.ClaudeCodeEnabled {
		t.Error("ClaudeCodeEnabled: got false, want true")
	}
	if loaded.Status != ProjectStatusRunning {
		t.Errorf("Status: got %q, want %q", loaded.Status, ProjectStatusRunning)
	}
}

func TestProjectList(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	cfg := ExecutorConfig{}

	p1, err := store.Create("Alpha", "First project", 60, cfg)
	if err != nil {
		t.Fatalf("Create Alpha: %v", err)
	}

	// Sleep briefly so UpdatedAt timestamps differ.
	time.Sleep(5 * time.Millisecond)

	p2, err := store.Create("Beta", "Second project", 30, cfg)
	if err != nil {
		t.Fatalf("Create Beta: %v", err)
	}

	projects, err := store.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(projects) != 2 {
		t.Fatalf("List: got %d projects, want 2", len(projects))
	}

	// Sorted by UpdatedAt descending — Beta (newer) should be first.
	if projects[0].ID != p2.ID {
		t.Errorf("expected first project to be %q (Beta), got %q", p2.ID, projects[0].ID)
	}
	if projects[1].ID != p1.ID {
		t.Errorf("expected second project to be %q (Alpha), got %q", p1.ID, projects[1].ID)
	}
}

func TestTaskAddAndGet(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	p, err := store.Create("TaskTest", "Test tasks", 60, ExecutorConfig{})
	if err != nil {
		t.Fatalf("Create project: %v", err)
	}

	task := &Task{
		ID:            "task-001",
		Type:          TaskTypeImplement,
		Title:         "Write the handler",
		Status:        TaskStatusPending,
		Executor:      ExecutorGA,
		DependsOn:     []string{"task-000"},
		BudgetMinutes: 30,
	}

	if err := store.AddTask(p.ID, task); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	tasks, err := store.GetTasks(p.ID)
	if err != nil {
		t.Fatalf("GetTasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("GetTasks: got %d tasks, want 1", len(tasks))
	}

	got := tasks[0]
	if got.ID != "task-001" {
		t.Errorf("ID: got %q, want %q", got.ID, "task-001")
	}
	if got.Type != TaskTypeImplement {
		t.Errorf("Type: got %q, want %q", got.Type, TaskTypeImplement)
	}
	if got.Title != "Write the handler" {
		t.Errorf("Title: got %q, want %q", got.Title, "Write the handler")
	}
	if got.Status != TaskStatusPending {
		t.Errorf("Status: got %q, want %q", got.Status, TaskStatusPending)
	}
	if got.Executor != ExecutorGA {
		t.Errorf("Executor: got %q, want %q", got.Executor, ExecutorGA)
	}
	if len(got.DependsOn) != 1 || got.DependsOn[0] != "task-000" {
		t.Errorf("DependsOn: got %v, want [task-000]", got.DependsOn)
	}
	if got.BudgetMinutes != 30 {
		t.Errorf("BudgetMinutes: got %d, want 30", got.BudgetMinutes)
	}
}
