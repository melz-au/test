// Used by the dev-server "new post" endpoint (vite.config.ts) and the `npm run new-post` CLI.
// Uses only erasable TypeScript so Node can run it directly.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { slugify, toMarkdown, validatePost, type PostFields } from '../src/lib/post-format.ts'

export const BLOG_DIR = path.resolve(import.meta.dirname, '../src/content/blog')

export type NewPost = Partial<PostFields> & { title: string; slug?: string }

/** Writes src/content/blog/<slug>.md and returns the slug. Throws if it already exists. */
export function createPost(post: NewPost): string {
  const invalid = validatePost(post)
  if (invalid) throw new PostError(400, invalid)
  const slug = slugify(post.slug || post.title)
  if (!slug) throw new PostError(400, 'Could not make a URL slug from that title.')
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
