import { useI18n } from '../i18n';

function HelpPage() {
  const { lang } = useI18n();
  const isZh = lang === 'zh';

  return (
    <div className="settings-page">
      <div className="page-container">
        <h2 className="page-header">{isZh ? '使用说明' : 'User Guide'}</h2>

        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{isZh ? '快捷键' : 'Keyboard Shortcuts'}</div>
          <table className="help-table">
            <tbody>
              <tr><td><kbd>Ctrl+1~7</kbd></td><td>{isZh ? '切换页面' : 'Switch pages'}</td></tr>
              <tr><td><kbd>Ctrl+K</kbd></td><td>{isZh ? '搜索历史消息' : 'Search messages'}</td></tr>
              <tr><td><kbd>Ctrl+N</kbd></td><td>{isZh ? '新建实例' : 'New instance'}</td></tr>
              <tr><td><kbd>Enter</kbd></td><td>{isZh ? '发送消息' : 'Send message'}</td></tr>
              <tr><td><kbd>Shift+Enter</kbd></td><td>{isZh ? '换行' : 'New line'}</td></tr>
              <tr><td><kbd>↑ / ↓</kbd></td><td>{isZh ? '浏览输入历史' : 'Browse input history'}</td></tr>
              <tr><td><kbd>Escape</kbd></td><td>{isZh ? '关闭面板' : 'Close panel'}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{isZh ? '斜杠命令 (在聊天框输入 /)' : 'Slash Commands (type / in chat)'}</div>
          <table className="help-table">
            <tbody>
              <tr><td><code>/session.reasoning_effort=low|high</code></td><td>{isZh ? '调整思考强度' : 'Set thinking intensity'}</td></tr>
              <tr><td><code>/session.thinking_type=adaptive</code></td><td>{isZh ? '设置思考类型' : 'Set thinking type'}</td></tr>
              <tr><td><code>/session.temperature=0.7</code></td><td>{isZh ? '设置温度' : 'Set temperature'}</td></tr>
              <tr><td><code>/resume</code></td><td>{isZh ? '恢复最近会话' : 'Resume recent session'}</td></tr>
              <tr><td><code>/btw &lt;question&gt;</code></td><td>{isZh ? '旁路提问，不打断主流程' : 'Side question without interrupting'}</td></tr>
              <tr><td><code>/review</code></td><td>{isZh ? '审阅当前代码改动' : 'Review code changes'}</td></tr>
              <tr><td><code>/continue</code></td><td>{isZh ? '列出/恢复后台会话' : 'List/resume background sessions'}</td></tr>
              <tr><td><code>/clear</code></td><td>{isZh ? '清空上下文' : 'Clear context'}</td></tr>
              <tr><td><code>/stop</code></td><td>{isZh ? '停止当前任务' : 'Stop current task'}</td></tr>
              <tr><td><code>/status</code></td><td>{isZh ? '查看状态' : 'Show status'}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{isZh ? '实例管理' : 'Instance Management'}</div>
          <ul className="help-list">
            <li>{isZh ? '双击实例名称可重命名' : 'Double-click instance name to rename'}</li>
            <li>{isZh ? '拖拽实例可调整顺序' : 'Drag instances to reorder'}</li>
            <li>{isZh ? '实例崩溃时会自动重启并发送桌面通知' : 'Auto-restart on crash with desktop notification'}</li>
            <li>{isZh ? '任务完成时发送桌面通知（Electron 桌面版）' : 'Desktop notification on task complete (Electron)'}</li>
          </ul>
        </div>

        <div className="page-card" style={{ marginBottom: '16px' }}>
          <div className="page-card-title">{isZh ? '文件附件' : 'File Attachments'}</div>
          <ul className="help-list">
            <li>{isZh ? '拖拽文件到聊天输入框可附加文件路径' : 'Drag files to chat input to attach file paths'}</li>
            <li>{isZh ? 'Ctrl+V 粘贴图片直接发送给 LLM 分析' : 'Ctrl+V paste images for LLM vision analysis'}</li>
            <li>{isZh ? '点击 📎 按钮选择文件' : 'Click paperclip button to select files'}</li>
            <li>{isZh ? 'GA 回复中的图片路径会自动渲染预览' : 'Image paths in GA responses render as previews'}</li>
          </ul>
        </div>

        <div className="page-card">
          <div className="page-card-title">{isZh ? '页面说明' : 'Pages'}</div>
          <ul className="help-list">
            <li><strong>Chat</strong> — {isZh ? '与 GA 对话，支持图片/文件/斜杠命令' : 'Chat with GA, supports images/files/commands'}</li>
            <li><strong>Conductor</strong> — {isZh ? '多 Agent 编排，创建子代理并行工作' : 'Multi-agent orchestration with subagents'}</li>
            <li><strong>Monitor</strong> — {isZh ? 'Token 用量、系统资源、日志查看' : 'Token usage, system resources, log viewer'}</li>
            <li><strong>Skills</strong> — {isZh ? 'SOP 管理和 Sophub 市场' : 'SOP management and Sophub marketplace'}</li>
            <li><strong>Hive</strong> — {isZh ? '多 Agent 协作（BBS 模式）' : 'Multi-agent collaboration (BBS mode)'}</li>
            <li><strong>Settings</strong> — {isZh ? '配置 GA 路径、LLM、mykey、插件' : 'Configure GA path, LLM, mykey, plugins'}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default HelpPage;
