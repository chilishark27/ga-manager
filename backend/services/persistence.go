package services

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// persistedInstance holds the minimal config needed to restore an instance after restart.
// Chat history is NOT stored here — it's recovered from GA's model_responses/ via --recover.
type persistedInstance struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	LLMNo         int    `json:"llm_no"`
	Autonomous    bool   `json:"autonomous"`
	Goal          string `json:"goal"`
	Reflect       bool   `json:"reflect"`
	GARoot        string `json:"ga_root"`
	ProjectDir    string `json:"project_dir,omitempty"`
	ReflectScript string `json:"reflect_script,omitempty"`
}

type persistenceStore struct {
	mu       sync.Mutex
	filePath string
}

// newPersistenceStore creates a store that saves to ~/.ga-manager/instances.json
func newPersistenceStore() *persistenceStore {
	dir := persistenceDir()
	os.MkdirAll(dir, 0755)
	return &persistenceStore{
		filePath: filepath.Join(dir, "instances.json"),
	}
}

func persistenceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".ga-manager")
}

// Save writes the current instance list to disk.
func (ps *persistenceStore) Save(instances []*managedInstance) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	var records []persistedInstance
	for _, inst := range instances {
		inst.mu.RLock()
		records = append(records, persistedInstance{
			ID:            inst.id,
			Name:          inst.name,
			LLMNo:         inst.llmNo,
			Autonomous:    inst.autonomous,
			Goal:          inst.goal,
			Reflect:       inst.reflect,
			GARoot:        inst.gaRoot,
			ProjectDir:    inst.projectDir,
			ReflectScript: inst.reflectScript,
		})
		inst.mu.RUnlock()
	}

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		log.Printf("[Persistence] marshal error: %v", err)
		return
	}

	if err := os.WriteFile(ps.filePath, data, 0644); err != nil {
		log.Printf("[Persistence] write error: %v", err)
	}
}

// Load reads persisted instances from disk.
func (ps *persistenceStore) Load() []persistedInstance {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	data, err := os.ReadFile(ps.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[Persistence] read error: %v", err)
		}
		return nil
	}

	var records []persistedInstance
	if err := json.Unmarshal(data, &records); err != nil {
		log.Printf("[Persistence] unmarshal error: %v", err)
		return nil
	}
	return records
}

// Remove deletes the persistence file (used on clean shutdown with no instances).
func (ps *persistenceStore) Clear() {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	os.Remove(ps.filePath)
}
