import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

const sakuraTheme: Record<string, React.CSSProperties> = {
  'pre[class*="language-"]': { background: 'transparent', margin: 0, padding: '14px 16px', overflow: 'auto', fontSize: '12px', lineHeight: '1.6' },
  'code[class*="language-"]': { background: 'transparent', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '12px' },
  comment: { color: '#c4a0b0' },
  prolog: { color: '#c4a0b0' },
  doctype: { color: '#c4a0b0' },
  cdata: { color: '#c4a0b0' },
  punctuation: { color: '#8c5a6e' },
  property: { color: '#e87da0' },
  tag: { color: '#e87da0' },
  boolean: { color: '#a78bfa' },
  number: { color: '#a78bfa' },
  constant: { color: '#a78bfa' },
  symbol: { color: '#a78bfa' },
  selector: { color: '#34d399' },
  'attr-name': { color: '#fbbf24' },
  string: { color: '#34d399' },
  char: { color: '#34d399' },
  builtin: { color: '#34d399' },
  operator: { color: '#f0a0ba' },
  entity: { color: '#f0a0ba' },
  url: { color: '#f0a0ba' },
  'attr-value': { color: '#34d399' },
  keyword: { color: '#e87da0' },
  function: { color: '#a78bfa' },
  'class-name': { color: '#fbbf24' },
  regex: { color: '#fbbf24' },
  important: { color: '#fb7185' },
  variable: { color: '#f0a0ba' },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: 'bold' },
};

function DiffBlock({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <div className="code-diff-block">
      {lines.map((line, i) => {
        let cls = 'diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
        else if (line.startsWith('@@')) cls += ' diff-hunk';
        return <div key={i} className={cls}>{line}</div>;
      })}
    </div>
  );
}

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

export default function CodeBlock({ className, children }: CodeBlockProps) {
  const code = String(children).replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';

  if (lang === 'diff') {
    return <DiffBlock code={code} />;
  }

  if (!lang) {
    return <code className="inline-code">{code}</code>;
  }

  return (
    <SyntaxHighlighter
      language={lang}
      style={sakuraTheme}
      customStyle={{ background: 'transparent', padding: '14px 16px', margin: 0, borderRadius: 0 }}
      codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '12px' } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
