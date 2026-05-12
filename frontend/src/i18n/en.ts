import type { Locale } from './zh';

const en: Locale = {
  // Common
  close: 'Close', cancel: 'Cancel', confirm: 'Confirm', save: '💾 Save', send: 'Send',
  loading: 'Loading...', delete: 'Delete', forward: 'Forward', download: '⬇️ Download',

  // Sidebar
  newInstance: '+ New Instance', createInstance: 'Create Instance', instanceName: 'Instance Name (optional)',
  selectLLM: 'Select LLM Model', noLLMConfig: '⚠️ No LLM config found. Please configure mykey.py in GA directory first.',
  create: 'Create', deleteInstance: 'Delete Instance', confirmDelete: 'Delete instance "{name}"?',
  language: 'Language', langZh: '中文', langEn: 'English',

  // ChatPanel - Welcome
  welcomeTitle: 'Welcome to GA Manager', welcomeDesc: 'Create an Agent instance to start intelligent conversations and automation tasks',
  step1: 'Click <strong>+ New Instance</strong> on the left or the button below', step2: 'Select an LLM model (e.g. Claude, GPT)',
  step3: 'Start chatting, enable autonomous actions, scheduled tasks, and more', createNow: '🚀 Create Instance Now',

  // ChatPanel - Status & Actions
  statusRunning: 'Running', statusStopped: 'Stopped', resume: '▶ Resume',
  newChat: '🔄 New Chat', interrupt: '⏹ Stop', noIM: 'No IM',
  selectLLMModel: 'Select LLM (current: {current})', selectIMChannel: 'Select IM Channel (current: {current})',
  chatWith: 'Chat with {name}', chatHint: 'Type a message or use quick actions', sendFailed: 'Send failed',
  inputPlaceholder: 'Type a message... (Ctrl+V to paste images)', pastedCount: '{n} image(s) pasted',
  supportPaste: 'Supports image paste', llmNotConfigured: 'LLM not configured',

  // ChatPanel - IM
  imNone: 'None (Web only)', imQQ: 'QQ', imTelegram: 'Telegram', imDiscord: 'Discord',
  imWechat: 'WeChat', imWecom: 'WeCom', imDingtalk: 'DingTalk', imFeishu: 'Feishu',
  imHintQQ: 'Requires: go-cqhttp address + QQ number', imHintTelegram: 'Requires: Bot Token (from @BotFather)',
  imHintDiscord: 'Requires: Bot Token + Channel ID', imHintWechat: 'Requires: itchat QR login',
  imHintWecom: 'Requires: CorpID + AgentID + Secret', imHintDingtalk: 'Requires: AppKey + AppSecret + Robot Webhook',
  imHintFeishu: 'Requires: App ID + App Secret + Event Callback',
  imConfigTip: '💡 Tip: Configure the channel credentials in mykey.py under your GA project, then restart the instance.',

  // RightPanel - Instance Info
  uptime: 'Uptime', tokenUsage: 'Token Usage', healthStatus: 'Health',
  imChannel: 'IM Channel', notConfigured: 'Not configured',

  // RightPanel - Resources
  systemResources: 'System Resources', memory: 'Memory', disk: 'Disk',

  // RightPanel - Features
  featureToggles: 'Feature Toggles', featAutonomous: 'Autonomous', featGoal: 'Goal Mode',
  featReflect: 'Reflect', featScheduler: 'Scheduler', featTeamWorker: 'Team Worker',

  // RightPanel - Tabs
  tabOverview: 'Overview', tabSchedules: 'Schedules', tabSophub: 'SOP',

  // RightPanel - Overview
  quickActions: 'Quick Actions', exportChat: 'Export Chat', config: 'Config',
  restartAll: 'Restart All', stopAll: 'Stop All',
  sendCommand: 'Send Command', commandPlaceholder: 'Enter system command...',
  forwardMessage: 'Forward Message', selectTargetInstance: 'Select target instance', forwardContent: 'Message to forward...',

  // RightPanel - LLM Key Config
  llmKeyConfig: 'LLM Key Config (mykey.py)',
  mykeyGuide: 'Create in GA project root:',
  mykeyFormat: 'Format: model_name = "API Key" + model_name_apibase = "URL"',
  mykeyLocation: 'File location',

  // RightPanel - Schedules
  addSchedule: 'Add Scheduled Task',
  cronEvery5m: 'Every 5min', cronEvery30m: 'Every 30min', cronEveryHour: 'Hourly',
  cronDaily9: 'Daily 9AM', cronDaily18: 'Daily 6PM', cronWeekday9: 'Weekdays 9AM',
  cronPlaceholder: 'Cron expression (e.g. */5 * * * *)', taskPlaceholder: 'Task content (e.g. check emails and report)',
  addTask: 'Add Task', fillCronAndTask: 'Please fill in cron expression and task content',
  taskList: 'Task List', noSchedules: 'No scheduled tasks yet. Use the form above to add one.', nextRun: 'Next',

  // RightPanel - SOP Hub
  sophubSearch: 'SOP Hub Search', sophubPlaceholder: 'Search SOPs (e.g. crawler, automation, data analysis)...',
  noResults: 'No results. Try other keywords.', source: 'Source',

  // RightPanel - Modals
  selectLLMTitle: 'Select LLM', selectIMTitle: 'Select IM Channel', clearIM: '❌ Clear',
  imEnableTip: '💡 Tip: Before enabling an IM channel, make sure you have configured it in the GA project (e.g. go-cqhttp for QQ, Bot Token for Telegram).',
  systemConfig: '⚙️ System Config', gaPath: 'GA Project Path', pythonPath: 'Python Path', configSaved: 'Config saved',
};
export default en;
