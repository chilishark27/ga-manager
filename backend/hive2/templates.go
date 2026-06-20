package hive2

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// TemplateVariable defines a variable the user fills in when using a template
type TemplateVariable struct {
	Name     string `yaml:"name" json:"name"`
	Label    string `yaml:"label" json:"label"`
	Required bool   `yaml:"required" json:"required"`
	Default  string `yaml:"default,omitempty" json:"default,omitempty"`
}

// TemplateTask defines a task in the template
type TemplateTask struct {
	ID        string   `yaml:"id" json:"id"`
	Type      string   `yaml:"type" json:"type"`
	Title     string   `yaml:"title" json:"title"`
	Executor  string   `yaml:"executor" json:"executor"`
	DependsOn []string `yaml:"depends_on,omitempty" json:"depends_on,omitempty"`
	ForEach   string   `yaml:"for_each,omitempty" json:"for_each,omitempty"` // variable name to expand over
	BudgetMin int      `yaml:"budget_minutes,omitempty" json:"budget_minutes,omitempty"`
}

// Template represents a full workflow template
type Template struct {
	Name        string             `yaml:"name" json:"name"`
	Description string             `yaml:"description" json:"description"`
	Variables   []TemplateVariable `yaml:"variables" json:"variables"`
	Tasks       []TemplateTask     `yaml:"tasks" json:"tasks"`
}

// TemplateLibrary manages templates from a directory
type TemplateLibrary struct {
	dir string
}

func NewTemplateLibrary(dir string) *TemplateLibrary {
	os.MkdirAll(dir, 0755)
	return &TemplateLibrary{dir: dir}
}

// List returns all available templates
func (tl *TemplateLibrary) List() ([]Template, error) {
	entries, err := os.ReadDir(tl.dir)
	if err != nil {
		return nil, err
	}
	var templates []Template
	for _, e := range entries {
		if e.IsDir() || (!strings.HasSuffix(e.Name(), ".yaml") && !strings.HasSuffix(e.Name(), ".yml")) {
			continue
		}
		name := strings.TrimSuffix(strings.TrimSuffix(e.Name(), ".yaml"), ".yml")
		t, err := tl.Load(name)
		if err == nil {
			templates = append(templates, t)
		}
	}
	return templates, nil
}

// Load reads and parses a template by name
func (tl *TemplateLibrary) Load(name string) (Template, error) {
	for _, ext := range []string{".yaml", ".yml"} {
		path := filepath.Join(tl.dir, name+ext)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var t Template
		if err := yaml.Unmarshal(data, &t); err != nil {
			return Template{}, err
		}
		return t, nil
	}
	return Template{}, fmt.Errorf("template %q not found", name)
}

// Save writes a template to disk
func (tl *TemplateLibrary) Save(t Template) error {
	data, err := yaml.Marshal(t)
	if err != nil {
		return err
	}
	filename := sanitizeFilename(t.Name) + ".yaml"
	return os.WriteFile(filepath.Join(tl.dir, filename), data, 0644)
}

// Instantiate creates Task objects from a template with given variable values.
// - Substitutes {variable_name} in id, title fields
// - Expands for_each: splits the variable value by comma, creates one task per item
// - Resolves wildcard depends_on: "*_research_*" matches all expanded task IDs containing "research"
func (tl *TemplateLibrary) Instantiate(t Template, vars map[string]string) ([]*Task, error) {
	var tasks []*Task
	counter := 1

	for _, tt := range t.Tasks {
		if tt.ForEach != "" {
			// Expand for_each
			items := splitAndTrim(vars[tt.ForEach])
			for _, item := range items {
				task := tl.buildTask(tt, vars, item, counter)
				tasks = append(tasks, task)
				counter++
			}
		} else {
			task := tl.buildTask(tt, vars, "", counter)
			tasks = append(tasks, task)
			counter++
		}
	}

	// Resolve wildcard dependencies
	for _, task := range tasks {
		task.DependsOn = tl.resolveWildcardDeps(task.ID, task.DependsOn, tasks)
	}

	return tasks, nil
}

func (tl *TemplateLibrary) buildTask(tt TemplateTask, vars map[string]string, forEachItem string, counter int) *Task {
	id := fmt.Sprintf("%02d", counter)
	title := tt.Title

	// Substitute variables
	for k, v := range vars {
		title = strings.ReplaceAll(title, "{"+k+"}", v)
	}
	if forEachItem != "" {
		title = strings.ReplaceAll(title, "{item}", forEachItem)
	}

	executor := ExecutorType(tt.Executor)

	return &Task{
		ID:            id,
		Type:          TaskType(tt.Type),
		Title:         title,
		Executor:      executor,
		DependsOn:     tt.DependsOn,
		BudgetMinutes: tt.BudgetMin,
	}
}

