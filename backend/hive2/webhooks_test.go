package hive2

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWebhookDispatch(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()

	var received []WebhookPayload
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p WebhookPayload
		json.NewDecoder(r.Body).Decode(&p)
		mu.Lock()
		received = append(received, p)
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("测试项目", "目标", 30, cfg)
	p.Webhooks = []WebhookConfig{{URL: server.URL, Events: []string{"task.completed"}, Format: "json"}}
	store.Update(p)

	_ = NewWebhookDispatcher(store, bus)

	bus.Publish(Event{Type: "task.completed", ProjectID: p.ID, TaskID: "01"})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 webhook, got %d", len(received))
	}
	if received[0].Event != "task.completed" {
		t.Errorf("event = %s", received[0].Event)
	}
	if received[0].Project.Name != "测试项目" {
		t.Errorf("project name = %s", received[0].Project.Name)
	}
}

func TestWebhookFilterEvents(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()

	var count int
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		count++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	p.Webhooks = []WebhookConfig{{URL: server.URL, Events: []string{"project.completed"}, Format: "json"}}
	store.Update(p)

	_ = NewWebhookDispatcher(store, bus)

	// This should NOT trigger (not subscribed)
	bus.Publish(Event{Type: "task.completed", ProjectID: p.ID})
	// This SHOULD trigger
	bus.Publish(Event{Type: "project.completed", ProjectID: p.ID})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if count != 1 {
		t.Errorf("expected 1 dispatch, got %d", count)
	}
}

func TestWebhookSlackFormat(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()

	var body map[string]string
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		json.NewDecoder(r.Body).Decode(&body)
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	cfg := ExecutorConfig{}
	p, _ := store.Create("我的项目", "目标", 30, cfg)
	p.Webhooks = []WebhookConfig{{URL: server.URL, Events: []string{"*"}, Format: "slack"}}
	store.Update(p)

	_ = NewWebhookDispatcher(store, bus)
	bus.Publish(Event{Type: "task.failed", ProjectID: p.ID})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if body["text"] == "" {
		t.Error("expected slack text field")
	}
}
