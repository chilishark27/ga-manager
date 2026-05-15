package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"ga_manager/models"
)

type SkillTreeHandler struct {
	gaRoot string
}

func NewSkillTreeHandler(gaRoot string) *SkillTreeHandler {
	return &SkillTreeHandler{gaRoot: gaRoot}
}

func (h *SkillTreeHandler) GetSkillTree(w http.ResponseWriter, r *http.Request) {
	memDir := filepath.Join(h.gaRoot, "memory")
	nodes := make([]models.SkillNode, 0)
	edges := make([]models.SkillEdge, 0)

	// Load file access stats
	accessStats := make(map[string]struct {
		Count int    `json:"count"`
		Last  string `json:"last"`
	})
	statsPath := filepath.Join(memDir, "file_access_stats.json")
	if data, err := os.ReadFile(statsPath); err == nil {
		json.Unmarshal(data, &accessStats)
	}

	// Scan memory directory
	entries, err := os.ReadDir(memDir)
	if err != nil {
		writeJSON(w, http.StatusOK, models.SkillTree{Nodes: nodes, Edges: edges})
		return
	}

	refPattern := regexp.MustCompile(`(?i)(?:参考|reference|see|详见|read)\s*[:：]?\s*(\w+(?:_\w+)*\.(?:md|py|txt))`)
	importPattern := regexp.MustCompile(`(?:from\s+memory\.(\w+)|import\s+(\w+))`)

	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || strings.HasPrefix(name, ".") || name == "__pycache__" {
			continue
		}
		if strings.HasSuffix(name, ".bak") || strings.HasSuffix(name, ".deleted") {
			continue
		}

		info, _ := e.Info()
		nodeType := "data"
		if strings.HasSuffix(name, "_sop.md") || strings.HasSuffix(name, "_sop.txt") {
			nodeType = "sop"
		} else if strings.HasSuffix(name, ".py") {
			nodeType = "script"
		} else if name == "global_mem_insight.txt" || name == "global_mem.txt" {
			nodeType = "index"
		} else if strings.HasSuffix(name, ".md") {
			nodeType = "sop"
		}

		node := models.SkillNode{
			ID:    name,
			Label: strings.TrimSuffix(strings.TrimSuffix(name, ".md"), ".py"),
			Type:  nodeType,
		}
		if info != nil {
			node.Size = info.Size()
		}
		if stat, ok := accessStats[name]; ok {
			node.AccessCount = stat.Count
			node.LastAccess = stat.Last
		}
		nodes = append(nodes, node)

		// Parse references from file content
		fullPath := filepath.Join(memDir, name)
		if info != nil && info.Size() < 100*1024 {
			content, err := os.ReadFile(fullPath)
			if err == nil {
				text := string(content)
				// Find SOP references
				matches := refPattern.FindAllStringSubmatch(text, -1)
				for _, m := range matches {
					if m[1] != "" && m[1] != name {
						edges = append(edges, models.SkillEdge{From: name, To: m[1], Type: "reference"})
					}
				}
				// Find Python imports
				if strings.HasSuffix(name, ".py") {
					imports := importPattern.FindAllStringSubmatch(text, -1)
					for _, m := range imports {
						target := m[1]
						if target == "" {
							target = m[2]
						}
						if target != "" {
							targetFile := target + ".py"
							edges = append(edges, models.SkillEdge{From: name, To: targetFile, Type: "import"})
						}
					}
				}
			}
		}
	}

	// Parse global_mem_insight.txt for scene→SOP mappings
	insightPath := filepath.Join(memDir, "global_mem_insight.txt")
	if data, err := os.ReadFile(insightPath); err == nil {
		lines := strings.Split(string(data), "\n")
		sopRef := regexp.MustCompile(`(\w+(?:_\w+)*\.(?:md|py))`)
		for _, line := range lines {
			refs := sopRef.FindAllString(line, -1)
			if len(refs) > 0 {
				for _, ref := range refs {
					if ref != "global_mem_insight.txt" {
						edges = append(edges, models.SkillEdge{
							From: "global_mem_insight.txt",
							To:   ref,
							Type: "reference",
						})
					}
				}
			}
		}
	}

	// Deduplicate edges
	edgeSet := make(map[string]bool)
	uniqueEdges := make([]models.SkillEdge, 0, len(edges))
	for _, e := range edges {
		key := e.From + "|" + e.To + "|" + e.Type
		if !edgeSet[key] {
			edgeSet[key] = true
			uniqueEdges = append(uniqueEdges, e)
		}
	}

	writeJSON(w, http.StatusOK, models.SkillTree{Nodes: nodes, Edges: uniqueEdges})
}
