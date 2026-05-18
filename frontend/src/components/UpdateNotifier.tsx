import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

interface UpdateInfo {
  version: string;
  releaseNotes: string;
}

interface ProgressInfo {
  percent: number;
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

  const handleDownload = () => {
    const updater = (window as any).electronUpdater;
    if (updater) updater.downloadUpdate();
    setState('downloading');
    setProgress({ percent: 0 });
  };

  const handleInstall = () => {
    const updater = (window as any).electronUpdater;
    if (updater) updater.installUpdate();
  };

  return (
    <div className="update-notifier">
      <div className="update-notifier-content">
        <div className="update-notifier-text">
          {state === 'available' && (
            <span>{lang === 'zh' ? `发现新版本 v${info?.version}` : `New version v${info?.version} available`}</span>
          )}
          {state === 'downloading' && (
            <span>{lang === 'zh' ? `下载中 ${progress?.percent || 0}%` : `Downloading ${progress?.percent || 0}%`}</span>
          )}
          {state === 'ready' && (
            <span>{lang === 'zh' ? `v${info?.version} 下载完成，重启即可更新` : `v${info?.version} ready to install`}</span>
          )}
        </div>

        {state === 'downloading' && progress && (
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        )}

        {info?.releaseNotes && state !== 'downloading' && (
          <div className="update-notes">
            <pre>{typeof info.releaseNotes === 'string' ? info.releaseNotes : JSON.stringify(info.releaseNotes)}</pre>
          </div>
        )}

        <div className="update-notifier-actions">
          {state === 'available' && (
            <button className="ch-btn" onClick={handleDownload}>
              {lang === 'zh' ? '下载更新' : 'Download'}
            </button>
          )}
          {state === 'ready' && (
            <button className="ch-btn" onClick={handleInstall}>
              {lang === 'zh' ? '重启更新' : 'Restart & Update'}
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
