package hive2

import (
	"fmt"
	"time"
)

// TaskEngine manages DAG scheduling for tasks within a project.
// It operates on a ProjectStore and publishes lifecycle events to an EventBus.
type TaskEngine struct {
	store       *ProjectStore
	eventBus    *EventBus
	stopTimeout chan struct{}
}

// NewTaskEngine creates a TaskEngine backed by store and eventBus.
func NewTaskEngine(store *ProjectStore, eventBus *EventBus) *TaskEngine {
	return &TaskEngine{store: store, eventBus: eventBus}
}

// ResolvePending finds all tasks with status=blocked whose every dependency
// has status=done, transitions them to pending, persists them, and returns the
// newly-unblocked tasks.
func (te *TaskEngine) ResolvePending(projectID string) ([]*Task, error) {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return nil, err
	}

	// Build a set of done task IDs.
	done := make(map[string]bool, len(tasks))
	for _, t := range tasks {
		if t.Status == TaskStatusDone {
			done[t.ID] = true
		}
	}

	var unblocked []*Task
	for _, t := range tasks {
		if t.Status != TaskStatusBlocked {
			continue
		}
		if allDone(t.DependsOn, done) {
			t.Status = TaskStatusPending
			if err := te.store.UpdateTask(projectID, t.ID, t); err != nil {
				return nil, fmt.Errorf("resolve pending task %s: %w", t.ID, err)
			}
			unblocked = append(unblocked, t)
		}
	}
	return unblocked, nil
}

// GetNextTask returns the first pending task whose Executor matches the given
// ExecutorType. Returns nil, nil when no matching task is available.
func (te *TaskEngine) GetNextTask(projectID string, executor ExecutorType) (*Task, error) {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return nil, err
	}
	for _, t := range tasks {
		if t.Status == TaskStatusPending && t.Executor == executor {
			return t, nil
		}
	}
	return nil, nil
}

// ClaimTask transitions a task from pending to running, recording the assignee
// and the current time as StartedAt. Returns an error if the task is not pending.
func (te *TaskEngine) ClaimTask(projectID, taskID, assignee string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}
	t := findTask(tasks, taskID)
	if t == nil {
		return fmt.Errorf("task %s not found in project %s", taskID, projectID)
	}
	if t.Status != TaskStatusPending {
		return fmt.Errorf("cannot claim task %s: status is %s, want pending", taskID, t.Status)
	}

	now := time.Now().UTC()
	t.Status = TaskStatusRunning
	t.AssignedTo = assignee
	t.StartedAt = &now

	if err := te.store.UpdateTask(projectID, taskID, t); err != nil {
		return fmt.Errorf("claim task %s: %w", taskID, err)
	}
	if err := te.updateTaskCount(projectID); err != nil {
		return err
	}
	return nil
}

// CompleteTask marks a running task as done, sets FinishedAt and Outputs,
// resolves newly-unblocked downstream tasks, checks for project completion,
// and publishes a "task.completed" event.
func (te *TaskEngine) CompleteTask(projectID, taskID, summary string, outputs TaskOutputs) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}
	t := findTask(tasks, taskID)
	if t == nil {
		return fmt.Errorf("task %s not found in project %s", taskID, projectID)
	}
	if t.Status != TaskStatusRunning {
		return fmt.Errorf("cannot complete task %s: status is %s, want running", taskID, t.Status)
	}

	now := time.Now().UTC()
	t.Status = TaskStatusDone
	t.FinishedAt = &now
	t.Outputs = outputs

	if err := te.store.UpdateTask(projectID, taskID, t); err != nil {
		return fmt.Errorf("complete task %s: %w", taskID, err)
	}

	// Unblock downstream tasks.
	if _, err := te.ResolvePending(projectID); err != nil {
		return err
	}

	if err := te.updateTaskCount(projectID); err != nil {
		return err
	}

	// Check whether the entire project is now complete.
	if err := te.checkProjectCompletion(projectID); err != nil {
		return err
	}

	te.eventBus.Publish(Event{
		Type:      "task.completed",
		ProjectID: projectID,
		TaskID:    taskID,
		Data:      map[string]interface{}{"summary": summary},
	})
	return nil
}