func (tl *TemplateLibrary) resolveWildcardDeps(selfID string, deps []string, allTasks []*Task) []string {
	var resolved []string
	for _, dep := range deps {
		if strings.Contains(dep, "*") {
			// Wildcard: match against task titles (simplified pattern matching)
			pattern := strings.ReplaceAll(dep, "*", "")
			for _, t := range allTasks {
				if t.ID == selfID {
					continue // skip self
				}
				if strings.Contains(strings.ToLower(t.Title), strings.ToLower(pattern)) {
					resolved = append(resolved, t.ID)
				}
			}
		} else {
			resolved = append(resolved, dep)
		}
	}
	return resolved
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// InstallBuiltinTemplates writes built-in templates to the library directory
func (tl *TemplateLibrary) InstallBuiltinTemplates() {
	templates := []Template{
		{Name: "调研报告", Description: "多方向并行调研 + 汇总成报告",
			Variables: []TemplateVariable{
				{Name: "topic", Label: "调研主题", Required: true},
				{Name: "directions", Label: "调研方向（逗号分隔）", Required: true},
			},
			Tasks: []TemplateTask{
				{ID: "research_{item}", Type: "research", Title: "调研: {item}", Executor: "ga", ForEach: "directions"},
				{ID: "summarize", Type: "design", Title: "汇总{topic}调研结论", Executor: "ga", DependsOn: []string{"*调研*"}},
				{ID: "output", Type: "implement", Title: "生成最终报告", Executor: "claude_code", DependsOn: []string{"summarize"}},
			},
		},
		{Name: "代码重构", Description: "理解现有代码 → 重构实现",
			Variables: []TemplateVariable{{Name: "target", Label: "重构目标", Required: true}},
			Tasks: []TemplateTask{
				{ID: "analyze", Type: "research", Title: "分析{target}现有实现", Executor: "ga"},
				{ID: "design", Type: "design", Title: "设计重构方案", Executor: "ga", DependsOn: []string{"analyze"}},
				{ID: "implement", Type: "implement", Title: "执行重构", Executor: "claude_code", DependsOn: []string{"design"}},
				{ID: "verify", Type: "verify", Title: "验证重构结果", Executor: "claude_code", DependsOn: []string{"implement"}},
			},
		},
		{Name: "功能开发", Description: "完整功能开发流程",
			Variables: []TemplateVariable{{Name: "feature", Label: "功能描述", Required: true}},
			Tasks: []TemplateTask{
				{ID: "research", Type: "research", Title: "调研{feature}相关方案", Executor: "ga"},
				{ID: "design", Type: "design", Title: "设计{feature}实现方案", Executor: "ga", DependsOn: []string{"research"}},
				{ID: "implement", Type: "implement", Title: "实现{feature}", Executor: "claude_code", DependsOn: []string{"design"}},
				{ID: "test", Type: "verify", Title: "测试{feature}", Executor: "claude_code", DependsOn: []string{"implement"}},
			},
		},
		{Name: "Bug修复", Description: "定位问题 → 修复 → 验证",
			Variables: []TemplateVariable{{Name: "bug", Label: "Bug描述", Required: true}},
			Tasks: []TemplateTask{
				{ID: "reproduce", Type: "research", Title: "复现{bug}", Executor: "ga"},
				{ID: "diagnose", Type: "design", Title: "诊断根因", Executor: "ga", DependsOn: []string{"reproduce"}},
				{ID: "fix", Type: "implement", Title: "修复{bug}", Executor: "claude_code", DependsOn: []string{"diagnose"}},
				{ID: "regression", Type: "verify", Title: "回归测试", Executor: "claude_code", DependsOn: []string{"fix"}},
			},
		},
		{Name: "项目吸收", Description: "Morphling 项目能力吸收",
			Variables: []TemplateVariable{
				{Name: "project", Label: "目标项目", Required: true},
				{Name: "components", Label: "组件列表（逗号分隔）", Required: true},
			},
			Tasks: []TemplateTask{
				{ID: "decompose", Type: "research", Title: "拆解{project}组件", Executor: "ga"},
				{ID: "evaluate_{item}", Type: "design", Title: "评估{item}: 调用/重写/放弃", Executor: "ga", ForEach: "components", DependsOn: []string{"decompose"}},
				{ID: "implement_{item}", Type: "implement", Title: "实现{item}", Executor: "claude_code", ForEach: "components", DependsOn: []string{"*评估*"}},
				{ID: "integrate", Type: "verify", Title: "集成验证", Executor: "claude_code", DependsOn: []string{"*实现*"}},
			},
		},
		{Name: "SOP执行", Description: "按步骤执行流程",
			Variables: []TemplateVariable{
				{Name: "sop_name", Label: "SOP名称", Required: true},
				{Name: "steps", Label: "执行步骤（逗号分隔）", Required: true},
			},
			Tasks: []TemplateTask{
				{ID: "parse", Type: "research", Title: "解析{sop_name}流程", Executor: "ga"},
				{ID: "step_{item}", Type: "implement", Title: "执行: {item}", Executor: "claude_code", ForEach: "steps", DependsOn: []string{"parse"}},
				{ID: "verify", Type: "verify", Title: "验证执行结果", Executor: "claude_code", DependsOn: []string{"*执行*"}},
			},
		},
	}
	for _, t := range templates {
		tl.Save(t)
	}
}
