import { useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function TopBar() {
  const {
    activeInstance: getActiveInstance, llmConfigs, fetchLLMs, switchLLM,
    toggleInstance, restartInstance,
  } = useStore();
  const { t } = useI18n();
  const inst = getActiveInstance();

  const [showLLMDropdown, setShowLLMDropdown] = useState(false);

  if (!inst) {
    return (
      <div className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-title">GA Manager</span>
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

      <div className="top-bar-right">
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
                  <span className="top-bar-llm-type">{cfg.type}</span>
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
      </div>
    </div>
  );
}

export default TopBar;