// FailTask marks a task as failed and publishes a "task.failed" event.
func (te *TaskEngine) FailTask(projectID, taskID, errorMsg string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}
	t := findTask(tasks, taskID)
	if t == nil {
		return fmt.Errorf("task %s not found in project %s", taskID, projectID)
	}

	t.Status = TaskStatusFailed
	t.Error = errorMsg

	if err := te.store.UpdateTask(projectID, taskID, t); err != nil {
		return fmt.Errorf("fail task %s: %w", taskID, err)
	}
	if err := te.updateTaskCount(projectID); err != nil {
		return err
	}

	te.eventBus.Publish(Event{
		Type:      "task.failed",
		ProjectID: projectID,
		TaskID:    taskID,
		Data:      map[string]interface{}{"error": errorMsg},
	})
	return nil
}

// CheckTimeouts scans running tasks for the project and marks any whose
// BudgetMinutes has been exceeded (based on StartedAt) as stalled.
func (te *TaskEngine) CheckTimeouts(projectID string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, t := range tasks {
		if t.Status != TaskStatusRunning {
			continue
		}
		if t.BudgetMinutes <= 0 || t.StartedAt == nil {
			continue
		}
		elapsed := now.Sub(*t.StartedAt).Minutes()
		if elapsed >= float64(t.BudgetMinutes) {
			t.Status = TaskStatusStalled
			if err := te.store.UpdateTask(projectID, t.ID, t); err != nil {
				return fmt.Errorf("stall task %s: %w", t.ID, err)
			}
		}
	}
	return nil
}

// AddTasks bulk-adds tasks to a project. Each task's initial status is set to
// pending when it has no dependencies, or blocked otherwise. After all tasks
// are persisted ResolvePending is called and the project TaskCount is updated.
func (te *TaskEngine) AddTasks(projectID string, tasks []*Task) error {
	for _, t := range tasks {
		if len(t.DependsOn) == 0 {
			t.Status = TaskStatusPending
		} else {
			t.Status = TaskStatusBlocked
		}
		if err := te.store.AddTask(projectID, t); err != nil {
			return fmt.Errorf("add task %s: %w", t.ID, err)
		}
	}

	if _, err := te.ResolvePending(projectID); err != nil {
		return err
	}
	return te.updateTaskCount(projectID)
}

// StartTimeoutChecker runs CheckTimeouts for every project on the given interval.
// It is idempotent: calling it again while a checker is running stops the old one first.
func (te *TaskEngine) StartTimeoutChecker(interval time.Duration) {
	te.StopTimeoutChecker()
	stop := make(chan struct{})
	te.stopTimeout = stop
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				projects, err := te.store.List()
				if err != nil {
					continue
				}
				for _, p := range projects {
					if p.Status == ProjectStatusRunning {
						te.CheckTimeouts(p.ID) //nolint:errcheck
					}
				}
			case <-stop:
				return
			}
		}
	}()
}

// StopTimeoutChecker halts the background timeout ticker if it is running.
func (te *TaskEngine) StopTimeoutChecker() {
	if te.stopTimeout != nil {
		close(te.stopTimeout)
		te.stopTimeout = nil
	}
}

// ---------- private helpers ----------

// checkProjectCompletion marks a project as completed when all its tasks are done.
func (te *TaskEngine) checkProjectCompletion(projectID string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}
	if len(tasks) == 0 {
		return nil
	}
	for _, t := range tasks {
		if t.Status != TaskStatusDone {
			return nil
		}
	}

	p, err := te.store.Load(projectID)
	if err != nil {
		return err
	}
	if p.Status == ProjectStatusCompleted {
		return nil
	}
	p.Status = ProjectStatusCompleted
	if err := te.store.Update(p); err != nil {
		return err
	}

	te.eventBus.Publish(Event{
		Type:      "project.completed",
		ProjectID: projectID,
	})
	return nil
}

// updateTaskCount recomputes and persists the TaskCount summary for a project.
func (te *TaskEngine) updateTaskCount(projectID string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	var tc TaskCount
	tc.Total = len(tasks)
	for _, t := range tasks {
		switch t.Status {
		case TaskStatusDone:
			tc.Done++
		case TaskStatusRunning:
			tc.Running++
		case TaskStatusPending:
			tc.Pending++
		case TaskStatusFailed:
			tc.Failed++
		}
	}

	p, err := te.store.Load(projectID)
	if err != nil {
		return err
	}
	p.TaskCount = tc
	return te.store.Update(p)
}

// ---------- package-level helpers ----------

// findTask returns the task with the given ID from tasks, or nil.
func findTask(tasks []*Task, id string) *Task {
	for _, t := range tasks {
		if t.ID == id {
			return t
		}
	}
	return nil
}

// allDone reports whether every id in deps is present in done.
func allDone(deps []string, done map[string]bool) bool {
	for _, d := range deps {
		if !done[d] {
			return false
		}
	}
	return true
}
