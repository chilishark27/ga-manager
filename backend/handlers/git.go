package handlers

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
)

type GitHandler struct{}

func NewGitHandler() *GitHandler {
	return &GitHandler{}
}

// ListWorktrees returns all git worktrees for a project
// GET /api/git/worktrees?path=<project>
func (h *GitHandler) ListWorktrees(w http.ResponseWriter, r *http.Request) {
	projectPath := r.URL.Query().Get("path")
	if projectPath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = projectPath
	out, err := cmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "git worktree list failed: "+err.Error())
		return
	}

	type Worktree struct {
		Path   string `json:"path"`
		Branch string `json:"branch"`
		Head   string `json:"head"`
		Bare   bool   `json:"bare"`
	}

	var worktrees []Worktree
	var current Worktree
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = Worktree{}
			continue
		}
		if strings.HasPrefix(line, "worktree ") {
			current.Path = strings.TrimPrefix(line, "worktree ")
		} else if strings.HasPrefix(line, "HEAD ") {
			current.Head = strings.TrimPrefix(line, "HEAD ")
		} else if strings.HasPrefix(line, "branch ") {
			branch := strings.TrimPrefix(line, "branch ")
			branch = strings.TrimPrefix(branch, "refs/heads/")
			current.Branch = branch
		} else if line == "bare" {
			current.Bare = true
		}
	}
	if current.Path != "" {
		worktrees = append(worktrees, current)
	}

	writeJSON(w, http.StatusOK, worktrees)
}

// CreateWorktree creates a new git worktree
// POST /api/git/worktrees  body: {"path": "<project>", "branch": "<branch>", "new_branch": true}
func (h *GitHandler) CreateWorktree(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path      string `json:"path"`
		Branch    string `json:"branch"`
		NewBranch bool   `json:"new_branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Path == "" || body.Branch == "" {
		writeError(w, http.StatusBadRequest, "path and branch required")
		return
	}

	worktreePath := filepath.Join(body.Path, ".worktrees", body.Branch)
	var cmd *exec.Cmd
	if body.NewBranch {
		cmd = exec.Command("git", "worktree", "add", "-b", body.Branch, worktreePath)
	} else {
		cmd = exec.Command("git", "worktree", "add", worktreePath, body.Branch)
	}
	cmd.Dir = body.Path
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusInternalServerError, string(out))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "created", "path": worktreePath, "branch": body.Branch})
}

// RemoveWorktree removes a git worktree
// DELETE /api/git/worktrees  body: {"path": "<project>", "worktree": "<worktree_path>"}
func (h *GitHandler) RemoveWorktree(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path     string `json:"path"`
		Worktree string `json:"worktree"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Path == "" || body.Worktree == "" {
		writeError(w, http.StatusBadRequest, "path and worktree required")
		return
	}

	cmd := exec.Command("git", "worktree", "remove", body.Worktree, "--force")
	cmd.Dir = body.Path
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusInternalServerError, string(out))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

// ListBranches returns all branches
// GET /api/git/branches?path=<project>
func (h *GitHandler) ListBranches(w http.ResponseWriter, r *http.Request) {
	projectPath := r.URL.Query().Get("path")
	if projectPath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	cmd := exec.Command("git", "branch", "-a", "--format=%(refname:short)")
	cmd.Dir = projectPath
	out, err := cmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "git branch failed: "+err.Error())
		return
	}

	var branches []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			branches = append(branches, line)
		}
	}

	writeJSON(w, http.StatusOK, branches)
}

// Status returns current branch and git status
// GET /api/git/status?path=<project>
func (h *GitHandler) Status(w http.ResponseWriter, r *http.Request) {
	projectPath := r.URL.Query().Get("path")
	if projectPath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	branchCmd := exec.Command("git", "branch", "--show-current")
	branchCmd.Dir = projectPath
	branchOut, _ := branchCmd.Output()

	statusCmd := exec.Command("git", "status", "--porcelain")
	statusCmd.Dir = projectPath
	statusOut, _ := statusCmd.Output()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"branch":  strings.TrimSpace(string(branchOut)),
		"clean":   len(strings.TrimSpace(string(statusOut))) == 0,
		"changes": len(strings.Split(strings.TrimSpace(string(statusOut)), "\n")),
	})
}
