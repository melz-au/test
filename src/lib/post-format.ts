// The blog post file format, shared by the site, the Cloudflare Worker (worker/) and the CLI (scripts/).
// No imports and only erasable TypeScript, so Node, Vite and Wrangler can all load it directly.

export type PostFields = {
  title: string
  /** YYYY-MM-DD */
  date: string
  summary: string
  cover?: string
  draft: boolean
  /** Markdown body (without front matter). */
  body: string
}

export type ParsedPost = PostFields & { slug: string }

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

export function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Front matter values are written as JSON strings, which is also valid YAML. */
export function toMarkdown(post: Partial<PostFields> & { title: string }): string {
  const fm: string[] = [`title: ${JSON.stringify(post.title.trim())}`, `date: ${post.date || today()}`]
  if (post.summary?.trim()) fm.push(`summary: ${JSON.stringify(post.summary.trim())}`)
  if (post.cover?.trim()) fm.push(`cover: ${JSON.stringify(post.cover.trim())}`)
  if (post.draft) fm.push('draft: true')
  const body = post.body?.trim() || 'Write your post here using **Markdown**.'
  return `---\n${fm.join('\n')}\n---\n\n${body}\n`
}

function parseValue(v: string): string {
  v = v.trim()
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v)
    } catch {
      /* fall through */
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  return v
}

export function parsePost(slug: string, raw: string): ParsedPost {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i > 0) meta[line.slice(0, i).trim()] = parseValue(line.slice(i + 1))
    }
  }
  return {
    slug,
    title: meta.title || slug,
    date: meta.date || '',
    summary: meta.summary || '',
    cover: meta.cover || undefined,
    draft: meta.draft === 'true',
    body: (match ? match[2] : raw).trim(),
  }
}

/** Returns an error message, or null when the fields are valid. */
export function validatePost(p: Partial<PostFields>): string | null {
  if (typeof p.title !== 'string' || !p.title.trim()) return 'A title is required.'
  if (p.title.length > 200) return 'The title is too long (200 characters max).'
  if (p.date && !DATE_RE.test(p.date)) return 'Date must be YYYY-MM-DD.'
  if (p.summary && p.summary.length > 500) return 'The summary is too long (500 characters max).'
  if (p.cover && p.cover.length > 500) return 'The cover image URL is too long.'
  if (p.body && p.body.length > 200_000) return 'The post body is too long.'
  return null
}
