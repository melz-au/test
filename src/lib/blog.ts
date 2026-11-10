import { marked } from 'marked'

export type BlogPost = {
  slug: string
  title: string
  /** YYYY-MM-DD */
  date: string
  summary: string
  cover?: string
  draft: boolean
  /** Markdown body (without front matter). */
  body: string
}

// Every Markdown file in src/content/blog is a post; its file name is the URL slug.
const files = import.meta.glob('../content/blog/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

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

export function parsePost(slug: string, raw: string): BlogPost {
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

const all = Object.entries(files)
  .map(([file, raw]) => parsePost(file.split('/').pop()!.replace(/\.md$/, ''), raw))
  .sort((a, b) => b.date.localeCompare(a.date))

/** Drafts are visible while running `npm run dev`, hidden in production builds. */
export const blogPosts = import.meta.env.DEV ? all : all.filter((p) => !p.draft)

export const getBlogPost = (slug: string) => blogPosts.find((p) => p.slug === slug)

export const renderMarkdown = (md: string) => marked.parse(md, { async: false })

export function formatDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}
