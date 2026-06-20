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
