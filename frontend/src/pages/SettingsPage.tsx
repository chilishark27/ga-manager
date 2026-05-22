import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function SettingsPage() {
  const { theme, toggleTheme, showToast, llmConfigs, fetchLLMs, setConfigured } = useStore();
  const { t, lang, setLang } = useI18n();

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const [gaPath, setGaPath] = useState('');
  const [pythonPath, setPythonPath] = useState('');
  const [port, setPort] = useState('18600');
  const [mykeyContent, setMykeyContent] = useState('');
  const [mykeyLoading, setMykeyLoading] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [plugins, setPlugins] = useState<{ name: string; file: string; desc: string }[]>([]);

  useEffect(() => {
    fetchLLMs();
    loadMykey();
    loadAppConfig();
    loadPlugins();
    const updater = (window as any).electronUpdater;
    if (updater) {
      updater.onUpdateAvailable((info: any) => setUpdateStatus(`v${info.version} ${lang === 'zh' ? '可更新' : 'available'}`));
      updater.onUpdateError(() => setUpdateStatus(lang === 'zh' ? '已是最新版本' : 'Up to date'));
    }
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

  const loadPlugins = async () => {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) setPlugins(await res.json());
    } catch {}
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
            <div style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' }}>v{__APP_VERSION__}</div>
            <button className="ch-btn" onClick={() => {
              const updater = (window as any).electronUpdater;
              if (updater) {
                setUpdateStatus(lang === 'zh' ? '检查中...' : 'Checking...');
                updater.checkForUpdate();
                setTimeout(() => {
                  setUpdateStatus(s => s === (lang === 'zh' ? '检查中...' : 'Checking...') ? (lang === 'zh' ? '已是最新版本' : 'Up to date') : s);
                }, 10000);
              } else {
                setUpdateStatus(lang === 'zh' ? '仅桌面版支持自动更新' : 'Desktop app only');
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
              <button className="btn-danger btn-sm" onClick={() => setConfigured(false)} title={lang === 'zh' ? '重新进入配置引导' : 'Re-run setup wizard'}>{lang === 'zh' ? '重新配置' : 'Reconfigure'}</button>
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
          <div className="page-card" style={{ marginBottom: '16px' }}>
            <div className="page-card-title">LLM Configurations</div>
            <div className="settings-llm-list">
              {llmConfigs.map(cfg => (
                <div key={cfg.index} className="settings-llm-item">
                  <span className="settings-llm-idx">#{cfg.index}</span>
                  <span className="settings-llm-name">{cfg.name}</span>
                  {cfg.model && <span className="settings-llm-model">{cfg.model}</span>}
                  <span className="settings-llm-type">{cfg.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plugins */}
        <div className="page-card">
          <div className="page-card-title">{lang === 'zh' ? '插件 (Hooks)' : 'Plugins (Hooks)'}</div>
          {plugins.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              {lang === 'zh' ? '未检测到插件。将 .py 文件放入 GA 项目的 plugins/ 目录即可自动加载。' : 'No plugins found. Place .py files in the plugins/ directory of your GA project.'}
            </p>
          ) : (
            <div className="settings-plugins-list">
              {plugins.map(p => (
                <div key={p.file} className="settings-plugin-item">
                  <span className="settings-plugin-name">{p.name}</span>
                  {p.desc && <span className="settings-plugin-desc">{p.desc}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
