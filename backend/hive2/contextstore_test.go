package hive2

import (
	"strings"
	"testing"
)

func TestContextWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("测试", "目标", 30, cfg)
	cs := NewContextStore(store)

	err := cs.Write(p.ID, "支付SDK对比", "finding", "Stripe最优", "task_001", []string{"payment"})
	if err != nil {
		t.Fatal(err)
	}

	full, err := cs.Read(p.ID, "支付SDK对比")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(full, "---") {
		t.Error("missing frontmatter")
	}
	if !strings.Contains(full, "Stripe最优") {
		t.Error("missing body")
	}

	body, err := cs.ReadBody(p.ID, "支付SDK对比")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, "---") {
		t.Error("body should not contain frontmatter")
	}
	if !strings.Contains(body, "Stripe最优") {
		t.Error("missing body content")
	}
}

func TestContextList(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	cs := NewContextStore(store)

	cs.Write(p.ID, "entry1", "finding", "c1", "t1", []string{"a"})
	cs.Write(p.ID, "entry2", "decision", "c2", "t2", []string{"b"})
	cs.Write(p.ID, "entry3", "summary", "c3", "t3", []string{"c"})

	list, _ := cs.List(p.ID)
	if len(list) != 3 {
		t.Errorf("got %d entries, want 3", len(list))
	}
}

func TestContextSearch(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	cs := NewContextStore(store)

	cs.Write(p.ID, "e1", "finding", "c1", "t1", []string{"payment", "api"})
	cs.Write(p.ID, "e2", "decision", "c2", "t2", []string{"design", "api"})

	results, _ := cs.Search(p.ID, "", []string{"api"})
	if len(results) != 2 {
		t.Errorf("search api: got %d, want 2", len(results))
	}

	results, _ = cs.Search(p.ID, "", []string{"payment"})
	if len(results) != 1 {
		t.Errorf("search payment: got %d, want 1", len(results))
	}

	results, _ = cs.Search(p.ID, "finding", nil)
	if len(results) != 1 {
		t.Errorf("search type finding: got %d, want 1", len(results))
	}
}

func TestContextDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cfg := ExecutorConfig{}
	p, _ := store.Create("测试", "目标", 30, cfg)
	cs := NewContextStore(store)

	cs.Write(p.ID, "deleteme", "finding", "content", "t1", nil)
	cs.Delete(p.ID, "deleteme")

	_, err := cs.Read(p.ID, "deleteme")
	if err == nil {
		t.Error("expected error reading deleted entry")
	}

	list, _ := cs.List(p.ID)
	if len(list) != 0 {
		t.Errorf("list should be empty, got %d", len(list))
	}
}
