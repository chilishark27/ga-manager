package hive2

import "sync"

// Event represents a system event published on the EventBus.
type Event struct {
	Type      string                 // e.g. "task.completed", "task.failed", "project.completed"
	ProjectID string
	TaskID    string
	Data      map[string]interface{}
}

// EventBus is a simple pub/sub bus. Handlers are called synchronously in
// Publish, so callers should not hold locks when calling Publish.
// The wildcard subscription key "*" receives every event.
type EventBus struct {
	mu       sync.RWMutex
	handlers map[string][]func(Event)
}

// NewEventBus creates an empty EventBus.
func NewEventBus() *EventBus {
	return &EventBus{
		handlers: make(map[string][]func(Event)),
	}
}

// Subscribe registers handler to be called whenever an event of eventType is
// published. Use "*" to receive all events.
func (eb *EventBus) Subscribe(eventType string, handler func(Event)) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	eb.handlers[eventType] = append(eb.handlers[eventType], handler)
}

// Publish dispatches event to all subscribers matching event.Type and to all
// wildcard ("*") subscribers.
func (eb *EventBus) Publish(event Event) {
	eb.mu.RLock()
	typed := make([]func(Event), len(eb.handlers[event.Type]))
	copy(typed, eb.handlers[event.Type])
	wildcard := make([]func(Event), len(eb.handlers["*"]))
	copy(wildcard, eb.handlers["*"])
	eb.mu.RUnlock()

	for _, h := range typed {
		h(event)
	}
	// Avoid calling the same handler twice if it was registered for both the
	// specific type and the wildcard (unusual, but guard it).
	for _, h := range wildcard {
		h(event)
	}
}
