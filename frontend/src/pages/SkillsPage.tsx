import { useState, useEffect } from 'react';
import { useStore } from '../store';
import SkillTree from '../components/SkillTree';

function SkillsPage() {
  const { saveSop, createSop, deleteSop, showToast } = useStore();

  const [localSops, setLocalSops] = useState<{ name: string; type: string; size: number }[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [dirContents, setDirContents] = useState<Record<string, { name: string; type: string; size: number }[]>>({});
  const [sopViewer, setSopViewer] = useState<{ name: string; content: string; type: string } | null>(null);
  const [sopLoading, setSopLoading] = useState(false);
  const [sopEditing, setSopEditing] = useState(false);
  const [sopEditContent, setSopEditContent] = useState('');
  const [showNewSop, setShowNewSop] = useState(false);
  const [newSopName, setNewSopName] = useState('');
  const [newSopContent, setNewSopContent] = useState('');
  const [viewMode, setViewMode] = useState<'tree' | 'editor'>('tree');

  useEffect(() => {
    fetch('/api/sops/local').then(r => r.json()).then(d => {
      if (d.sops) setLocalSops(d.sops);
    }).catch(() => {});
  }, []);

  const viewSop = async (name: string) => {
    setSopLoading(true);
    try {
      const r = await fetch(`/api/sops/local/${name}`);
      const d = await r.json();
      setSopViewer({ name: d.name, content: d.content || JSON.stringify(d.files, null, 2), type: d.type });
      setViewMode('editor');
    } catch {
      setSopViewer({ name, content: 'Failed to load', type: 'error' });
    }
    setSopLoading(false);
  };

  const toggleDir = async (dirName: string) => {
    if (expandedDirs[dirName]) {
      setExpandedDirs(prev => ({ ...prev, [dirName]: false }));
      return;
    }
    try {
      const r = await fetch(`/api/sops/local/${dirName}`);
      const d = await r.json();
      if (d.files) {
        const items = (d.files as string[]).map(f => ({
          name: f,
          type: f.endsWith('/') ? 'dir' : f.split('.').pop() || 'file',
          size: 0
        }));
        setDirContents(prev => ({ ...prev, [dirName]: items }));
      }
    } catch { /* ignore */ }
    setExpandedDirs(prev => ({ ...prev, [dirName]: true }));
  };

  return (
    <div className="skills-page">
      {/* Left: SOP File Tree */}
      <div className="skills-sidebar">
        <div className="skills-sidebar-header">
          <h5>SOP Files</h5>
          <button className="action-btn" style={{ fontSize: '11px', padding: '3px 10px' }} onClick={() => setShowNewSop(true)}>+ New</button>
        </div>
        <div className="sop-list">
          {localSops.map(sop => (
            <div key={sop.name}>
              <div className="sop-item" onClick={() => sop.type === 'dir' ? toggleDir(sop.name) : viewSop(sop.name)}>
                <span className="sop-item-icon">{sop.type === 'dir' ? (expandedDirs[sop.name] ? 'v' : '>') : sop.name.endsWith('.py') ? 'py' : 'md'}</span>
                <span className="sop-item-name">{sop.name}</span>
                {sop.size > 0 && <span className="sop-item-size">{(sop.size / 1024).toFixed(1)}K</span>}
              </div>
              {sop.type === 'dir' && expandedDirs[sop.name] && dirContents[sop.name] && (
                <div style={{ paddingLeft: '16px' }}>
                  {dirContents[sop.name].map(child => (
                    <div key={child.name} className="sop-item" onClick={() => viewSop(`${sop.name}/${child.name}`)}>
                      <span className="sop-item-icon">{child.name.endsWith('.py') ? 'py' : 'md'}</span>
                      <span className="sop-item-name">{child.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {localSops.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: '12px', padding: '12px', textAlign: 'center' }}>No SOPs found</p>
          )}
        </div>
      </div>

      {/* Right: SkillTree or SOP Editor */}
      <div className="skills-content">
        <div className="skills-content-header">
          <button className={`ch-btn ${viewMode === 'tree' ? 'active' : ''}`} onClick={() => setViewMode('tree')}>Skill Tree</button>
          <button className={`ch-btn ${viewMode === 'editor' ? 'active' : ''}`} onClick={() => setViewMode('editor')}>SOP Editor</button>
        </div>
        <div className="skills-content-body">
          {viewMode === 'tree' ? (
            <SkillTree onNodeClick={(nodeId) => viewSop(nodeId)} highlightNode={null} />
          ) : (
            sopViewer ? (
              <div className="sop-editor-panel">
                <div className="sop-editor-header">
                  <span className="sop-editor-title">{sopViewer.name}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {!sopEditing && (
                      <button className="action-btn" style={{ fontSize: '11px', padding: '3px 10px' }}
                        onClick={() => { setSopEditing(true); setSopEditContent(sopViewer.content); }}>Edit</button>
                    )}
                    {sopEditing && (
                      <button className="action-btn" style={{ fontSize: '11px', padding: '3px 10px', background: 'var(--green)', color: '#fff' }}
                        onClick={async () => {
                          const ok = await saveSop(sopViewer.name, sopEditContent);
                          if (ok) { setSopViewer({ ...sopViewer, content: sopEditContent }); setSopEditing(false); }
                        }}>Save</button>
                    )}
                    <button className="action-btn" style={{ fontSize: '11px', padding: '3px 10px', background: 'var(--red)', color: '#fff' }}
                      onClick={async () => {
                        if (confirm(`Delete ${sopViewer.name}?`)) {
                          const ok = await deleteSop(sopViewer.name);
                          if (ok) { setSopViewer(null); setLocalSops(prev => prev.filter(s => s.name !== sopViewer.name)); }
                        }
                      }}>Del</button>
                  </div>
                </div>
                {sopEditing ? (
                  <textarea className="sop-editor-textarea" value={sopEditContent} onChange={e => setSopEditContent(e.target.value)} />
                ) : (
                  <pre className="sop-viewer-content">{sopLoading ? 'Loading...' : sopViewer.content}</pre>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)' }}>
                Select a SOP file to view or edit
              </div>
            )
          )}
        </div>
      </div>

      {/* New SOP Modal */}
      {showNewSop && (
        <div className="modal-overlay" onClick={() => setShowNewSop(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Create New SOP</h3>
            <input className="modal-input" placeholder="filename.md" value={newSopName} onChange={e => setNewSopName(e.target.value)} style={{ marginBottom: '12px' }} />
            <textarea className="sop-editor-textarea" placeholder="SOP content..." value={newSopContent} onChange={e => setNewSopContent(e.target.value)} style={{ height: '200px', width: '100%' }} />
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowNewSop(false)}>Cancel</button>
              <button className="modal-btn confirm" onClick={async () => {
                if (!newSopName.trim()) return;
                const ok = await createSop(newSopName, newSopContent);
                if (ok) {
                  setShowNewSop(false);
                  setLocalSops(prev => [...prev, { name: newSopName, type: newSopName.endsWith('.py') ? 'py' : 'md', size: newSopContent.length }]);
                  setNewSopName(''); setNewSopContent('');
                }
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillsPage;
