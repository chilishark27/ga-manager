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
    if (id) {
      useHiveStore.getState().selectProject(id);
      onClose();
    }
  };

  return (
    <div className="hv2-dialog-overlay" onClick={onClose}>
      <div className="hv2-dialog" onClick={e => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '新建 Hive 项目' : 'New Hive Project'}</h3>

        {/* Objective */}
        <div className="hv2-field">
          <label>{lang === 'zh' ? '目标描述' : 'Objective'}</label>
          <textarea
            className="hv2-input"
            placeholder={lang === 'zh' ? '描述你想要完成的任务...' : 'Describe what you want to accomplish...'}
            value={objective}
            onChange={e => setObjective(e.target.value)}
          />
        </div>

        {/* Settings row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="hv2-field" style={{ flex: 1 }}>
            <label>{lang === 'zh' ? '时间预算 (分钟)' : 'Budget (min)'}</label>
            <input
              className="hv2-input"
              type="number"
              value={budget}
              onChange={e => setBudget(+e.target.value)}
            />
          </div>
          <div className="hv2-field" style={{ flex: 1 }}>
            <label>Workers</label>
            <input
              className="hv2-input"
              type="number"
              value={workers}
              onChange={e => setWorkers(+e.target.value)}
              min={1}
              max={5}
            />
          </div>
          <div className="hv2-field" style={{ flex: 1 }}>
            <label>LLM</label>
            <select
              className="hv2-input"
              value={llmNo}
              onChange={e => setLlmNo(+e.target.value)}
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

        {/* Template selection */}
        {templates.length > 0 && (
          <div className="hv2-field">
            <label>{lang === 'zh' ? '模板 (可选)' : 'Template (optional)'}</label>
            <div className="hv2-template-grid">
              {/* No template option */}
              <div
                className={`hv2-template-card ${template === '' ? 'selected' : ''}`}
                onClick={() => { setTemplate(''); setVars({}); }}
              >
                <div className="name">{lang === 'zh' ? '自动拆解' : 'Auto-decompose'}</div>
                <div className="desc">{lang === 'zh' ? '无模板' : 'No template'}</div>
              </div>
              {templates.map(t => (
                <div
                  key={t.name}
                  className={`hv2-template-card ${template === t.name ? 'selected' : ''}`}
                  onClick={() => { setTemplate(t.name); setVars({}); }}
                >
                  <div className="name">{t.name}</div>
                  <div className="desc">{t.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Template variables */}
        {selectedTemplate?.variables.map(v => (
          <div className="hv2-field" key={v.name}>
            <label>{v.label}{v.required && ' *'}</label>
            <input
              className="hv2-input"
              value={vars[v.name] || v.default || ''}
              onChange={e => setVars({ ...vars, [v.name]: e.target.value })}
              placeholder={v.default || ''}
            />
          </div>
        ))}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="hv2-btn" onClick={onClose}>
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            className="hv2-btn primary"
            onClick={handleCreate}
            disabled={loading || !objective.trim()}
          >
            {loading ? '...' : (lang === 'zh' ? '创建' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
