package hive2

import "testing"

func TestWorkerPoolAllocateAndRelease(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)
	cfg := HiveGlobalConfig{MaxGAWorkersTotal: 3, WorkerPoolShared: true}
	pool := NewWorkerPool(cfg, engine, store, bus)

	w1, err := pool.AllocateWorker("proj1")
	if err != nil {
		t.Fatal(err)
	}
	w2, _ := pool.AllocateWorker("proj1")
	w3, _ := pool.AllocateWorker("proj2")

	// Pool should be full now
	_, err = pool.AllocateWorker("proj3")
	if err == nil {
		t.Error("expected error when pool is full")
	}

	pool.ReleaseWorker(w1)
	// Should be able to allocate again
	_, err = pool.AllocateWorker("proj3")
	if err != nil {
		t.Errorf("expected success after release: %v", err)
	}

	_ = w2
	_ = w3
}

func TestWorkerPoolAssignTask(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)
	cfg := HiveGlobalConfig{MaxGAWorkersTotal: 5, WorkerPoolShared: true}
	pool := NewWorkerPool(cfg, engine, store, bus)

	wID, _ := pool.AllocateWorker("proj1")
	pool.AssignTask(wID, "task_01")

	workers := pool.GetWorkers()
	found := false
	for _, w := range workers {
		if w.ID == wID && w.Status == "busy" && w.TaskID == "task_01" {
			found = true
		}
	}
	if !found {
		t.Error("worker not found in busy state")
	}

	pool.FreeWorker(wID)
	workers = pool.GetWorkers()
	for _, w := range workers {
		if w.ID == wID && w.Status != "idle" {
			t.Error("worker should be idle after free")
		}
	}
}

func TestWorkerPoolPriorityScheduling(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)
	cfg := HiveGlobalConfig{MaxGAWorkersTotal: 5, WorkerPoolShared: true}
	pool := NewWorkerPool(cfg, engine, store, bus)

	// Create two projects with different priorities
	ecfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	pLow, _ := store.Create("低优先级", "目标L", 30, ecfg)
	pLow.Priority = PriorityLow
	store.Update(pLow)

	pHigh, _ := store.Create("高优先级", "目标H", 30, ecfg)
	pHigh.Priority = PriorityHigh
	store.Update(pHigh)

	// Add tasks to both
	engine.AddTasks(pLow.ID, []*Task{{ID: "01", Type: TaskTypeResearch, Title: "低任务", Executor: ExecutorGA}})
	engine.AddTasks(pHigh.ID, []*Task{{ID: "01", Type: TaskTypeResearch, Title: "高任务", Executor: ExecutorGA}})

	wID, _ := pool.AllocateWorker("any")
	projID, task, _ := pool.GetNextTaskForWorker(wID)

	if projID != pHigh.ID {
		t.Errorf("expected high priority project, got %s", projID)
	}
	if task == nil || task.Title != "高任务" {
		t.Error("expected high priority task")
	}
}
