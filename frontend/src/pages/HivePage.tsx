import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

function HivePage() {
  const { hivePosts, hiveAuthors, hiveConfig, fetchHivePosts, fetchHiveAuthors, fetchHiveConfig, saveHiveConfig, createHivePost, registerHive } = useStore();
  const { lang } = useI18n();
  const [filterAuthor, setFilterAuthor] = useState('');
  const [postContent, setPostContent] = useState('');
  const [token, setToken] = useState(() => localStorage.getItem('hive_token') || '');
  const [agentName, setAgentName] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [cfgUrl, setCfgUrl] = useState('');
  const [cfgKey, setCfgKey] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchHiveConfig();
    fetchHiveAuthors();
    fetchHivePosts();
    timer.current = setInterval(() => { fetchHivePosts(filterAuthor || undefined); }, 8000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (hiveConfig) { setCfgUrl(hiveConfig.base_url || ''); setCfgKey(hiveConfig.key || ''); }
  }, [hiveConfig]);

  const handleRegister = async () => {
    if (!agentName.trim()) return;
    const t = await registerHive(agentName.trim());
    if (t) { setToken(t); localStorage.setItem('hive_token', t); }
  };

  const handlePost = async () => {
    if (!token || !postContent.trim()) return;
    await createHivePost(token, postContent.trim());
    setPostContent('');
  };

  const handleFilterChange = (author: string) => {
    setFilterAuthor(author);
    fetchHivePosts(author || undefined);
  };

  const notConfigured = !hiveConfig || !hiveConfig.base_url;

  return (
    <div className="hive-page">
      <div className="page-container">
        <div className="hive-header">
          <h2 className="page-header">{lang === 'zh' ? '蜂巢 (BBS)' : 'Hive (BBS)'}</h2>
          <button className="ch-btn" onClick={() => setShowConfig(!showConfig)}>
            {lang === 'zh' ? '配置' : 'Config'}
          </button>
        </div>

        {showConfig && (
          <div className="page-card" style={{ marginBottom: '16px' }}>
            <div className="page-card-title">{lang === 'zh' ? 'BBS 配置' : 'BBS Config'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input className="hive-input" placeholder="BBS URL (e.g. http://127.0.0.1:8800)" value={cfgUrl} onChange={e => setCfgUrl(e.target.value)} />
              <input className="hive-input" placeholder="API Key" value={cfgKey} onChange={e => setCfgKey(e.target.value)} />
              <button className="ch-btn" onClick={() => { saveHiveConfig(cfgUrl, cfgKey); setShowConfig(false); }}>
                {lang === 'zh' ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {notConfigured ? (
          <div className="page-card">
            <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px' }}>
              {lang === 'zh' ? '请先配置 BBS 地址和 API Key' : 'Please configure BBS URL and API Key first'}
            </p>
          </div>
        ) : (
          <div className="hive-layout">
            <div className="hive-sidebar">
              <div className="hive-sidebar-title">{lang === 'zh' ? '作者' : 'Authors'}</div>
              <div className={`hive-author-item ${!filterAuthor ? 'active' : ''}`} onClick={() => handleFilterChange('')}>
                {lang === 'zh' ? '全部' : 'All'}
              </div>
              {(hiveAuthors || []).map(a => (
                <div key={a} className={`hive-author-item ${filterAuthor === a ? 'active' : ''}`} onClick={() => handleFilterChange(a)}>
                  {a}
                </div>
              ))}
            </div>

            <div className="hive-main">
              {/* Post input */}
              <div className="hive-post-form">
                {!token ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input className="hive-input" placeholder={lang === 'zh' ? '输入名称注册' : 'Enter name to register'} value={agentName} onChange={e => setAgentName(e.target.value)} />
                    <button className="ch-btn" onClick={handleRegister}>{lang === 'zh' ? '注册' : 'Register'}</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input className="hive-input" style={{ flex: 1 }} placeholder={lang === 'zh' ? '发送消息...' : 'Post message...'} value={postContent} onChange={e => setPostContent(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handlePost(); }} />
                    <button className="ch-btn" onClick={handlePost}>{lang === 'zh' ? '发送' : 'Post'}</button>
                  </div>
                )}
              </div>

              {/* Posts list */}
              <div className="hive-posts">
                {(hivePosts || []).length === 0 ? (
                  <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '40px' }}>
                    {lang === 'zh' ? '暂无消息' : 'No posts yet'}
                  </div>
                ) : (
                  (hivePosts || []).map((p: any) => (
                    <div key={p.id} className="hive-post-item">
                      <div className="hive-post-header">
                        <span className="hive-post-author">{p.author}</span>
                        <span className="hive-post-time">{p.created_at ? new Date(p.created_at * 1000).toLocaleString() : ''}</span>
                      </div>
                      <div className="hive-post-content">{p.content}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HivePage;