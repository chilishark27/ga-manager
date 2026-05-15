import React, { useState } from 'react';

interface ToolCall {
  name: string;
  input: string;
  result?: string;
}

interface Props {
  content: string;
}

const TOOL_COLORS: Record<string, string> = {
  code_run: '#667eea',
  file_read: '#52c41a',
  file_patch: '#10b981',
  file_write: '#10b981',
  web_scan: '#f59e0b',
  web_execute_js: '#f59e0b',
  ask_user: '#a855f7',
  update_working_checkpoint: '#6366f1',
  start_long_term_update: '#ec4899',
};

function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  // Match patterns like: 'name': 'tool_name' ... 'input': {...}
  const toolUsePattern = /'name'\s*:\s*'([^']+)'/g;
  const inputPattern = /'input'\s*:\s*(\{[^}]*\})/g;

  let match;
  while ((match = toolUsePattern.exec(content)) !== null) {
    const name = match[1];
    const inputMatch = inputPattern.exec(content);
    calls.push({
      name,
      input: inputMatch ? inputMatch[1] : '',
    });
  }

  // Also try JSON format: "name": "tool_name"
  if (calls.length === 0) {
    const jsonPattern = /"name"\s*:\s*"([^"]+)"/g;
    while ((match = jsonPattern.exec(content)) !== null) {
      if (['code_run', 'file_read', 'file_patch', 'file_write', 'web_scan', 'web_execute_js', 'ask_user', 'update_working_checkpoint', 'start_long_term_update'].includes(match[1])) {
        calls.push({ name: match[1], input: '' });
      }
    }
  }

  return calls;
}

export default function ToolTimeline({ content }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const calls = parseToolCalls(content);

  if (calls.length === 0) return null;

  const toggle = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="tool-timeline">
      {calls.map((call, i) => (
        <div key={i} className="tool-call-item" onClick={() => toggle(i)}>
          <div className="tool-call-header">
            <span className="tool-call-dot" style={{ background: TOOL_COLORS[call.name] || '#667eea' }} />
            <span className="tool-call-name">{call.name}</span>
            <span className="tool-call-chevron">{expanded.has(i) ? '▾' : '▸'}</span>
          </div>
          {expanded.has(i) && call.input && (
            <pre className="tool-call-detail">{call.input}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
