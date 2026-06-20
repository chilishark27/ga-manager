package hive2

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileScanDetectsNewFile(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)

	// Add a running task for attribution
	engine := NewTaskEngine(store, bus)
	engine.AddTasks(p.ID, []*Task{{ID: "01", Type: TaskTypeImplement, Title: "实现", Executor: ExecutorClaudeCode}})
	engine.ClaimTask(p.ID, "01", "claude")

	ft := NewFileTracker(store, bus)

	// Initial scan (empty) — establishes baseline
	changes, _ := ft.ScanProject(p.ID)
	if len(changes) != 0 {
		t.Errorf("expected 0 changes, got %d", len(changes))
	}

	// Create a file in artifacts/
	artDir := filepath.Join(dir, p.ID, "artifacts")
	os.WriteFile(filepath.Join(artDir, "test.py"), []byte("print('hi')"), 0644)

	// Scan again
	changes, _ = ft.ScanProject(p.ID)
	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Action != "created" {
		t.Errorf("action = %s, want created", changes[0].Action)
	}
	if changes[0].TaskID != "01" {
		t.Errorf("taskID = %s, want 01", changes[0].TaskID)
	}
}

func TestFileGetChanges(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	ft := NewFileTracker(store, bus)

	change := FileChange{File: "test.py", Action: "created", TaskID: "01", Timestamp: time.Now(), SizeBytes: 100}
	ft.RecordChange(p.ID, change)

	got, _ := ft.GetChanges(p.ID)
	if len(got) != 1 {
		t.Fatalf("expected 1 recorded change, got %d", len(got))
	}
	if got[0].File != "test.py" {
		t.Errorf("file = %s, want test.py", got[0].File)
	}
}

func TestFileModifiedDetection(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	ft := NewFileTracker(store, bus)

	artDir := filepath.Join(dir, p.ID, "artifacts")
	os.WriteFile(filepath.Join(artDir, "file.txt"), []byte("v1"), 0644)
	ft.ScanProject(p.ID) // baseline

	// Modify file (change content = different size)
	time.Sleep(10 * time.Millisecond)
	os.WriteFile(filepath.Join(artDir, "file.txt"), []byte("v2 longer"), 0644)

	changes, _ := ft.ScanProject(p.ID)
	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Action != "modified" {
		t.Errorf("action = %s, want modified", changes[0].Action)
	}
}
