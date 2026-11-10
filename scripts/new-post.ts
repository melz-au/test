// Usage: npm run new-post -- "My post title" [--draft]
import path from 'node:path'
import { BLOG_DIR, createPost, PostError } from './blog-files.ts'

const args = process.argv.slice(2)
const draft = args.includes('--draft')
const title = args.filter((a) => a !== '--draft').join(' ').trim()

if (!title) {
  console.error('Usage: npm run new-post -- "My post title" [--draft]')
  process.exit(1)
}

try {
  const slug = createPost({ title, draft })
  console.log(`Created ${path.relative(process.cwd(), path.join(BLOG_DIR, `${slug}.md`))}`)
  console.log(`It will be served at /blog/${slug}`)
} catch (e) {
  console.error(e instanceof PostError ? e.message : e)
  process.exit(1)
}
