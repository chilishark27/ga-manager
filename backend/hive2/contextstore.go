package hive2

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ContextStore struct {
	store *ProjectStore
}

func NewContextStore(store *ProjectStore) *ContextStore {
	return &ContextStore{store: store}
}

func (cs *ContextStore) contextDir(projectID string) string {
	return filepath.Join(cs.store.baseDir, projectID, "context")
}

func (cs *ContextStore) Write(projectID, key, contentType, content, sourceTask string, tags []string) error {
	dir := cs.contextDir(projectID)
	os.MkdirAll(dir, 0755)

	filename := sanitizeFilename(key) + ".md"

	// Build frontmatter
	tagsStr := "[]"
	if len(tags) > 0 {
		tagsStr = "[" + strings.Join(tags, ", ") + "]"
	}
	now := time.Now()
	frontmatter := fmt.Sprintf("---\nkey: %s\ntype: %s\nsource_task: %s\ntags: %s\ncreated_at: %s\n---\n",
		key, contentType, sourceTask, tagsStr, now.Format(time.RFC3339))

	fullContent := frontmatter + "\n" + content
	if err := os.WriteFile(filepath.Join(dir, filename), []byte(fullContent), 0644); err != nil {
		return err
	}

	// Update index
	entry := ContextEntry{Key: key, File: filename, Type: contentType, SourceTask: sourceTask, Tags: tags, CreatedAt: now}
	return cs.updateIndex(projectID, entry, false)
}

func (cs *ContextStore) Read(projectID, key string) (string, error) {
	entries, _ := cs.loadIndex(projectID)
	for _, e := range entries {
		if e.Key == key {
			data, err := os.ReadFile(filepath.Join(cs.contextDir(projectID), e.File))
			return string(data), err
		}
	}
	return "", fmt.Errorf("context entry %q not found", key)
}

func (cs *ContextStore) ReadBody(projectID, key string) (string, error) {
	full, err := cs.Read(projectID, key)
	if err != nil {
		return "", err
	}
	// Strip frontmatter (between first --- and second ---)
	parts := strings.SplitN(full, "---\n", 3)
	if len(parts) == 3 {
		return strings.TrimLeft(parts[2], "\n"), nil
	}
	return full, nil
}

func (cs *ContextStore) List(projectID string) ([]ContextEntry, error) {
	return cs.loadIndex(projectID)
}

func (cs *ContextStore) Search(projectID, contentType string, tags []string) ([]ContextEntry, error) {
	entries, err := cs.loadIndex(projectID)
	if err != nil {
		return nil, err
	}

	var results []ContextEntry
	for _, e := range entries {
		if contentType != "" && e.Type != contentType {
			continue
		}
		if len(tags) > 0 {
			matched := false
			for _, searchTag := range tags {
				for _, entryTag := range e.Tags {
					if entryTag == searchTag {
						matched = true
						break
					}
				}
				if matched {
					break
				}
			}
			if !matched {
				continue
			}
		}
		results = append(results, e)
	}
	return results, nil
}

func (cs *ContextStore) Delete(projectID, key string) error {
	entries, _ := cs.loadIndex(projectID)
	for _, e := range entries {
		if e.Key == key {
			os.Remove(filepath.Join(cs.contextDir(projectID), e.File))
			cs.updateIndex(projectID, ContextEntry{Key: key}, true)
			return nil
		}
	}
	return fmt.Errorf("context entry %q not found", key)
}

func (cs *ContextStore) loadIndex(projectID string) ([]ContextEntry, error) {
	data, err := os.ReadFile(filepath.Join(cs.contextDir(projectID), "_index.json"))
	if err != nil {
		return []ContextEntry{}, nil
	}
	var entries []ContextEntry
	json.Unmarshal(data, &entries)
	return entries, nil
}

func (cs *ContextStore) updateIndex(projectID string, entry ContextEntry, remove bool) error {
	indexPath := filepath.Join(cs.contextDir(projectID), "_index.json")
	entries, _ := cs.loadIndex(projectID)

	if remove {
		var filtered []ContextEntry
		for _, e := range entries {
			if e.Key != entry.Key {
				filtered = append(filtered, e)
			}
		}
		entries = filtered
	} else {
		found := false
		for i, e := range entries {
			if e.Key == entry.Key {
				entries[i] = entry
				found = true
				break
			}
		}
		if !found {
			entries = append(entries, entry)
		}
	}

	if entries == nil {
		entries = []ContextEntry{}
	}
	data, _ := json.MarshalIndent(entries, "", "  ")
	return os.WriteFile(indexPath, data, 0644)
}
