import { useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

const MORPHLING_TYPES = [
  { key: 'call', label: 'Call', labelZh: '调用型', desc: 'Integrate target into your toolchain', descZh: '把目标能力纳入自身工具链' },
  { key: 'rewrite', label: 'Rewrite', labelZh: '重写型', desc: 'Understand core, implement better version', descZh: '理解核心后从零实现更好版本' },
  { key: 'hybrid', label: 'Hybrid', labelZh: '混合型', desc: 'Call some, rewrite some, discard some', descZh: '调用+重写+舍弃，按组件决定' },
];

export default function MorphlingPage() {
  const { setPage } = useStore();
  const activeInstance = useStore(s => s.activeInstance());
  const { lang } = useI18n();
  const isZh = lang === 'zh';

  const [target, setTarget] = useState('');
  const [morphType, setMorphType] = useState('hybrid');
  const [tests, setTests] = useState('');
  const [components, setComponents] = useState('');
  const [workers, setWorkers] = useState(3);
  const [budget, setBudget] = useState(60);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const buildObjective = () => {
    const typeInfo = MORPHLING_TYPES.find(t => t.key === morphType);
    return `[Morphling - ${typeInfo?.label}] 目标项目: ${target}

执行 Morphling SOP 流程:
1. 锁定目标: ${target}
2. 目标拆解: 识别项目类型和核心价值
3. 测例提取: ${tests || '从项目 README/tests/CI 中提取'}
4. 组件分解: ${components || '列出核心模块和依赖'}
5. 行为选择: 按 ${typeInfo?.label} 模式决定每个组件的处理方式
6. 实现闭环: 先跑通测例的最小版本
7. 对照验证: 与目标在同一测例上对比

输出要求:
- 每个核心组件标注: 调用/重写/舍弃 + 理由
- 至少一个可测维度超过目标
- 产出可运行的代码或工具链配置`;
  };

  const startMorphling = async () => {
    if (!target.trim()) { setError(isZh ? '请输入目标项目' : 'Target project is required'); return; }
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/hive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: buildObjective(),
          budget_minutes: budget,
          workers: workers,
          llm_no: activeInstance?.llm_no || 0,
        }),
      });
      if (res.ok) {
        setPage('hive');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to start');
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    }
    setStarting(false);
  };

  return (
    <div className="morphling-page">
      <div className="page-container">
        <h2 className="page-header">{isZh ? 'Morphling 能力吸收' : 'Morphling'}</h2>

        <div className="page-card" style={{ maxWidth: '700px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '20px', lineHeight: 1.6 }}>
            {isZh
              ? '给定目标项目，通过 Hive 多 Agent 协作完成能力吸收/替代。按组件选择调用、重写或舍弃，最终在同一测例上达到或超过目标。'
              : 'Given a target project, use Hive multi-agent collaboration to absorb/replace its capabilities. Decide per-component: call, rewrite, or discard.'}
          </p>

          {/* Target */}
          <div className="form-group">
            <label>{isZh ? '目标项目' : 'Target Project'}</label>
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={isZh ? 'GitHub URL / 项目名 / 产品描述' : 'GitHub URL / project name / product description'}
            />
          </div>

          {/* Type */}
          <div className="form-group">
            <label>{isZh ? '吸收模式' : 'Morphling Type'}</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {MORPHLING_TYPES.map(t => (
                <div
                  key={t.key}
                  className={`morphling-type-card ${morphType === t.key ? 'active' : ''}`}
                  onClick={() => setMorphType(t.key)}
                >
                  <span className="morphling-type-name">{isZh ? t.labelZh : t.label}</span>
                  <span className="morphling-type-desc">{isZh ? t.descZh : t.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tests */}
          <div className="form-group">
            <label>{isZh ? '测例/验收标准（可选）' : 'Tests / Acceptance Criteria (optional)'}</label>
            <textarea
              value={tests}
              onChange={e => setTests(e.target.value)}
              placeholder={isZh ? '目标项目的 benchmark、CI、demo、性能指标...' : 'Benchmarks, CI tests, demos, performance metrics...'}
              rows={3}
            />
          </div>

          {/* Components */}
          <div className="form-group">
            <label>{isZh ? '已知核心组件（可选）' : 'Known Core Components (optional)'}</label>
            <textarea
              value={components}
              onChange={e => setComponents(e.target.value)}
              placeholder={isZh ? '列出你已知的核心模块，留空让 Agent 自动分析' : 'List known core modules, leave empty for Agent to analyze'}
              rows={2}
            />
          </div>

          {/* Config */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>{isZh ? '时间预算（分钟）' : 'Budget (minutes)'}</label>
              <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} min={10} max={480} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Workers</label>
              <input type="number" value={workers} onChange={e => setWorkers(Number(e.target.value))} min={1} max={5} />
            </div>
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

          <button
            className="btn-primary"
            style={{ width: '100%', padding: '12px' }}
            onClick={startMorphling}
            disabled={starting || !target.trim()}
          >
            {starting ? (isZh ? '启动中...' : 'Starting...') : (isZh ? '启动 Morphling (via Hive)' : 'Start Morphling (via Hive)')}
          </button>
        </div>
      </div>
    </div>
  );
}
