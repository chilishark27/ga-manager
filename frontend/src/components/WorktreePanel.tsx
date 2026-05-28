import { useState, useEffect } from 'react';
import { useStore } from '../store';

interface Worktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

function WorktreePanel({ onClose }: { onClose: () => void }) {
  const { projectPath } = useStore();
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState('');
  const [isNew, setIsNew] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ branch: string; clean: boolean } | null>(null);

  const fetchData = async () => {
    if (!projectPath) return;
    const p = encodeURIComponent(projectPath);
    try {
      const [wRes, bRes, sRes] = await Promise.all([
        fetch(`/api/git/worktrees?path=${p}`),
        fetch(`/api/git/branches?path=${p}`),
        fetch(`/api/git/status?path=${p}`),
      ]);
      if (wRes.ok) setWorktrees(await wRes.json());
      if (bRes.ok) setBranches(await bRes.json());
      if (sRes.ok) setStatus(await sRes.json());
    } catch {}
  };

  useEffect(() => { fetchData(); }, [projectPath]);

  const createWorktree = async () => {
    if (!newBranch.trim() || !projectPath) return;
    setLoading(true);
    try {
      const res = await fetch('/api/git/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, branch: newBranch.trim(), new_branch: isNew }),
      });
      if (res.ok) {
        setNewBranch('');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed');
      }
    } catch {}
    setLoading(false);
  };

  const removeWorktree = async (wtPath: string) => {
    if (!confirm('Remove this worktree?')) return;
    try {
      await fetch('/api/git/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, worktree: wtPath }),
      });
      fetchData();
    } catch {}
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box worktree-modal" onClick={e => e.stopPropagation()}>
        <h3>Git Worktrees</h3>
        {status && (
          <div className="wt-status">
            Branch: <strong>{status.branch}</strong> {status.clean ? '✓ clean' : '● changes'}
          </div>
        )}

        <div className="wt-list">
          {worktrees.map(wt => (
            <div key={wt.path} className="wt-item">
              <div className="wt-item-info">
                <span className="wt-branch">{wt.branch || '(detached)'}</span>
                <span className="wt-path">{wt.path}</span>
              </div>
              {!wt.bare && worktrees.length > 1 && (
                <button className="wt-remove" onClick={() => removeWorktree(wt.path)}>×</button>
              )}
            </div>
          ))}
        </div>

        <div className="wt-create">
          <div className="wt-create-row">
            <select className="wt-select" value={isNew ? '__new__' : newBranch} onChange={e => {
              if (e.target.value === '__new__') { setIsNew(true); setNewBranch(''); }
              else { setIsNew(false); setNewBranch(e.target.value); }
            }}>
              <option value="__new__">New branch...</option>
              {branches.filter(b => !b.startsWith('origin/')).map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            {isNew && (
              <input className="wt-input" placeholder="Branch name" value={newBranch}
                onChange={e => setNewBranch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createWorktree(); }} />
            )}
            <button className="btn-primary btn-sm" onClick={createWorktree} disabled={loading || !newBranch.trim()}>
              {loading ? '...' : 'Create'}
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default WorktreePanel;
