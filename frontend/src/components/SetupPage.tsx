import { useState, useEffect } from 'react';
import { useStore } from '../store';

/**
 * SetupPage - First-time setup wizard for GA Manager.
 * Guides user to configure GA project path before using the app.
 */
export default function SetupPage() {
  const [gaPath, setGaPath] = useState('');
  const [pythonPath, setPythonPath] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { setConfigured } = useStore();

  useEffect(() => {
    // Auto-detect GA paths on mount
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
    // Load current python path
    fetch('/api/config/app')
      .then(res => res.ok ? res.json() : {})
      .then((data: any) => { if (data.python_path) setPythonPath(data.python_path); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    const path = gaPath.trim();
    if (!path) {
      setError('请输入 GA 项目路径');
      return;
    }
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
        setError(data.error || '保存失败');
        return;
      }
      setConfigured(true);
    } catch (e: any) {
      setError(e.message || '网络错误');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-header">
          <img src="/app.png?v=2" alt="GA Manager" className="setup-logo" />
          <h1>GA Manager</h1>
          <p className="setup-subtitle">配置 GenericAgent 项目路径以开始使用</p>
        </div>

        <div className="setup-body">
          <div className="setup-step">
            <span className="step-num">1</span>
            <span className="step-text">定位你的 GenericAgent 项目文件夹（包含 agentmain.py）</span>
          </div>

          {detecting && <div className="setup-detecting">正在扫描常见位置...</div>}

          {detected.length > 0 && (
            <div className="setup-detected">
              <label>检测到的路径：</label>
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
            <label>GA 项目路径</label>
            <input
              type="text"
              className="setup-input"
              placeholder="例如 D:\projects\GenericAgent"
              value={gaPath}
              onChange={(e) => setGaPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>

          <div className="setup-input-group">
            <label>Python 路径 (可选，留空自动检测)</label>
            <input
              type="text"
              className="setup-input"
              placeholder="例如 /opt/homebrew/bin/python3 或 python"
              value={pythonPath}
              onChange={(e) => setPythonPath(e.target.value)}
            />
          </div>

          {error && <div className="setup-error">{error}</div>}

          <button
            className="setup-btn"
            onClick={handleSave}
            disabled={saving || !gaPath.trim()}
          >
            {saving ? '保存中...' : '开始使用'}
          </button>

          <div className="setup-step" style={{ marginTop: '24px' }}>
            <span className="step-num">2</span>
            <span className="step-text">配置完成后，即可创建实例并开始对话</span>
          </div>
        </div>
      </div>
    </div>
  );
}
