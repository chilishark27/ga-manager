package hive2

import (
	"strings"
	"testing"
)

func TestTemplateListAndLoad(t *testing.T) {
	dir := t.TempDir()
	lib := NewTemplateLibrary(dir)
	lib.InstallBuiltinTemplates()

	list, err := lib.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 6 {
		t.Errorf("got %d templates, want 6", len(list))
	}

	tmpl, err := lib.Load("调研报告")
	if err != nil {
		t.Fatal(err)
	}
	if tmpl.Name != "调研报告" {
		t.Errorf("name = %q", tmpl.Name)
	}
}

func TestTemplateInstantiateSimple(t *testing.T) {
	dir := t.TempDir()
	lib := NewTemplateLibrary(dir)
	lib.InstallBuiltinTemplates()

	tmpl, _ := lib.Load("代码重构")
	tasks, err := lib.Instantiate(tmpl, map[string]string{"target": "支付模块"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 4 {
		t.Errorf("got %d tasks, want 4", len(tasks))
	}
	if tasks[0].Title != "分析支付模块现有实现" {
		t.Errorf("title = %q", tasks[0].Title)
	}
}

func TestTemplateInstantiateForEach(t *testing.T) {
	dir := t.TempDir()
	lib := NewTemplateLibrary(dir)
	lib.InstallBuiltinTemplates()

	tmpl, _ := lib.Load("调研报告")
	tasks, err := lib.Instantiate(tmpl, map[string]string{
		"topic":      "支付",
		"directions": "Stripe, 支付宝, 微信支付",
	})
	if err != nil {
		t.Fatal(err)
	}
	// 3 research + 1 summarize + 1 output = 5
	if len(tasks) != 5 {
		t.Errorf("got %d tasks, want 5", len(tasks))
	}
}

func TestTemplateWildcardDeps(t *testing.T) {
	dir := t.TempDir()
	lib := NewTemplateLibrary(dir)
	lib.InstallBuiltinTemplates()

	tmpl, _ := lib.Load("调研报告")
	tasks, _ := lib.Instantiate(tmpl, map[string]string{
		"topic":      "测试",
		"directions": "A, B",
	})
	// summarize task should depend on all research tasks
	var summarize *Task
	for _, task := range tasks {
		if strings.Contains(task.Title, "汇总") {
			summarize = task
			break
		}
	}
	if summarize == nil {
		t.Fatal("no summarize task found")
	}
	if len(summarize.DependsOn) != 2 {
		t.Errorf("summarize depends on %d tasks, want 2", len(summarize.DependsOn))
	}
}
