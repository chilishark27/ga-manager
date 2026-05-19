package services

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ga_manager/models"
)

// persistedCosts holds token/cost data for a single instance.
type persistedCosts struct {
	InputTokens  int64              `json:"input_tokens"`
	OutputTokens int64              `json:"output_tokens"`
	CacheCreated int64              `json:"cache_created"`
	CacheRead    int64              `json:"cache_read"`
	TotalTurns   int                `json:"total_turns"`
	History      []models.TokenRecord `json:"history,omitempty"`
	UpdatedAt    time.Time          `json:"updated_at"`
}

// costPersistence manages saving/loading cost data to disk.
type costPersistence struct {
	mu       sync.Mutex
	filePath string
}

func newCostPersistence() *costPersistence {
	dir := persistenceDir()
	os.MkdirAll(dir, 0755)
	return &costPersistence{
		filePath: filepath.Join(dir, "costs.json"),
	}
}

// Save writes all instance cost data to disk.
func (cp *costPersistence) Save(instances []*managedInstance) {
	cp.mu.Lock()
	defer cp.mu.Unlock()

	data := make(map[string]*persistedCosts)
	for _, inst := range instances {
		inst.mu.RLock()
		ts := inst.tokenStats
		turns := inst.totalTurns
		inst.mu.RUnlock()

		if ts == nil {
			continue
		}

		ts.mu.RLock()
		if ts.InputTokens == 0 && ts.OutputTokens == 0 {
			ts.mu.RUnlock()
			continue
		}
		pc := &persistedCosts{
			InputTokens:  ts.InputTokens,
			OutputTokens: ts.OutputTokens,
			CacheCreated: ts.CacheCreated,
			CacheRead:    ts.CacheRead,
			TotalTurns:   turns,
			UpdatedAt:    time.Now(),
		}
		// Only persist last 20 history records to keep file small
		histLen := len(ts.History)
		if histLen > 20 {
			pc.History = make([]models.TokenRecord, 20)
			copy(pc.History, ts.History[histLen-20:])
		} else {
			pc.History = make([]models.TokenRecord, histLen)
			copy(pc.History, ts.History)
		}
		ts.mu.RUnlock()

		inst.mu.RLock()
		data[inst.id] = pc
		inst.mu.RUnlock()
	}

	if len(data) == 0 {
		return
	}

	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		log.Printf("[CostPersistence] marshal error: %v", err)
		return
	}
	if err := os.WriteFile(cp.filePath, raw, 0644); err != nil {
		log.Printf("[CostPersistence] write error: %v", err)
	}
}

// Load reads persisted cost data from disk.
func (cp *costPersistence) Load() map[string]*persistedCosts {
	cp.mu.Lock()
	defer cp.mu.Unlock()

	raw, err := os.ReadFile(cp.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[CostPersistence] read error: %v", err)
		}
		return nil
	}

	var data map[string]*persistedCosts
	if err := json.Unmarshal(raw, &data); err != nil {
		log.Printf("[CostPersistence] unmarshal error: %v", err)
		return nil
	}
	return data
}
