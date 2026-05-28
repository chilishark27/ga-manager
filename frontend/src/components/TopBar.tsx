import { useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import WorktreePanel from './WorktreePanel';

function TopBar() {
  const {
    activeInstance: getActiveInstance, llmConfigs, fetchLLMs, switchLLM,
    toggleInstance, restartInstance,
    projectPath, projectName, setProject, clearProject, recentProjects, removeRecentProject,
    showTodoPanel, toggleTodoPanel, todos,
  } = useStore();
  const { t, lang } = useI18n();
  const inst = getActiveInstance();

  const [showLLMDropdown, setShowLLMDropdown] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showWorktree, setShowWorktree] = useState(false);

  if (!inst) {
    return (
      <div className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-title">GA Manager</span>
        </div>
        {/* Project Selector - always visible */}
        <div className="top-bar-project-wrapper">
          <div className="top-bar-project" onClick={() => setShowProjectDropdown(!showProjectDropdown)} title={projectPath || ''}>
            <span className="top-bar-project-name">{projectName || (lang === 'zh' ? '选择项目' : 'Select Project')}</span>
            <span className="top-bar-project-chevron">{showProjectDropdown ? '▴' : '▾'}</span>
          </div>
          {showProjectDropdown && (
            <div className="top-bar-project-dropdown">
              <div className="top-bar-project-option" onClick={async () => {
                try {
                  const res = await fetch('/api/project/browse', { method: 'POST' });
                  const data = await res.json();
                  if (data.path) { setProject(data.path); setShowProjectDropdown(false); }
                } catch {}
              }}>
                <span className="top-bar-project-opt-icon">+</span>
                {lang === 'zh' ? '打开文件夹...' : 'Open Folder...'}
              </div>
              {recentProjects.length > 0 && <div className="top-bar-project-divider" />}
              {recentProjects.map(p => (
                <div key={p.path} className={`top-bar-project-option ${p.path === projectPath ? 'active' : ''}`}
                  onClick={() => { setProject(p.path); setShowProjectDropdown(false); }}
                  title={p.path}>
                  <span className="top-bar-project-opt-icon">&#9679;</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span className="top-bar-project-del" onClick={(e) => { e.stopPropagation(); removeRecentProject(p.path); }}>&#10005;</span>
                </div>
              ))}
              {projectPath && (
                <>
                  <div className="top-bar-project-divider" />
                  <div className="top-bar-project-option" onClick={() => { clearProject(); setShowProjectDropdown(false); }}>
                    <span className="top-bar-project-opt-icon">&#10005;</span> {lang === 'zh' ? '关闭项目' : 'Close Project'}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="top-bar-right">
          <button className={`top-bar-ctrl-btn ${showTodoPanel ? 'active' : ''}`} onClick={toggleTodoPanel}>
            {lang === 'zh' ? '待办' : 'TODO'}{todos.filter(t => !t.done).length > 0 ? ` (${todos.filter(t => !t.done).length})` : ''}
          </button>
        </div>
      </div>
    );
  }

  const statusColor = (inst.status === 'running' || inst.status === 'busy') ? 'var(--green)' : 'var(--text-3)';
  const currentLLM = llmConfigs.find(c => c.index === inst.llm_no);

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-dot" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
        <span className="top-bar-name">{inst.name}</span>
        <span className="top-bar-status">{inst.status}</span>
        <span className="top-bar-pid">PID {inst.pid}</span>
      </div>

      {/* Project Selector */}
      <div className="top-bar-project-wrapper">
        <div className="top-bar-project" onClick={() => setShowProjectDropdown(!showProjectDropdown)} title={projectPath || ''}>
          <span className="top-bar-project-name">{projectName || (lang === 'zh' ? '选择项目' : 'Select Project')}</span>
          <span className="top-bar-project-chevron">{showProjectDropdown ? '▴' : '▾'}</span>
        </div>
        {showProjectDropdown && (
          <div className="top-bar-project-dropdown">
            <div className="top-bar-project-option" onClick={async () => {
              try {
                const res = await fetch('/api/project/browse', { method: 'POST' });
                const data = await res.json();
                if (data.path) { setProject(data.path); setShowProjectDropdown(false); }
              } catch {}
            }}>
              <span className="top-bar-project-opt-icon">+</span>
              {lang === 'zh' ? '打开文件夹...' : 'Open Folder...'}
            </div>
            {recentProjects.length > 0 && <div className="top-bar-project-divider" />}
            {recentProjects.map(p => (
              <div key={p.path} className={`top-bar-project-option ${p.path === projectPath ? 'active' : ''}`}
                onClick={() => { setProject(p.path); setShowProjectDropdown(false); }}
                title={p.path}>
                <span className="top-bar-project-opt-icon">&#9679;</span> {p.name}
              </div>
            ))}
            {projectPath && (
              <>
                <div className="top-bar-project-divider" />
                <div className="top-bar-project-option" onClick={() => { clearProject(); setShowProjectDropdown(false); }}>
                  <span className="top-bar-project-opt-icon">&#10005;</span> {lang === 'zh' ? '关闭项目' : 'Close Project'}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="top-bar-right">
        {/* Git Worktree */}
        {projectPath && (
          <button className="top-bar-ctrl-btn" onClick={() => setShowWorktree(true)}>
            Branches
          </button>
        )}

        {/* TODO Toggle */}
        <button className={`top-bar-ctrl-btn ${showTodoPanel ? 'active' : ''}`} onClick={toggleTodoPanel}>
          {lang === 'zh' ? '待办' : 'TODO'}{todos.filter(t => !t.done).length > 0 ? ` (${todos.filter(t => !t.done).length})` : ''}
        </button>

        {/* LLM Selector */}
        <div className="top-bar-llm-wrapper">
          <button
            className="top-bar-llm-btn"
            onClick={() => { fetchLLMs(); setShowLLMDropdown(!showLLMDropdown); }}
          >
            {currentLLM ? currentLLM.name : `LLM #${inst.llm_no}`}
          </button>
          {showLLMDropdown && (
            <div className="top-bar-llm-dropdown">
              {llmConfigs.map(cfg => (
                <div
                  key={cfg.index}
                  className={`top-bar-llm-option ${inst.llm_no === cfg.index ? 'active' : ''}`}
                  onClick={() => { switchLLM(inst.id, cfg.index); setShowLLMDropdown(false); }}
                >
                  <span className="top-bar-llm-name">{cfg.name}</span>
                  {cfg.model && <span className="top-bar-llm-type">{cfg.model}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instance controls */}
        <button
          className="top-bar-ctrl-btn"
          onClick={() => toggleInstance(inst.id)}
          title={inst.status === 'running' ? 'Stop' : 'Start'}
        >
          {(inst.status === 'running' || inst.status === 'busy') ? 'Stop' : 'Start'}
        </button>
        <button
          className="top-bar-ctrl-btn"
          onClick={() => restartInstance(inst.id)}
          title="Restart"
        >
          Restart
        </button>
        {/* Window Controls */}
        {(window as any).electronWindow && (
          <div className="window-controls">
            <button className="win-ctrl-btn" onClick={() => (window as any).electronWindow.minimize()} title="Minimize">&#x2014;</button>
            <button className="win-ctrl-btn" onClick={() => (window as any).electronWindow.maximize()} title="Maximize">&#x25A1;</button>
            <button className="win-ctrl-btn win-close" onClick={() => (window as any).electronWindow.close()} title="Close">&#x2715;</button>
          </div>
        )}
      </div>
      {showWorktree && <WorktreePanel onClose={() => setShowWorktree(false)} />}
    </div>
  );
}

export default TopBar;
