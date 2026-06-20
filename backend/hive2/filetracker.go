package hive2

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// FileTracker monitors artifacts/ directories for file changes
// and attributes them to currently running tasks.
type FileTracker struct {
	store    *ProjectStore
	eventBus *EventBus
	mu       sync.Mutex
	// Track known file state per project: projectID -> filepath -> fileState
	known  map[string]map[string]fileState
	stopCh chan struct{}
}

type fileState struct {
	ModTime time.Time
	Size    int64
}

// NewFileTracker creates a FileTracker backed by store and eventBus.
func NewFileTracker(store *ProjectStore, eventBus *EventBus) *FileTracker {
	return &FileTracker{
		store:    store,
		eventBus: eventBus,
		known:    make(map[string]map[string]fileState),
		stopCh:   make(chan struct{}),
	}
}

// Start begins polling all running projects' artifacts/ dirs every interval.
func (ft *FileTracker) Start(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ft.stopCh:
				return
			case <-ticker.C:
				projects, err := ft.store.List()
				if err != nil {
					continue
				}
				for _, p := range projects {
					if p.Status == ProjectStatusRunning {
						ft.ScanProject(p.ID) //nolint:errcheck
					}
				}
			}
		}
	}()
}

// Stop halts the polling loop.
func (ft *FileTracker) Stop() {
	close(ft.stopCh)
}

// ScanProject does a one-time scan of a project's artifacts/ directory.
// Returns any new FileChange entries detected since last scan.
// Attributes changes to the first running task in the project.
func (ft *FileTracker) ScanProject(projectID string) ([]FileChange, error) {
	artDir := filepath.Join(ft.store.baseDir, projectID, "artifacts")

	// Walk current files (exclude _changes.json itself).
	current := make(map[string]fileState)
	err := filepath.Walk(artDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip unreadable entries
		}
		if info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(artDir, path)
		if rel == "_changes.json" {
			return nil
		}
		current[rel] = fileState{ModTime: info.ModTime(), Size: info.Size()}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Find the first running task for attribution.
	taskID := ""
	tasks, _ := ft.store.GetTasks(projectID)
	for _, t := range tasks {
		if t.Status == TaskStatusRunning {
			taskID = t.ID
			break
		}
	}

	ft.mu.Lock()
	defer ft.mu.Unlock()

	prev, ok := ft.known[projectID]
	if !ok {
		// First scan — record baseline, no changes reported.
		ft.known[projectID] = current
		return nil, nil
	}

	var changes []FileChange
	now := time.Now().UTC()

	// Detect created and modified files.
	for rel, cur := range current {
		old, existed := prev[rel]
		if !existed {
			changes = append(changes, FileChange{
				File:      rel,
				Action:    "created",
				TaskID:    taskID,
				Timestamp: now,
				SizeBytes: cur.Size,
			})
		} else if cur.ModTime.After(old.ModTime) || cur.Size != old.Size {
			changes = append(changes, FileChange{
				File:      rel,
				Action:    "modified",
				TaskID:    taskID,
				Timestamp: now,
				SizeBytes: cur.Size,
			})
		}
	}

	// Detect deleted files.
	for rel := range prev {
		if _, exists := current[rel]; !exists {
			changes = append(changes, FileChange{
				File:      rel,
				Action:    "deleted",
				TaskID:    taskID,
				Timestamp: now,
				SizeBytes: 0,
			})
		}
	}

	// Update known state.
	ft.known[projectID] = current

	// Persist and publish changes.
	for _, ch := range changes {
		if err := ft.recordChangeLocked(projectID, ch); err != nil {
			continue
		}
		evtType := "artifact.created"
		if ch.Action == "modified" {
			evtType = "artifact.modified"
		}
		if ch.Action == "created" || ch.Action == "modified" {
			ft.eventBus.Publish(Event{
				Type:      evtType,
				ProjectID: projectID,
				TaskID:    ch.TaskID,
				Data:      map[string]interface{}{"file": ch.File, "size": ch.SizeBytes},
			})
		}
	}

	return changes, nil
}

// GetChanges returns all recorded file changes for a project (from _changes.json).
func (ft *FileTracker) GetChanges(projectID string) ([]FileChange, error) {
	path := filepath.Join(ft.store.baseDir, projectID, "artifacts", "_changes.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var changes []FileChange
	if err := json.Unmarshal(data, &changes); err != nil {
		return nil, err
	}
	return changes, nil
}

// RecordChange manually records a file change (used by MCP when Claude Code reports artifacts).
func (ft *FileTracker) RecordChange(projectID string, change FileChange) error {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	return ft.recordChangeLocked(projectID, change)
}

// recordChangeLocked appends a change to _changes.json. Caller must hold ft.mu.
func (ft *FileTracker) recordChangeLocked(projectID string, change FileChange) error {
	path := filepath.Join(ft.store.baseDir, projectID, "artifacts", "_changes.json")

	var existing []FileChange
	data, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(data, &existing) //nolint:errcheck
	}

	existing = append(existing, change)
	out, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0644)
}
