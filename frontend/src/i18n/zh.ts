const zh = {
  // Common
  close: '关闭', cancel: '取消', confirm: '确认', save: '💾 保存', send: '发送',
  loading: '加载中...', delete: '删除', forward: '转发', download: '⬇️ 下载',

  // Sidebar
  newInstance: '+ 新建实例', createInstance: '创建新实例', instanceName: '实例名称 (可选)',
  selectLLM: '选择 LLM 模型', noLLMConfig: '⚠️ 未检测到LLM配置，请先在 GA 目录下配置 mykey.py',
  create: '创建', deleteInstance: '删除实例', confirmDelete: '确定删除实例 "{name}"？',
  language: '语言', langZh: '中文', langEn: 'English',

  // ChatPanel - Welcome
  welcomeTitle: '欢迎使用 GA Manager', welcomeDesc: '创建一个 Agent 实例，开始智能对话与自动化任务',
  step1: '点击左侧 <strong>+ 新建实例</strong> 或下方按钮', step2: '选择 LLM 模型（如 Claude、GPT）',
  step3: '开始对话，启用自主行动、定时任务等功能', createNow: '🚀 立即创建实例',

  // ChatPanel - Status & Actions
  statusRunning: '运行中', statusStopped: '已停止', resume: '▶ 恢复',
  newChat: '🔄 新对话', interrupt: '⏹ 中断', noIM: '无IM',
  selectLLMModel: '选择LLM模型 (当前: {current})', selectIMChannel: '选择IM渠道 (当前: {current})',
  chatWith: '与 {name} 对话', chatHint: '输入消息或使用快捷操作', sendFailed: '发送失败',
  inputPlaceholder: '输入消息... (Ctrl+V 粘贴图片)', pastedCount: '已粘贴 {n} 张图片',
  supportPaste: '支持粘贴图片', llmNotConfigured: 'LLM 未配置',

  // ChatPanel - IM
  imNone: '无(仅Web)', imQQ: 'QQ', imTelegram: 'Telegram', imDiscord: 'Discord',
  imWechat: '微信', imWecom: '企业微信', imDingtalk: '钉钉', imFeishu: '飞书',
  imHintQQ: '需配置: go-cqhttp地址 + QQ号', imHintTelegram: '需配置: Bot Token (从@BotFather获取)',
  imHintDiscord: '需配置: Bot Token + Channel ID', imHintWechat: '需配置: itchat扫码登录',
  imHintWecom: '需配置: CorpID + AgentID + Secret', imHintDingtalk: '需配置: AppKey + AppSecret + 机器人Webhook',
  imHintFeishu: '需配置: App ID + App Secret + 事件回调',
  imConfigTip: '💡 提示：请在GA项目的 mykey.py 中配置对应渠道的密钥信息，然后重启实例生效。',

  // RightPanel - Instance Info
  uptime: '运行时间', tokenUsage: 'Token 用量', healthStatus: '健康状态',
  imChannel: 'IM渠道', notConfigured: '未配置',

  // RightPanel - Resources
  systemResources: '系统资源', memory: '内存', disk: '磁盘',

  // RightPanel - Features
  featureToggles: '功能开关', featAutonomous: '自主行动', featGoal: '目标模式',
  featReflect: '反思模式', featScheduler: '定时任务', featTeamWorker: '团队协作',

  // RightPanel - Tabs
  tabOverview: '概览', tabSchedules: '定时', tabSophub: 'SOP',

  // RightPanel - Overview
  quickActions: '快捷操作', exportChat: '导出对话', config: '配置',
  restartAll: '全部重启', stopAll: '全部停止',
  sendCommand: '发送指令', commandPlaceholder: '输入系统指令...',
  forwardMessage: '消息转发', selectTargetInstance: '选择目标实例', forwardContent: '转发内容...',

  // RightPanel - LLM Key Config
  llmKeyConfig: 'LLM密钥配置 (mykey.py)',
  mykeyGuide: '在GA项目根目录创建',
  mykeyFormat: '格式：模型名 = "API Key" + 模型名_apibase = "URL"',
  mykeyLocation: '文件位置',

  // RightPanel - Schedules
  addSchedule: '添加定时任务',
  cronEvery5m: '每5分钟', cronEvery30m: '每30分钟', cronEveryHour: '每小时',
  cronDaily9: '每天9点', cronDaily18: '每天18点', cronWeekday9: '工作日9点',
  cronPlaceholder: 'Cron 表达式 (如 */5 * * * *)', taskPlaceholder: '任务内容 (如: 检查邮件并汇报)',
  addTask: '添加任务', fillCronAndTask: '请填写 Cron 表达式和任务内容',
  taskList: '任务列表', noSchedules: '暂无定时任务，使用上方表单添加', nextRun: '下次',

  // RightPanel - SOP Hub
  sophubSearch: 'SOP Hub 搜索', sophubPlaceholder: '搜索 SOP (如: 爬虫、自动化、数据分析)...',
  noResults: '无结果，试试其他关键词', source: '来源',

  // RightPanel - Modals
  selectLLMTitle: '选择 LLM', selectIMTitle: '选择 IM 渠道', clearIM: '❌ 清除',
  imEnableTip: '💡 提示：启用IM渠道前，请确保已在GA项目的对应配置文件中完成渠道配置（如QQ需配置go-cqhttp，Telegram需配置Bot Token等）',
  systemConfig: '⚙️ 系统配置', gaPath: 'GA 项目路径', pythonPath: 'Python 路径', configSaved: '配置已保存',
};
export default zh;
export type Locale = typeof zh;
