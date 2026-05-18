import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function SettingsPage() {
  const { theme, toggleTheme, showToast, llmConfigs, fetchLLMs } = useStore();
  const { t, lang, setLang } = useI18n();

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const [gaPath, setGaPath] = useState('');
  const [pythonPath, setPythonPath] = useState('');
  const [port, setPort] = useState('18600');
  const [mykeyContent, setMykeyContent] = useState('');
  const [mykeyLoading, setMykeyLoading] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');

  useEffect(() => {
    fetchLLMs();
    loadMykey();
    loadAppConfig();
  }, []);

  const loadAppConfig = async () => {
    try {
      const res = await fetch('/api/config/app');
      if (res.ok) {
        const data = await res.json();
        setGaPath(data.ga_root || '');
        setPythonPath(data.python_path || (isMac ? 'python3' : 'python'));
        setPort(String(data.port || 18600));
      }
    } catch { /* ignore */ }
  };

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

  const saveAppConfig = async () => {
    try {
      const res = await fetch('/api/config/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ga_root: gaPath, python_path: pythonPath, port: parseInt(port) || 18600 }),
      });
      if (res.ok) {
        showToast(lang === 'zh' ? '配置已保存' : 'Config saved');
      } else {
        showToast(lang === 'zh' ? '保存失败' : 'Save failed');
      }
    } catch {
      showToast(lang === 'zh' ? '保存失败' : 'Save failed');
    }
  };

  return (
    <div className="settings-page">
      <div className="page-container">
        <h2 className="page-header">Settings</h2>

        {/* Top row: Theme + Language + App Config in one horizontal row */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {/* Theme card */}
          <div className="page-card" style={{ flex: '1', minWidth: '160px' }}>
            <div className="page-card-title">Theme</div>
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

          {/* Language card */}
          <div className="page-card" style={{ flex: '1', minWidth: '160px' }}>
            <div className="page-card-title">Language</div>
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

          {/* Update card */}
          <div className="page-card" style={{ flex: '1', minWidth: '160px' }}>
            <div className="page-card-title">{lang === 'zh' ? '版本更新' : 'Updates'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' }}>v2.2.4</div>
            <button className="ch-btn" onClick={() => {
              const updater = (window as any).electronUpdater;
              if (updater) {
                setUpdateStatus(lang === 'zh' ? '检查中...' : 'Checking...');
                updater.checkForUpdate();
                updater.onUpdateAvailable(() => setUpdateStatus(lang === 'zh' ? '发现新版本，下载中...' : 'New version found, downloading...'));
                updater.onUpdateDownloaded(() => setUpdateStatus(lang === 'zh' ? '下载完成，可以更新' : 'Ready to install'));
                updater.onUpdateError(() => setUpdateStatus(lang === 'zh' ? '已是最新版本' : 'Already up to date'));
                setTimeout(() => { if (updateStatus === (lang === 'zh' ? '检查中...' : 'Checking...')) setUpdateStatus(lang === 'zh' ? '已是最新版本' : 'Already up to date'); }, 8000);
              } else {
                setUpdateStatus(lang === 'zh' ? '仅 Electron 版本支持自动更新' : 'Auto-update only in Electron app');
              }
            }}>
              {lang === 'zh' ? '检查更新' : 'Check for Updates'}
            </button>
            {updateStatus && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' }}>{updateStatus}</div>}
          </div>

          {/* App Config card */}
          <div className="page-card" style={{ flex: '2', minWidth: '280px' }}>
            <div className="page-card-title">App Configuration</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '120px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '4px' }}>GA Root</label>
                <input className="rp-input" value={gaPath} onChange={e => setGaPath(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ flex: '1', minWidth: '100px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '4px' }}>Python</label>
                <input className="rp-input" value={pythonPath} onChange={e => setPythonPath(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ minWidth: '70px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', marginBottom: '4px' }}>Port</label>
                <input className="rp-input" value={port} onChange={e => setPort(e.target.value)} style={{ width: '70px' }} />
              </div>
              <button className="btn-primary btn-sm" onClick={saveAppConfig}>Save</button>
            </div>
          </div>
        </div>

        {/* mykey.py Editor - full width */}
        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div className="page-card-title" style={{ marginBottom: 0 }}>mykey.py Editor</div>
            <button className="btn-primary btn-sm" onClick={saveMykey}>Save mykey.py</button>
          </div>
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
              style={{ minHeight: '280px' }}
            />
          )}
        </div>

        {/* LLM Configs Overview */}
        {llmConfigs.length > 0 && (
          <div className="page-card">
            <div className="page-card-title">LLM Configurations</div>
            <div className="settings-llm-list">
              {llmConfigs.map(cfg => (
                <div key={cfg.index} className="settings-llm-item">
                  <span className="settings-llm-idx">#{cfg.index}</span>
                  <span className="settings-llm-name">{cfg.name}</span>
                  <span className="settings-llm-type">{cfg.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
