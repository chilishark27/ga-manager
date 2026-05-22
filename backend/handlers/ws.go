package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"ga_manager/services"

	"github.com/gorilla/websocket"
)

func wsLog(format string, args ...interface{}) {
	f, _ := os.OpenFile("ws_debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if f != nil {
		defer f.Close()
		msg := fmt.Sprintf("[%s] %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
		f.WriteString(msg)
	}
}

// WSHandler handles WebSocket connections between frontend and bridge instances
type WSHandler struct {
	manager  *services.InstanceManager
	upgrader websocket.Upgrader
}

// NewWSHandler creates a new WebSocket handler
func NewWSHandler(mgr *services.InstanceManager) *WSHandler {
	return &WSHandler{
		manager: mgr,
		upgrader: websocket.Upgrader{
			CheckOrigin:     func(r *http.Request) bool { return true },
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		},
	}
}

// Handle upgrades the HTTP connection and bridges between frontend WS and bridge subprocess.
// GET /api/instances/{id}/ws
func (h *WSHandler) Handle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	// Subscribe to instance events
	subID, eventCh, unsub, err := h.manager.Subscribe(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer unsub()

	// Upgrade to WebSocket
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed for instance %s: %v", id, err)
		return
	}
	defer conn.Close()

	log.Printf("[WS] Client connected to instance %s (sub=%s)", id, subID)
	wsLog("CLIENT CONNECTED instance=%s sub=%s", id, subID)

	// Set up ping/pong for keepalive
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	done := make(chan struct{})

	// Goroutine: read from frontend WS → send command to bridge stdin
	go func() {
		defer close(done)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Printf("[WS] Read error for instance %s: %v", id, err)
				}
				wsLog("READ LOOP EXIT instance=%s err=%v", id, err)
				return
			}

			wsLog("GOT MSG instance=%s raw=%s", id, string(msg))

			// Parse the frontend message and convert to bridge command
			var frontendMsg map[string]interface{}
			if err := json.Unmarshal(msg, &frontendMsg); err != nil {
				log.Printf("[WS] Invalid JSON from client: %v", err)
				wsLog("JSON PARSE ERROR: %v", err)
				continue
			}

			// Convert frontend message format to bridge stdin command format
			bridgeCmd := convertToBridgeCommand(frontendMsg)
			if bridgeCmd == nil {
				wsLog("CONVERT RETURNED NIL for msg: %v", frontendMsg)
				continue
			}

			wsLog("SENDING CMD instance=%s cmd=%v", id, bridgeCmd)
			if err := h.manager.SendCommand(id, bridgeCmd); err != nil {
				wsLog("SEND CMD ERROR instance=%s err=%v", id, err)
				log.Printf("[WS] SendCommand failed for instance %s: %v", id, err)
				// Send error back to client
				errResp, _ := json.Marshal(map[string]interface{}{
					"event": "error",
					"msg":   err.Error(),
				})
				_ = conn.WriteMessage(websocket.TextMessage, errResp)
			}
		}
	}()

	// Goroutine: ping ticker for keepalive
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()

	// Main loop: read events from bridge → send to frontend WS
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				// Channel closed, instance removed
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, event); err != nil {
				log.Printf("[WS] Write error for instance %s: %v", id, err)
				return
			}

		case <-pingTicker.C:
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second)); err != nil {
				return
			}

		case <-done:
			// Client disconnected
			return
		}
	}
}

// convertToBridgeCommand converts a frontend WS message to a bridge stdin command.
// Frontend sends: {"type": "chat", "query": "..."} or {"type": "abort"} etc.
// Bridge expects: {"cmd": "send", "text": "..."} or {"cmd": "abort"} etc.
func convertToBridgeCommand(msg map[string]interface{}) map[string]interface{} {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "chat":
		query, _ := msg["query"].(string)
		if query == "" {
			// Also try "message" field for compatibility
			query, _ = msg["message"].(string)
		}
		if query == "" {
			return nil
		}
		result := map[string]interface{}{
			"cmd":  "send",
			"text": query,
		}
		// Pass through images if provided (base64 data URLs)
		if images, ok := msg["images"]; ok {
			result["images"] = images
		}
		// Pass through files if provided
		if files, ok := msg["files"]; ok {
			result["files"] = files
		}
		return result

	case "abort":
		return map[string]interface{}{
			"cmd": "abort",
		}

	case "status":
		return map[string]interface{}{
			"cmd": "status",
		}

	case "config":
		// Pass through config commands
		key, _ := msg["key"].(string)
		value := msg["value"]
		return map[string]interface{}{
			"cmd":   "set_config",
			"key":   key,
			"value": value,
		}

	case "switch_llm":
		llmNo := msg["llm_no"]
		return map[string]interface{}{
			"cmd":    "switch_llm",
			"llm_no": llmNo,
		}

	case "ping":
		return map[string]interface{}{
			"cmd": "ping",
		}

	default:
		log.Printf("[WS] Unknown frontend message type: %s", msgType)
		return nil
	}
}
