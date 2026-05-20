package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"ga_manager/models"
)

// ConfigService handles mykey.py configuration
type ConfigService struct {
	gaRoot string
}

// NewConfigService creates a new config service
func NewConfigService(gaRoot string) *ConfigService {
	return &ConfigService{gaRoot: gaRoot}
}

// UpdateRoot updates the GA root path
func (s *ConfigService) UpdateRoot(newRoot string) {
	s.gaRoot = newRoot
}

// GetMyKeyRaw returns the raw source of mykey.py
func (s *ConfigService) GetMyKeyRaw() (string, error) {
	path := filepath.Join(s.gaRoot, "mykey.py")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read mykey.py: %w", err)
	}
	return string(data), nil
}

// SaveMyKeyRaw saves raw source to mykey.py
func (s *ConfigService) SaveMyKeyRaw(source string) error {
	path := filepath.Join(s.gaRoot, "mykey.py")
	return os.WriteFile(path, []byte(source), 0644)
}

// GetMyKeyMasked returns mykey.py content with API keys masked
func (s *ConfigService) GetMyKeyMasked() (string, error) {
	raw, err := s.GetMyKeyRaw()
	if err != nil {
		return "", err
	}
	return maskAPIKeys(raw), nil
}

// GetTemplates returns available mykey templates
func (s *ConfigService) GetTemplates() ([]models.MyKeyProvider, error) {
	// Read mykey_template.py to extract provider info
	path := filepath.Join(s.gaRoot, "mykey_template.py")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read template: %w", err)
	}

	providers := parseTemplateProviders(string(data))
	return providers, nil
}

// HasMyKey checks if mykey.py exists
func (s *ConfigService) HasMyKey() bool {
	path := filepath.Join(s.gaRoot, "mykey.py")
	_, err := os.Stat(path)
	return err == nil
}

// GetLLMList calls list_llms.py to extract real LLM configurations from mykey.py
func (s *ConfigService) GetLLMList() ([]models.LLMConfig, error) {
	bridgeDir := getBridgeDir()
	scriptPath := filepath.Join(bridgeDir, "list_llms.py")
	if _, err := os.Stat(scriptPath); err != nil {
		return nil, fmt.Errorf("list_llms.py not found at %s", scriptPath)
	}

	// Detect python executable
	python := "python"
	if p, err := exec.LookPath("python3"); err == nil {
		python = p
	} else if p, err := exec.LookPath("python"); err == nil {
		python = p
	}

	cmd := exec.Command(python, scriptPath, "--ga-root", s.gaRoot)
	cmd.Dir = bridgeDir
	hideWindow(cmd)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("list_llms.py failed: %w", err)
	}

	// Parse the JSON output (skip any non-JSON lines like [Info] logs)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var jsonLine string
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "[") {
			jsonLine = line
			break
		}
	}
	if jsonLine == "" {
		return nil, fmt.Errorf("no JSON output from list_llms.py")
	}

	var configs []models.LLMConfig
	if err := json.Unmarshal([]byte(jsonLine), &configs); err != nil {
		return nil, fmt.Errorf("parse LLM list: %w", err)
	}
	return configs, nil
}

// --- Helpers ---

// maskAPIKeys replaces API key values with masked versions
func maskAPIKeys(source string) string {
	// Match patterns like key = "sk-xxxx..." or api_key = "xxxx"
	re := regexp.MustCompile(`(["'])(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9-]+(["'])`)
	masked := re.ReplaceAllString(source, "${1}${2}****${3}")

	// Generic long strings that look like keys (32+ chars of alphanumeric)
	re2 := regexp.MustCompile(`(["'])([a-zA-Z0-9]{4})[a-zA-Z0-9-]{28,}(["'])`)
	masked = re2.ReplaceAllString(masked, "${1}${2}****${3}")

	return masked
}

// parseTemplateProviders extracts provider metadata from template file
func parseTemplateProviders(source string) []models.MyKeyProvider {
	var providers []models.MyKeyProvider

	// Look for comment blocks that describe providers
	lines := strings.Split(source, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") && strings.Contains(line, ":") {
			// Simple heuristic: "# OpenAI: ..." style comments
			parts := strings.SplitN(strings.TrimPrefix(line, "# "), ":", 2)
			if len(parts) == 2 {
				providers = append(providers, models.MyKeyProvider{
					Name: strings.TrimSpace(parts[0]),
					Type: strings.ToLower(strings.TrimSpace(parts[0])),
				})
			}
		}
	}

	return providers
}
