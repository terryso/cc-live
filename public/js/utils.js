export function esc(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

export function isDiffContent(lang, text) {
  if (lang === 'diff') return true;
  if (lang && lang !== 'plaintext') return false;
  const lines = text.split('\n');
  const hasHunk = lines.some(l => l.startsWith('@@'));
  let add = 0, del = 0;
  for (const l of lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  if (hasHunk) return (add + del) > 0;
  return add > 0 && del > 0 && (add + del) / lines.length > 0.3;
}

export function renderDiff(text) {
  const lines = text.split('\n');
  const out = lines.map(raw => {
    const e = esc(raw);
    if (raw.startsWith('@@')) return '<span class="diff-line diff-hunk">' + e + '</span>';
    if (raw.startsWith('+')) return '<span class="diff-line diff-add">' + e + '</span>';
    if (raw.startsWith('-')) return '<span class="diff-line diff-del">' + e + '</span>';
    return '<span class="diff-line">' + e + '</span>';
  });
  return '<pre class="diff-block"><code class="hljs language-diff">' + out.join('') + '</code></pre>';
}

export function detectContentType(text) {
  var t = text.trim();
  if (/^```\w*/.test(t)) return 'code';
  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return 'code';
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return 'json'; } catch(e) {}
  }
  // Detect HTML by counting tags
  var tagCount = (text.match(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s|>)/g) || []).length;
  if (tagCount > 5) return 'code';
  var lines = text.split('\n');
  // Detect grep/search output with line numbers (e.g., "67: <div ...>")
  if (lines.some(l => /^\d+[:-]\s+\S/.test(l.trim()))) return 'code';
  var indented = 0;
  for (var i = 0; i < lines.length; i++) { if (/^\s{2,}/.test(lines[i])) indented++; }
  if (lines.length > 3 && indented / lines.length > 0.4) return 'code';
  return 'text';
}
