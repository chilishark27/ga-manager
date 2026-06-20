package hive2

import (
	"os"
	"testing"
	"time"
)

// setupEngine creates a temp directory, a ProjectStore, an EventBus, a
// TaskEngine, and one project. It returns the engine, store, and projectID.
// Cleanup of the temp directory is registered with t.Cleanup.
func setupEngine(t *testing.T) (*TaskEngine, *ProjectStore, string) {
	t.Helper()
	dir, err := os.MkdirTemp("", "hive2-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })

	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)

	p, err := store.Create("test-project", "testing", 60, ExecutorConfig{})
	if err != nil {
		t.Fatalf("store.Create: %v", err)
	}
	return engine, store, p.ID
}

// makeTask is a small factory for test tasks.
func makeTask(id, title string, executor ExecutorType, deps []string, budget int) *Task {
	if deps == nil {
		deps = []string{}
	}
	return &Task{
		ID:            id,
		Type:          TaskTypeImplement,
		Title:         title,
		Executor:      executor,
		DependsOn:     deps,
		BudgetMinutes: budget,
	}
}

// TestResolvePending verifies the three-task linear chain:
//
//	01 (no deps) -> 02 (depends 01) -> 03 (depends 02)
//
// Only 01 should be pending initially; completing each task should
// successively unblock the next.
func TestResolvePending(t *testing.T) {
	engine, _, projectID := setupEngine(t)

	tasks := []*Task{
		makeTask("01", "first", ExecutorGA, nil, 10),
		makeTask("02", "second", ExecutorGA, []string{"01"}, 10),
		makeTask("03", "third", ExecutorGA, []string{"02"}, 10),
	}

	if err := engine.AddTasks(projectID, tasks); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}

	// After adding, only task 01 should be pending.
	all, _ := engine.store.GetTasks(projectID)
	statusOf := func(id string) TaskStatus {
		t.Helper()
		for _, task := range all {
			if task.ID == id {
				return task.Status
			}
		}
		t.Fatalf("task %s not found", id)
		return ""
	}
	refresh := func() {
		t.Helper()
		var err error
		all, err = engine.store.GetTasks(projectID)
		if err != nil {
			t.Fatalf("GetTasks: %v", err)
		}
	}

	refresh()
	if got := statusOf("01"); got != TaskStatusPending {
		t.Errorf("01 want pending, got %s", got)
	}
	if got := statusOf("02"); got != TaskStatusBlocked {
		t.Errorf("02 want blocked, got %s", got)
	}
	if got := statusOf("03"); got != TaskStatusBlocked {
		t.Errorf("03 want blocked, got %s", got)
	}

	// Claim and complete task 01; task 02 should become pending.
	if err := engine.ClaimTask(projectID, "01", "tester"); err != nil {
		t.Fatalf("ClaimTask 01: %v", err)
	}
	if err := engine.CompleteTask(projectID, "01", "done", TaskOutputs{}); err != nil {
		t.Fatalf("CompleteTask 01: %v", err)
	}
	refresh()
	if got := statusOf("02"); got != TaskStatusPending {
		t.Errorf("02 want pending after 01 done, got %s", got)
	}
	if got := statusOf("03"); got != TaskStatusBlocked {
		t.Errorf("03 want still blocked, got %s", got)
	}

	// Claim and complete task 02; task 03 should become pending.
	if err := engine.ClaimTask(projectID, "02", "tester"); err != nil {
		t.Fatalf("ClaimTask 02: %v", err)
	}
	if err := engine.CompleteTask(projectID, "02", "done", TaskOutputs{}); err != nil {
		t.Fatalf("CompleteTask 02: %v", err)
	}
	refresh()
	if got := statusOf("03"); got != TaskStatusPending {
		t.Errorf("03 want pending after 02 done, got %s", got)
	}
}

// TestClaimTaskNotPending verifies that claiming a task a second time returns
// an error (the task is already running, not pending).
func TestClaimTaskNotPending(t *testing.T) {
	engine, _, projectID := setupEngine(t)

	task := makeTask("t1", "only-task", ExecutorGA, nil, 10)
	if err := engine.AddTasks(projectID, []*Task{task}); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}

	if err := engine.ClaimTask(projectID, "t1", "a"); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if err := engine.ClaimTask(projectID, "t1", "b"); err == nil {
		t.Error("second claim: expected error, got nil")
	}
}

// TestProjectCompletion verifies that a project transitions to completed once
// its only task is marked done.
func TestProjectCompletion(t *testing.T) {
	engine, store, projectID := setupEngine(t)

	task := makeTask("solo", "only", ExecutorGA, nil, 10)
	if err := engine.AddTasks(projectID, []*Task{task}); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}
	if err := engine.ClaimTask(projectID, "solo", "bot"); err != nil {
		t.Fatalf("ClaimTask: %v", err)
	}
	if err := engine.CompleteTask(projectID, "solo", "finished", TaskOutputs{}); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}

	p, err := store.Load(projectID)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if p.Status != ProjectStatusCompleted {
		t.Errorf("project status: want completed, got %s", p.Status)
	}
}

// TestCheckTimeouts verifies that a running task whose budget has been exceeded
// is transitioned to stalled.
func TestCheckTimeouts(t *testing.T) {
	engine, _, projectID := setupEngine(t)

	// BudgetMinutes=1; we'll back-date StartedAt to trigger the timeout.
	task := makeTask("timeout-task", "timed", ExecutorGA, nil, 1)
	if err := engine.AddTasks(projectID, []*Task{task}); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}
	if err := engine.ClaimTask(projectID, "timeout-task", "runner"); err != nil {
		t.Fatalf("ClaimTask: %v", err)
	}

	// Back-date StartedAt so the task appears to have been running for 2 minutes.
	tasks, _ := engine.store.GetTasks(projectID)
	tt := findTask(tasks, "timeout-task")
	if tt == nil {
		t.Fatal("task not found after claim")
	}
	past := time.Now().UTC().Add(-2 * time.Minute)
	tt.StartedAt = &past
	if err := engine.store.UpdateTask(projectID, "timeout-task", tt); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}

	if err := engine.CheckTimeouts(projectID); err != nil {
		t.Fatalf("CheckTimeouts: %v", err)
	}

	// Verify the task is now stalled.
	tasks, _ = engine.store.GetTasks(projectID)
	tt = findTask(tasks, "timeout-task")
	if tt == nil {
		t.Fatal("task not found after CheckTimeouts")
	}
	if tt.Status != TaskStatusStalled {
		t.Errorf("want stalled, got %s", tt.Status)
	}
}
