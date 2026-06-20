package hive2

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// WebhookPayload is sent to webhook URLs
type WebhookPayload struct {
	Event     string                 `json:"event"`
	Timestamp string                 `json:"timestamp"`
	Project   WebhookProjectInfo     `json:"project"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type WebhookProjectInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// WebhookDispatcher subscribes to events and dispatches webhooks
type WebhookDispatcher struct {
	store  *ProjectStore
	client *http.Client
}

func NewWebhookDispatcher(store *ProjectStore, eventBus *EventBus) *WebhookDispatcher {
	wd := &WebhookDispatcher{
		store:  store,
		client: &http.Client{Timeout: 10 * time.Second},
	}
	// Subscribe to all events
	eventBus.Subscribe("*", wd.handleEvent)
	return wd
}

func (wd *WebhookDispatcher) handleEvent(event Event) {
	if event.ProjectID == "" {
		return
	}
	p, err := wd.store.Load(event.ProjectID)
	if err != nil || len(p.Webhooks) == 0 {
		return
	}

	for _, wh := range p.Webhooks {
		if !wd.matchesEvent(wh, event.Type) {
			continue
		}
		go wd.dispatch(wh, event, p)
	}
}

func (wd *WebhookDispatcher) matchesEvent(wh WebhookConfig, eventType string) bool {
	for _, e := range wh.Events {
		if e == "*" || e == eventType {
			return true
		}
	}
	return false
}

func (wd *WebhookDispatcher) dispatch(wh WebhookConfig, event Event, p *Project) {
	payload := WebhookPayload{
		Event:     event.Type,
		Timestamp: time.Now().Format(time.RFC3339),
		Project:   WebhookProjectInfo{ID: p.ID, Name: p.Name},
		Data:      event.Data,
	}

	var body []byte
	var err error

	switch wh.Format {
	case "slack":
		body, err = wd.formatSlack(payload)
	default: // "json"
		body, err = json.Marshal(payload)
	}
	if err != nil {
		log.Printf("[Webhook] marshal error: %v", err)
		return
	}

	// Retry up to 3 times
	for attempt := 0; attempt < 3; attempt++ {
		req, _ := http.NewRequest("POST", wh.URL, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := wd.client.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 300 {
				return
			}
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
	log.Printf("[Webhook] failed after 3 attempts: %s -> %s", event.Type, wh.URL)
}

func (wd *WebhookDispatcher) formatSlack(payload WebhookPayload) ([]byte, error) {
	text := fmt.Sprintf("*[%s]* %s — %s", payload.Event, payload.Project.Name, payload.Timestamp)
	msg := map[string]string{"text": text}
	return json.Marshal(msg)
}
