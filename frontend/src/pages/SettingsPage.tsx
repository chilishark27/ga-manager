import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function SettingsPage() {
  const { theme, toggleTheme, showToast, llmConfigs, fetchLLMs } = useStore();
  const { t, lang, setLang } = useI18n();

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const [gaPath, setGaPath] = useState(() => localStorage.getItem('ga_root') || (isMac ? '/Users/Shared/GenericAgent' : 'D:\\python3_project\\GenericAgent'));
  const [pythonPath, setPythonPath] = useState(() => localStorage.getItem('ga_python') || 'python');
  const [port, setPort] = useState(() => localStorage.getItem('ga_port') || '9015');
  const [mykeyContent, setMykeyContent] = useState('');
  const [mykeyLoading, setMykeyLoading] = useState(false);

  useEffect(() => {
    fetchLLMs();
    loadMykey();
  }, []);

  const loadMykey = async () => {
    setMykeyLoading(true);
    try {
      const res = await fetch('/api/config/mykey');
      if (res.ok) {
        const data = await res.json();
        setMykeyContent(data.content || '');
      }
    } catch { /* ignore */ }
    setMykeyLoading(false);
  };

  const saveMykey = async () => {
    try {
      const res = await fetch('/api/config/mykey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mykeyContent }),
      });
      if (res.ok) {
        showToast('mykey.py saved');
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
  };

  const saveAppConfig = () => {
    localStorage.setItem('ga_root', gaPath);
    localStorage.setItem('ga_python', pythonPath);
    localStorage.setItem('ga_port', port);
    showToast('Config saved');
  };

  return (
    <div className="settings-page">
      <div className="page-container">
        <h2 className="page-header">Settings</h2>
        <div className="page-grid">
          {/* mykey.py Editor */}
          <div className="page-card" style={{ gridColumn: 'span 2' }}>
            <div className="page-card-title">mykey.py Editor</div>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px' }}>
              LLM API keys configuration file. Format: variable_name = "key_value"
            </p>
            {mykeyLoading ? (
              <p style={{ color: 'var(--text-3)' }}>Loading...</p>
            ) : (
              <textarea
                className="settings-textarea"
                value={mykeyContent}
                onChange={e => setMykeyContent(e.target.value)}
                placeholder={'# mykey.py\nclaude47 = "sk-ant-xxx..."\nclaude47_apibase = "https://api.anthropic.com"'}
                rows={12}
              />
            )}
            <button className="action-btn" style={{ marginTop: '10px' }} onClick={saveMykey}>Save mykey.py</button>
          </div>

          {/* App Config */}
          <div className="page-card">
            <div className="page-card-title">App Configuration</div>
            <div className="settings-field">
              <label>GA Root Path</label>
              <input className="rp-input" value={gaPath} onChange={e => setGaPath(e.target.value)} />
            </div>
            <div className="settings-field">
              <label>Python Path</label>
              <input className="rp-input" value={pythonPath} onChange={e => setPythonPath(e.target.value)} />
            </div>
            <div className="settings-field">
              <label>Manager Port</label>
              <input className="rp-input" value={port} onChange={e => setPort(e.target.value)} />
            </div>
            <button className="action-btn" style={{ marginTop: '10px' }} onClick={saveAppConfig}>Save Config</button>
          </div>

          {/* Theme Toggle */}
          <div className="page-card">
            <div className="page-card-title">Appearance</div>
            <div className="settings-field">
              <label>Theme</label>
              <div className="settings-toggle-row">
                <button
                  className={`pill-btn ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => { if (theme !== 'dark') toggleTheme(); }}
                >
                  Dark
                </button>
                <button
                  className={`pill-btn ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => { if (theme !== 'light') toggleTheme(); }}
                >
                  Light
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label>Language</label>
              <div className="settings-toggle-row">
                <button
                  className={`pill-btn ${lang === 'en' ? 'active' : ''}`}
                  onClick={() => setLang('en')}
                >
                  English
                </button>
                <button
                  className={`pill-btn ${lang === 'zh' ? 'active' : ''}`}
                  onClick={() => setLang('zh')}
                >
                  Chinese
                </button>
              </div>
            </div>
          </div>

          {/* LLM Configs Overview */}
          <div className="page-card">
            <div className="page-card-title">LLM Configurations</div>
            {llmConfigs.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: '12px' }}>No LLM configs found. Configure mykey.py first.</p>
            ) : (
              <div className="settings-llm-list">
                {llmConfigs.map(cfg => (
                  <div key={cfg.index} className="settings-llm-item">
                    <span className="settings-llm-idx">#{cfg.index}</span>
                    <span className="settings-llm-name">{cfg.name}</span>
                    <span className="settings-llm-type">{cfg.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
