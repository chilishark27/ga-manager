import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

interface UpdateInfo {
  version: string;
  releaseNotes: string;
  releaseDate?: string;
}

interface ProgressInfo {
  percent: number;
  transferred: number;
  total: number;
}

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready';

function UpdateNotifier() {
  const { lang } = useI18n();
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = (window as any).electronUpdater;
    if (!updater) return;

    updater.onUpdateAvailable((data: UpdateInfo) => {
      setInfo(data);
      setState('available');
      setDismissed(false);
    });

    updater.onUpdateProgress((data: ProgressInfo) => {
      setProgress(data);
      setState('downloading');
    });

    updater.onUpdateDownloaded((data: UpdateInfo) => {
      setInfo(data);
      setState('ready');
    });
  }, []);

  if (state === 'idle' || dismissed) return null;

  const handleInstall = () => {
    const updater = (window as any).electronUpdater;
    if (updater) updater.installUpdate();
  };

  return (
    <div className="update-notifier">
      <div className="update-notifier-content">
        <div className="update-notifier-text">
          {state === 'available' && (
            <span>{lang === 'zh' ? `发现新版本 v${info?.version}，正在下载...` : `New version v${info?.version} found, downloading...`}</span>
          )}
          {state === 'downloading' && (
            <span>{lang === 'zh' ? `下载中 ${progress?.percent || 0}%` : `Downloading ${progress?.percent || 0}%`}</span>
          )}
          {state === 'ready' && (
            <span>{lang === 'zh' ? `v${info?.version} 已下载完成` : `v${info?.version} downloaded`}</span>
          )}
        </div>

        {state === 'downloading' && progress && (
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        )}

        {info?.releaseNotes && (
          <div className="update-notes">
            <pre>{typeof info.releaseNotes === 'string' ? info.releaseNotes : JSON.stringify(info.releaseNotes)}</pre>
          </div>
        )}

        <div className="update-notifier-actions">
          {state === 'ready' && (
            <button className="ch-btn" onClick={handleInstall}>
              {lang === 'zh' ? '立即更新' : 'Install Now'}
            </button>
          )}
          <button className="ch-btn" onClick={() => setDismissed(true)}>
            {lang === 'zh' ? '稍后' : 'Later'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpdateNotifier;
