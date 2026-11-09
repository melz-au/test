// Shared by the dev-server "new post" endpoint (vite.config.ts) and the `npm run new-post` CLI.
// Uses only erasable TypeScript so Node can run it directly.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const BLOG_DIR = path.resolve(import.meta.dirname, '../src/content/blog')

export type NewPost = {
  title: string
  slug?: string
  date?: string
  summary?: string
  cover?: string
  draft?: boolean
  body?: string
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toMarkdown(post: NewPost): string {
  const fm: string[] = [`title: ${JSON.stringify(post.title.trim())}`, `date: ${post.date || today()}`]
  if (post.summary?.trim()) fm.push(`summary: ${JSON.stringify(post.summary.trim())}`)
  if (post.cover?.trim()) fm.push(`cover: ${JSON.stringify(post.cover.trim())}`)
  if (post.draft) fm.push('draft: true')
  const body = post.body?.trim() || 'Write your post here using **Markdown**.'
  return `---\n${fm.join('\n')}\n---\n\n${body}\n`
}

/** Writes src/content/blog/<slug>.md and returns the slug. Throws if it already exists. */
export function createPost(post: NewPost): string {
  if (!post.title?.trim()) throw new PostError(400, 'A title is required.')
  const slug = slugify(post.slug || post.title)
  if (!slug) throw new PostError(400, 'Could not make a URL slug from that title.')
  if (post.date && !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) throw new PostError(400, 'Date must be YYYY-MM-DD.')
  mkdirSync(BLOG_DIR, { recursive: true })
  const file = path.join(BLOG_DIR, `${slug}.md`)
  if (existsSync(file)) throw new PostError(409, `A post with the slug "${slug}" already exists.`)
  writeFileSync(file, toMarkdown(post))
  return slug
}

export class PostError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
