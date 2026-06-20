import { useState, useEffect } from 'react';
import { useHiveStore } from '../../store/hive';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';

export default function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const { templates, fetchTemplates, createProject, loading } = useHiveStore();
  const llmConfigs = useStore(s => s.llmConfigs);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(60);
  const [workers, setWorkers] = useState(2);
  const [llmNo, setLlmNo] = useState(0);
  const [template, setTemplate] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => { fetchTemplates(); }, []);

  const selectedTemplate = templates.find(t => t.name === template);

  const handleCreate = async () => {
    const id = await createProject({
      objective,
      budget_minutes: budget,
      template: template || undefined,
      vars: Object.keys(vars).length ? vars : undefined,
      executor_config: { ga_llm_no: llmNo, ga_workers: workers, claude_code_enabled: true },
    });
    if (id) onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="page-card"
        style={{ maxWidth: 500, width: '90%', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px' }}>
          {lang === 'zh' ? '新建 Hive 项目' : 'New Hive Project'}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="hive-input"
            placeholder={lang === 'zh' ? '目标描述...' : 'Objective...'}
            value={objective}
            onChange={e => setObjective(e.target.value)}
            style={{ minHeight: 60, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {lang === 'zh' ? '时间预算(分钟)' : 'Budget (min)'}
              </label>
              <input
                className="hive-input"
                type="number"
                value={budget}
                onChange={e => setBudget(+e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)' }}>Workers</label>
              <input
                className="hive-input"
                type="number"
                value={workers}
                onChange={e => setWorkers(+e.target.value)}
                min={1}
                max={5}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)' }}>LLM</label>
              <select
                className="hive-input"
                value={llmNo}
                onChange={e => setLlmNo(+e.target.value)}
                style={{ height: 32 }}
              >
                {llmConfigs.length ? (
                  llmConfigs.map(c => (
                    <option key={c.index} value={c.index}>#{c.index} {c.name}</option>
                  ))
                ) : (
                  <option value={0}>#0</option>
                )}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {lang === 'zh' ? '模板(可选)' : 'Template (optional)'}
            </label>
            <select
              className="hive-input"
              value={template}
              onChange={e => { setTemplate(e.target.value); setVars({}); }}
              style={{ height: 32 }}
            >
              <option value="">
                {lang === 'zh' ? '无模板 (自动拆解)' : 'No template (auto-decompose)'}
              </option>
              {templates.map(t => (
                <option key={t.name} value={t.name}>{t.name} — {t.description}</option>
              ))}
            </select>
          </div>
          {selectedTemplate?.variables.map(v => (
            <div key={v.name}>
              <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {v.label}{v.required && ' *'}
              </label>
              <input
                className="hive-input"
                value={vars[v.name] || v.default || ''}
                onChange={e => setVars({ ...vars, [v.name]: e.target.value })}
                placeholder={v.default || ''}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="ch-btn" onClick={onClose}>
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button
              className="setup-btn"
              onClick={handleCreate}
              disabled={loading || !objective.trim()}
            >
              {loading ? '...' : (lang === 'zh' ? '创建' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
