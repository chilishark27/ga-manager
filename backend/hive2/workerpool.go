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
