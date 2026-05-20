import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

export default function SetupPage() {
  const [gaPath, setGaPath] = useState('');
  const [pythonPath, setPythonPath] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ ga_valid?: boolean; python_valid?: boolean; python_version?: string; bridge_valid?: boolean; message?: string } | null>(null);
  const { setConfigured } = useStore();
  const { lang } = useI18n();

  useEffect(() => {
    setDetecting(true);
    fetch('/api/config/detect-ga')
      .then(res => res.ok ? res.json() : { paths: [] })
      .then(data => {
        if (data.paths && data.paths.length > 0) {
          setDetected(data.paths);
          setGaPath(data.paths[0]);
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
    fetch('/api/config/app')
      .then(res => res.ok ? res.json() : {})
      .then((data: any) => { if (data.python_path) setPythonPath(data.python_path); })
      .catch(() => {});
  }, []);

  const handleValidate = async () => {
    const path = gaPath.trim();
    if (!path) { setError(lang === 'zh' ? '请输入 GA 项目路径' : 'Please enter GA project path'); return; }
    setValidating(true);
    setValidation(null);
    setError('');
    try {
      const body: any = { ga_root: path };
      if (pythonPath.trim()) body.python_path = pythonPath.trim();
      const res = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setValidation(data);
      if (!data.ga_valid) {
        setError(lang === 'zh' ? `路径无效: ${path} 中未找到 agentmain.py` : `Invalid path: agentmain.py not found in ${path}`);
      } else if (!data.python_valid) {
        setError(lang === 'zh' ? 'Python 不可用，请配置正确的 Python 可执行文件路径（不是目录）' : 'Python not available. Configure the full path to python executable (not directory)');
      } else if (!data.bridge_valid) {
        setError(lang === 'zh' ? 'Bridge 未找到，请检查安装是否完整' : 'Bridge not found, check if installation is complete');
      }
    } catch {
      setError(lang === 'zh' ? '验证失败，请检查后端是否运行' : 'Validation failed, check if backend is running');
    }
    setValidating(false);
  };

  const handleSave = async () => {
    const path = gaPath.trim();
    if (!path) { setError(lang === 'zh' ? '请输入 GA 项目路径' : 'Please enter GA project path'); return; }
    setSaving(true);
    setError('');
    try {
      const body: any = { ga_root: path };
      if (pythonPath.trim()) body.python_path = pythonPath.trim();
      const res = await fetch('/api/config/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setError(data.error || (lang === 'zh' ? '保存失败' : 'Save failed'));
        return;
      }
      setConfigured(true);
    } catch (e: any) {
      setError(e.message || (lang === 'zh' ? '网络错误' : 'Network error'));
    } finally {
      setSaving(false);
    }
  };

  const isZh = lang === 'zh';

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-header">
          <img src="/app.png?v=2" alt="GA Manager" className="setup-logo" />
          <h1>GA Manager</h1>
          <p className="setup-subtitle">{isZh ? '配置 GenericAgent 项目路径以开始使用' : 'Configure GenericAgent project path to get started'}</p>
        </div>

        <div className="setup-body">
          <div className="setup-step">
            <span className="step-num">1</span>
            <span className="step-text">{isZh ? '定位你的 GenericAgent 项目文件夹（包含 agentmain.py）' : 'Locate your GenericAgent project folder (contains agentmain.py)'}</span>
          </div>

          {detecting && <div className="setup-detecting">{isZh ? '正在扫描常见位置...' : 'Scanning common locations...'}</div>}

          {detected.length > 0 && (
            <div className="setup-detected">
              <label>{isZh ? '检测到的路径：' : 'Detected paths:'}</label>
              {detected.map((p) => (
                <button
                  key={p}
                  className={`detected-path ${gaPath === p ? 'active' : ''}`}
                  onClick={() => setGaPath(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="setup-input-group">
            <label>{isZh ? 'GA 项目路径' : 'GA Project Path'}</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="setup-input"
                style={{ flex: 1 }}
                placeholder={isZh ? '包含 agentmain.py 的目录' : 'Folder containing agentmain.py'}
                value={gaPath}
                onChange={(e) => { setGaPath(e.target.value); setValidation(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
              />
              <button
                className="ch-btn"
                onClick={async () => {
                  const dialog = (window as any).electronDialog;
                  if (dialog) {
                    const path = await dialog.selectFolder();
                    if (path) { setGaPath(path); setValidation(null); }
                  } else {
                    setError(isZh ? '文件夹选择仅在桌面版可用' : 'Folder picker only available in desktop app');
                  }
                }}
              >
                {isZh ? '浏览' : 'Browse'}
              </button>
            </div>
          </div>

          <div className="setup-input-group">
            <label>{isZh ? 'Python 路径（可选，留空自动检测）' : 'Python Path (optional, auto-detect if empty)'}</label>
            <input
              type="text"
              className="setup-input"
              placeholder={isZh ? '例如 python3' : 'e.g. python3'}
              value={pythonPath}
              onChange={(e) => { setPythonPath(e.target.value); setValidation(null); }}
            />
          </div>

          {/* Validation Results */}
          {validation && (
            <div className="setup-validation">
              <div className={`setup-check ${validation.ga_valid ? 'ok' : 'fail'}`}>
                <span className="check-icon">{validation.ga_valid ? '✓' : '✗'}</span>
                <span>{isZh ? 'GA 项目路径' : 'GA project path'}: {validation.ga_valid ? (isZh ? '有效' : 'valid') : (isZh ? '无效' : 'invalid')}</span>
              </div>
              <div className={`setup-check ${validation.python_valid ? 'ok' : 'fail'}`}>
                <span className="check-icon">{validation.python_valid ? '✓' : '✗'}</span>
                <span>Python: {validation.python_valid ? (validation.python_version || 'OK') : (isZh ? '不可用' : 'not available')}</span>
              </div>
              <div className={`setup-check ${validation.bridge_valid ? 'ok' : 'fail'}`}>
                <span className="check-icon">{validation.bridge_valid ? '✓' : '✗'}</span>
                <span>Bridge: {validation.bridge_valid ? 'OK' : (isZh ? '未找到' : 'not found')}</span>
              </div>
            </div>
          )}

          {error && <div className="setup-error">{error}</div>}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="setup-btn"
              style={{ flex: 1, background: 'var(--bg3)', color: 'var(--text-1)', border: '1px solid var(--border)', boxShadow: 'none' }}
              onClick={handleValidate}
              disabled={validating || !gaPath.trim()}
            >
              {validating ? (isZh ? '验证中...' : 'Validating...') : (isZh ? '验证配置' : 'Validate')}
            </button>
            <button
              className="setup-btn"
              style={{ flex: 1 }}
              onClick={handleSave}
              disabled={saving || !gaPath.trim()}
            >
              {saving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '开始使用' : 'Get Started')}
            </button>
          </div>

          <div className="setup-step" style={{ marginTop: '16px' }}>
            <span className="step-num">2</span>
            <span className="step-text">{isZh ? '配置完成后，即可创建实例并开始对话' : 'After setup, create an instance and start chatting'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
