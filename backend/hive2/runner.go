package hive2

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// Runner manages GA worker processes for Hive v2 projects.
type Runner struct {
	mu       sync.Mutex
	gaRoot   string
	python   string
	apiPort  int
	projects map[string]*ProjectRunner // projectID -> runner
}

// ProjectRunner holds process state for a single running project.
type ProjectRunner struct {
	ProjectID string
	Workers   []*exec.Cmd
	StopCh    chan struct{}
	Logs      []string
}

// NewRunner creates a Runner, resolving the python executable if needed.
func NewRunner(gaRoot, python string, apiPort int) *Runner {
	if python == "" {
		if p, err := exec.LookPath("python3"); err == nil {
			python = p
		} else if p, err := exec.LookPath("python"); err == nil {
			python = p
		} else {
			python = "python"
		}
	} else {
		// If python path is a directory, find the exe inside
		if info, err := os.Stat(python); err == nil && info.IsDir() {
			for _, name := range []string{"python.exe", "python3", "python"} {
				candidate := filepath.Join(python, name)
				if _, err := os.Stat(candidate); err == nil {
					python = candidate
					break
				}
			}
		}
	}
	return &Runner{
		gaRoot:   gaRoot,
		python:   python,
		apiPort:  apiPort,
		projects: make(map[string]*ProjectRunner),
	}
}

// Start launches workers for a project.
func (r *Runner) Start(projectID string, numWorkers int, llmNo int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.projects[projectID]; exists {
		return fmt.Errorf("project %s already running", projectID)
	}

	reflectScript := filepath.Join(r.gaRoot, "reflect", "hive_v2_worker.py")
	if _, err := os.Stat(reflectScript); err != nil {
		return fmt.Errorf("hive_v2_worker.py not found at %s", reflectScript)
	}

	pr := &ProjectRunner{
		ProjectID: projectID,
		StopCh:    make(chan struct{}),
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", r.apiPort)
	workerNames := []string{"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}

	// Create log directory
	logDir := filepath.Join(r.gaRoot, "hive_projects", projectID, "logs")
	os.MkdirAll(logDir, 0755)

	for i := 0; i < numWorkers && i < 5; i++ {
		name := fmt.Sprintf("Worker-%s", workerNames[i])

		cmd := exec.Command(r.python, "-u",
			filepath.Join(r.gaRoot, "agentmain.py"),
			"--reflect", reflectScript,
			"--llm_no", strconv.Itoa(llmNo),
		)
		cmd.Dir = r.gaRoot
		cmd.Env = append(os.Environ(),
			"PYTHONUNBUFFERED=1",
			"PYTHONIOENCODING=utf-8",
			"HIVE_URL="+baseURL,
			"HIVE_PROJECT="+projectID,
		)

		// Log file for this worker
		logFile, _ := os.Create(filepath.Join(logDir, fmt.Sprintf("worker_%s.log", workerNames[i])))

		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		if err := cmd.Start(); err != nil {
			log.Printf("[Hive2] %s failed to start: %v", name, err)
			pr.addLog(fmt.Sprintf("❌ %s failed: %v", name, err))
			if logFile != nil {
				logFile.Close()
			}
			continue
		}

		pr.Workers = append(pr.Workers, cmd)
		pr.addLog(fmt.Sprintf("✅ %s started (PID %d)", name, cmd.Process.Pid))
		log.Printf("[Hive2] %s started for project %s (PID %d)", name, projectID, cmd.Process.Pid)

		// Stream stdout to log file and in-memory log
		wname := name
		go func(rdr io.Reader, lf *os.File) {
			scanner := bufio.NewScanner(rdr)
			for scanner.Scan() {
				line := scanner.Text()
				if lf != nil {
					fmt.Fprintf(lf, "[%s] %s\n", time.Now().Format("15:04:05"), line)
				}
				r.mu.Lock()
				if p, ok := r.projects[projectID]; ok {
					p.addLog(fmt.Sprintf("[%s] %s", wname, line))
				}
				r.mu.Unlock()
			}
		}(stdout, logFile)

		// Stream stderr to log file only
		go func(rdr io.Reader, lf *os.File) {
			scanner := bufio.NewScanner(rdr)
			for scanner.Scan() {
				line := scanner.Text()
				if lf != nil {
					fmt.Fprintf(lf, "[%s][ERR] %s\n", time.Now().Format("15:04:05"), line)
				}
			}
		}(stderr, logFile)

		// Monitor process exit
		go func(c *exec.Cmd, wn string, lf *os.File) {
			c.Wait()
			if lf != nil {
				lf.Close()
			}
			r.mu.Lock()
			if p, ok := r.projects[projectID]; ok {
				p.addLog(fmt.Sprintf("⏹ %s exited", wn))
			}
			r.mu.Unlock()
			log.Printf("[Hive2] %s exited for project %s", wn, projectID)
		}(cmd, wname, logFile)
	}

	r.projects[projectID] = pr
	return nil
}

// Stop kills all workers for a project.
func (r *Runner) Stop(projectID string) {
	r.mu.Lock()
	pr, exists := r.projects[projectID]
	if !exists {
		r.mu.Unlock()
		return
	}
	delete(r.projects, projectID)
	r.mu.Unlock()

	close(pr.StopCh)
	for _, cmd := range pr.Workers {
		if cmd != nil && cmd.Process != nil {
			runnerKillProcessTree(cmd.Process.Pid)
		}
	}
	log.Printf("[Hive2] Stopped all workers for project %s", projectID)
}

// IsRunning checks if a project has active workers.
func (r *Runner) IsRunning(projectID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, exists := r.projects[projectID]
	return exists
}

// GetLogs returns recent in-memory logs for a project runner.
func (r *Runner) GetLogs(projectID string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if pr, ok := r.projects[projectID]; ok {
		// Return a copy so caller can't mutate internal state
		out := make([]string, len(pr.Logs))
		copy(out, pr.Logs)
		return out
	}
	return nil
}

// RunningCount returns total active worker processes across all projects.
func (r *Runner) RunningCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, pr := range r.projects {
		count += len(pr.Workers)
	}
	return count
}

func (pr *ProjectRunner) addLog(msg string) {
	pr.Logs = append(pr.Logs, fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), msg))
	if len(pr.Logs) > 200 {
		pr.Logs = pr.Logs[len(pr.Logs)-200:]
	}
}

// runnerKillProcessTree kills a process and its children (Windows-aware).
func runnerKillProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	if exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", pid)).Run() == nil {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		p.Kill()
	}
}
