package hive2

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

var workerSeq uint64

// WorkerInfo tracks a logical worker slot
type WorkerInfo struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	TaskID    string    `json:"task_id,omitempty"`
	Status    string    `json:"status"` // idle, busy
	StartedAt time.Time `json:"started_at"`
}

// WorkerPool manages GA worker slots across projects
type WorkerPool struct {
	mu       sync.Mutex
	config   HiveGlobalConfig
	workers  map[string]*WorkerInfo // workerID -> info
	engine   *TaskEngine
	store    *ProjectStore
	eventBus *EventBus
}

func NewWorkerPool(config HiveGlobalConfig, engine *TaskEngine, store *ProjectStore, eventBus *EventBus) *WorkerPool {
	return &WorkerPool{
		config:   config,
		workers:  make(map[string]*WorkerInfo),
		engine:   engine,
		store:    store,
		eventBus: eventBus,
	}
}

// AllocateWorker assigns a worker slot to a project. Returns worker ID or error if pool is full.
func (wp *WorkerPool) AllocateWorker(projectID string) (string, error) {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	if len(wp.workers) >= wp.config.MaxGAWorkersTotal {
		return "", fmt.Errorf("worker pool full (%d/%d)", len(wp.workers), wp.config.MaxGAWorkersTotal)
	}

	prefix := projectID
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	seq := atomic.AddUint64(&workerSeq, 1)
	id := fmt.Sprintf("worker-%s-%d-%d", prefix, time.Now().UnixNano()%10000, seq)
	wp.workers[id] = &WorkerInfo{
		ID:        id,
		ProjectID: projectID,
		Status:    "idle",
		StartedAt: time.Now(),
	}
	return id, nil
}

// ReleaseWorker removes a worker from the pool
func (wp *WorkerPool) ReleaseWorker(workerID string) {
	wp.mu.Lock()
	defer wp.mu.Unlock()
	delete(wp.workers, workerID)
}

// AssignTask marks a worker as busy with a specific task
func (wp *WorkerPool) AssignTask(workerID, taskID string) error {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	w, ok := wp.workers[workerID]
	if !ok {
		return fmt.Errorf("worker %s not found", workerID)
	}
	w.TaskID = taskID
	w.Status = "busy"
	return nil
}

// FreeWorker marks a worker as idle (task completed)
func (wp *WorkerPool) FreeWorker(workerID string) {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	if w, ok := wp.workers[workerID]; ok {
		w.TaskID = ""
		w.Status = "idle"
	}
}

// GetNextTaskForWorker finds the best task across all projects for a given worker.
// Priority order: high > normal > low projects, then FIFO within same priority.
func (wp *WorkerPool) GetNextTaskForWorker(workerID string) (projectID string, task *Task, err error) {
	wp.mu.Lock()
	w, ok := wp.workers[workerID]
	wp.mu.Unlock()
	if !ok {
		return "", nil, fmt.Errorf("worker %s not found", workerID)
	}

	if !wp.config.WorkerPoolShared {
		// Non-shared mode: only look at worker's own project
		t, err := wp.engine.GetNextTask(w.ProjectID, ExecutorGA)
		return w.ProjectID, t, err
	}

	// Shared mode: look across all running projects by priority
	projects, _ := wp.store.List()
	priorityOrder := []Priority{PriorityHigh, PriorityNormal, PriorityLow}

	for _, pri := range priorityOrder {
		for _, p := range projects {
			if p.Status != ProjectStatusRunning || p.Priority != pri {
				continue
			}
			t, err := wp.engine.GetNextTask(p.ID, ExecutorGA)
			if err == nil && t != nil {
				return p.ID, t, nil
			}
		}
	}
	return "", nil, nil
}

// GetWorkers returns all current workers
func (wp *WorkerPool) GetWorkers() []WorkerInfo {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	var result []WorkerInfo
	for _, w := range wp.workers {
		result = append(result, *w)
	}
	return result
}

// GetWorkersForProject returns workers assigned to a specific project
func (wp *WorkerPool) GetWorkersForProject(projectID string) []WorkerInfo {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	var result []WorkerInfo
	for _, w := range wp.workers {
		if w.ProjectID == projectID {
			result = append(result, *w)
		}
	}
	return result
}

// Stats returns pool utilization info
func (wp *WorkerPool) Stats() map[string]interface{} {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	busy := 0
	for _, w := range wp.workers {
		if w.Status == "busy" {
			busy++
		}
	}
	return map[string]interface{}{
		"total": len(wp.workers),
		"max":   wp.config.MaxGAWorkersTotal,
		"busy":  busy,
		"idle":  len(wp.workers) - busy,
	}
}
