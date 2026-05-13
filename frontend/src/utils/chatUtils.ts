/**
 * Chat utilities: clean_reply, fold_turns, session restore parsing
 */

// ============ 1. Clean Reply: strip internal tags ============

const TAG_PATTERNS = [
  /<thinking[\s\S]*?<\/thinking>/g,
  /<thinking[\s\S]*?<\/antml:thinking>/g,
  /<summary>[\s\S]*?<\/summary>/g,
  /<tool_use>[\s\S]*?<\/tool_use>/g,
  /<tool_result>[\s\S]*?<\/tool_result>/g,
  /<file_content>[\s\S]*?<\/file_content>/g,
  /<function_calls>[\s\S]*?<\/antml:function_calls>/g,
  /<function_results>[\s\S]*?<\/function_results>/g,
  /<working_memory>[\s\S]*?<\/working_memory>/g,
  /\[WORKING MEMORY\][\s\S]*?(?=\n\n|\Z)/g,
];

const SUMMARY_RE = /<summary>\s*([\s\S]*?)\s*<\/summary>/;

/**
 * Extract summary from raw message text (before cleaning)
 */
export function extractSummary(text: string): string {
  const match = SUMMARY_RE.exec(text);
  return match ? match[1].trim().slice(0, 200) : '';
}

/**
 * Strip internal tags from agent reply for display
 */
export function cleanReply(text: string): string {
  let cleaned = text;
  for (const pat of TAG_PATTERNS) {
    cleaned = cleaned.replace(pat, '');
  }
  // Collapse excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || '...';
}

// ============ 2. Turn Folding ============

export interface FoldedTurn {
  turnNumber: number;
  summary: string;
  content: string;
  isLast: boolean;
}

/**
 * Split a long agent message into foldable turns by detecting turn markers.
 * Returns null if the message doesn't contain turn markers (single-turn).
 */
export function foldTurns(text: string): FoldedTurn[] | null {
  const TURN_RE = /\*\*LLM Running \(Turn (\d+)\).*?\*\*/g;
  const markers: { index: number; turnNumber: number; matchEnd: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = TURN_RE.exec(text)) !== null) {
    markers.push({
      index: match.index,
      turnNumber: parseInt(match[1], 10),
      matchEnd: match.index + match[0].length,
    });
  }

  if (markers.length < 2) return null; // Not multi-turn

  const turns: FoldedTurn[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].matchEnd;
    const end = i < markers.length - 1 ? markers[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    const summary = extractSummary(content) || `Turn ${markers[i].turnNumber}`;
    turns.push({
      turnNumber: markers[i].turnNumber,
      summary,
      content: cleanReply(content),
      isLast: i === markers.length - 1,
    });
  }

  // If there's content before the first marker, prepend it
  if (markers[0].index > 0) {
    const preamble = text.slice(0, markers[0].index).trim();
    if (preamble) {
      turns.unshift({
        turnNumber: 0,
        summary: extractSummary(preamble) || 'Preamble',
        content: cleanReply(preamble),
        isLast: false,
      });
      turns.forEach((t, i) => { t.isLast = i === turns.length - 1; });
    }
  }

  return turns;
}

// ============ 3. Session Restore: parse model_responses log ============

export interface RestoredMessage {
  role: 'user' | 'agent';
  content: string;
}

/**
 * Extract user text from prompt section (may be JSON or plain text).
 * Format: "2026-05-12 16:14:34\n{...json...}" or plain text
 */
function extractUserText(raw: string): string {
  // Strip leading timestamp line
  const stripped = raw.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\r?\n/, '');
  try {
    const obj = JSON.parse(stripped);
    // OpenAI-style: {role, content: [{type:"text", text:"..."}]}
    if (obj.content && Array.isArray(obj.content)) {
      return obj.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    // Simple {role, content: "string"}
    if (typeof obj.content === 'string') return obj.content;
  } catch {
    // Not JSON, return as-is (minus timestamp)
  }
  return stripped.trim();
}

/**
 * Extract agent text from response section.
 * Format: "2026-05-12 16:14:41\n[{'type':'thinking',...},{'type':'text','text':'...'}]"
 * or plain text response
 */
function extractAgentText(raw: string): string {
  // Strip leading timestamp line
  const stripped = raw.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\r?\n/, '');

  // Try to parse Python-style list: [{'type': 'text', 'text': '...'}]
  // Convert Python single-quotes to JSON double-quotes for parsing
  const listMatch = stripped.match(/^\[(\{.*\})\]$/s);
  if (listMatch) {
    // Extract text blocks using regex (more robust than JSON parse for Python format)
    const textParts: string[] = [];
    const textRe = /'type':\s*'text',\s*'text':\s*'((?:[^'\\]|\\.)*)'/g;
    const textRe2 = /"type":\s*"text",\s*"text":\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = textRe.exec(stripped)) !== null) {
      textParts.push(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
    }
    while ((m = textRe2.exec(stripped)) !== null) {
      textParts.push(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    }
    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }
  }

  // Plain text response - apply cleanReply
  return cleanReply(stripped);
}

/**
 * Parse a model_responses log file content into chat messages.
 */
export function parseSessionLog(content: string): RestoredMessage[] {
  const messages: RestoredMessage[] = [];
  const parts = content.split(/^(=== (?:Prompt|Response) ===)/m);

  let currentRole: 'user' | 'agent' | null = null;
  let currentContent = '';

  for (const part of parts) {
    if (part === '=== Prompt ===') {
      if (currentRole && currentContent.trim()) {
        const text = currentRole === 'user'
          ? extractUserText(currentContent.trim())
          : extractAgentText(currentContent.trim());
        if (text) messages.push({ role: currentRole, content: text });
      }
      currentRole = 'user';
      currentContent = '';
    } else if (part === '=== Response ===') {
      if (currentRole && currentContent.trim()) {
        const text = currentRole === 'user'
          ? extractUserText(currentContent.trim())
          : extractAgentText(currentContent.trim());
        if (text) messages.push({ role: currentRole, content: text });
      }
      currentRole = 'agent';
      currentContent = '';
    } else {
      currentContent += part;
    }
  }
  if (currentRole && currentContent.trim()) {
    const text = currentRole === 'user'
      ? extractUserText(currentContent.trim())
      : extractAgentText(currentContent.trim());
    if (text) messages.push({ role: currentRole, content: text });
  }

  return messages;
}

export interface SessionFile {
  name: string;
  modified: string;
  size: number;
}
