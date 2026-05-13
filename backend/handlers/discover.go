package handlers

import (
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// DiscoveredInstance represents a GA instance found via port scanning
type DiscoveredInstance struct {
	Port   int    `json:"port"`
	URL    string `json:"url"`
	Status string `json:"status"` // "active"
}

type DiscoverHandler struct{}

func NewDiscoverHandler() *DiscoverHandler {
	return &DiscoverHandler{}
}

// Discover scans ports 18501-18599 for running Streamlit GA instances
// GET /api/discover
func (h *DiscoverHandler) Discover(w http.ResponseWriter, r *http.Request) {
	const portStart = 18501
	const portEnd = 18599
	const timeout = 200 * time.Millisecond

	var mu sync.Mutex
	var results []DiscoveredInstance
	var wg sync.WaitGroup

	// Scan ports concurrently with a semaphore to limit concurrency
	sem := make(chan struct{}, 30)

	for port := portStart; port <= portEnd; port++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(p int) {
			defer wg.Done()
			defer func() { <-sem }()

			addr := fmt.Sprintf("127.0.0.1:%d", p)
			conn, err := net.DialTimeout("tcp", addr, timeout)
			if err == nil {
				conn.Close()
				mu.Lock()
				results = append(results, DiscoveredInstance{
					Port:   p,
					URL:    fmt.Sprintf("http://localhost:%d", p),
					Status: "active",
				})
				mu.Unlock()
			}
		}(port)
	}

	wg.Wait()

	if results == nil {
		results = []DiscoveredInstance{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"instances": results,
		"scanned":   portEnd - portStart + 1,
	})
}
