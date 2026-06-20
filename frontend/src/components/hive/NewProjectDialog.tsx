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
  const isZh = lang === 'zh';

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>{isZh ? '新建 Hive 项目' : 'New Hive Project'}</h3>

        {/* Objective */}
        <div className="form-group">
          <label>{isZh ? '目标描述' : 'Objective'}</label>
          <textarea
            className="modal-input"
            placeholder={isZh ? '描述你想要完成的任务...' : 'Describe what you want to accomplish...'}
            value={objective}
            onChange={e => setObjective(e.target.value)}
            style={{ minHeight: 80, resize: 'vertical' }}
          />
        </div>

        {/* Settings row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>{isZh ? '时间预算 (分钟)' : 'Budget (min)'}</label>
            <input
              className="modal-input"
              type="number"
              value={budget}
              onChange={e => setBudget(+e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Workers</label>
            <input
              className="modal-input"
              type="number"
              value={workers}
              onChange={e => setWorkers(+e.target.value)}
              min={1}
              max={5}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>LLM</label>
            <select
              className="modal-input"
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
          <div className="form-group">
            <label>{isZh ? '模板 (可选)' : 'Template (optional)'}</label>
            <select
              className="modal-input"
              value={template}
              onChange={e => { setTemplate(e.target.value); setVars({}); }}
            >
              <option value="">{isZh ? '自动拆解 (无模板)' : 'Auto-decompose (no template)'}</option>
              {templates.map(t => (
                <option key={t.name} value={t.name}>{t.name} — {t.description}</option>
              ))}
            </select>
          </div>
        )}

        {/* Template variables */}
        {selectedTemplate?.variables.map(v => (
          <div className="form-group" key={v.name}>
            <label>{v.label}{v.required && ' *'}</label>
            <input
              className="modal-input"
              value={vars[v.name] || v.default || ''}
              onChange={e => setVars({ ...vars, [v.name]: e.target.value })}
              placeholder={v.default || ''}
            />
          </div>
        ))}

        {/* Actions */}
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onClose}>
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            className="modal-btn confirm"
            onClick={handleCreate}
            disabled={loading || !objective.trim()}
          >
            {loading ? '...' : (isZh ? '创建项目' : 'Create Project')}
          </button>
        </div>
      </div>
    </div>
  );
}
