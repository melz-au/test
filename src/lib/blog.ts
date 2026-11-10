import { marked } from 'marked'
import { parsePost, type ParsedPost } from './post-format'

export type BlogPost = ParsedPost

// Every Markdown file in src/content/blog is a post; its file name is the URL slug.
const files = import.meta.glob('../content/blog/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

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
