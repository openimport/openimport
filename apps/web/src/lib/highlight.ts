const TOKEN =
  /(\/\/[^\n]*|#[^\n]*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(import|from|export|const|let|await|async|for|of|return|function|new|type|interface|if|else|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()|(\b[A-Z][A-Za-z0-9]*\b)/gm

export type Token = string | { cls: string; text: string }

/** Small, dependency-free highlighter for TS, JSON, CSS and shell snippets. */
export function highlight(code: string, lang = 'ts'): Token[] {
  const out: Token[] = []
  let last = 0
  const shell = lang === 'bash' || lang === 'sh'
  for (const m of code.matchAll(TOKEN)) {
    const [text, comment, str, kw, num, fn, type] = m
    // `#` only starts a comment in shell snippets
    if (comment?.startsWith('#') && !shell) continue
    if (m.index > last) out.push(code.slice(last, m.index))
    const cls = comment
      ? 'text-zinc-500'
      : str
        ? 'text-emerald-300/90'
        : kw
          ? 'text-sky-300'
          : num
            ? 'text-amber-200'
            : fn
              ? 'text-zinc-50'
              : type
                ? 'text-violet-300'
                : ''
    out.push({ cls, text })
    last = m.index + text.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function highlightHtml(code: string, lang?: string): string {
  return highlight(code, lang)
    .map((t) => (typeof t === 'string' ? escapeHtml(t) : `<span class="${t.cls}">${escapeHtml(t.text)}</span>`))
    .join('')
}
