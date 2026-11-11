// Cloudflare Worker: serves the built site from ./dist and provides the blog admin API.
//
// The admin API commits Markdown files (and images) to GitHub; the commit triggers a
// Cloudflare rebuild, so a published post goes live a couple of minutes later.
//
// Secrets (set in the Cloudflare dashboard or with `npx wrangler secret put`):
//   ADMIN_PASSWORD  password for /admin
//   GITHUB_TOKEN    fine-grained token with "Contents: read and write" on the repo
// Vars (wrangler.jsonc): GITHUB_REPO, GITHUB_BRANCH, optional GITHUB_API_URL

import { createGitHub, GitHubError } from './github'
import { parsePost, SLUG_RE, toMarkdown, validatePost, type PostFields } from '../src/lib/post-format'
import { describeWorkChange, normalizeWorkList, serializeWorkList, type WorkPost } from '../src/lib/work-format'

export interface Env {
  ASSETS: Fetcher
  ADMIN_PASSWORD?: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_BRANCH?: string
  GITHUB_API_URL?: string
  ADMIN_RATE_LIMITER?: RateLimit
}

const BLOG_DIR = 'src/content/blog'
const WORK_FILE = 'src/data/work.json'
const IMAGE_DIRS = { blog: 'public/images/blog', work: 'public/images/work' } as const
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// SVG is excluded on purpose: it can carry scripts.
const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

async function sha256(text: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}

async function checkAuth(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new HttpError(503, 'Publishing is not set up yet: ADMIN_PASSWORD, GITHUB_TOKEN and GITHUB_REPO must be configured.')
  }
  if (env.ADMIN_RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.ADMIN_RATE_LIMITER.limit({ key: ip })
    if (!success) throw new HttpError(429, 'Too many requests. Wait a minute and try again.')
  }
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Compare fixed-length hashes in constant time so the check doesn't leak the password.
  const [a, b] = await Promise.all([sha256(given), sha256(env.ADMIN_PASSWORD)])
  if (!given || !crypto.subtle.timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong password.')
}

function github(env: Env) {
  return createGitHub({
    token: env.GITHUB_TOKEN!,
    repo: env.GITHUB_REPO!,
    branch: env.GITHUB_BRANCH || 'master',
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
  })
}

function postPath(slug: string) {
  if (!SLUG_RE.test(slug) || slug.length > 80) throw new HttpError(400, 'Invalid post URL slug.')
  return `${BLOG_DIR}/${slug}.md`
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body.')
  }
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  await checkAuth(request, env)
  const gh = github(env)
  const method = request.method

  // GET /api/admin/session — used by the login form to check the password.
  if (path === 'session' && method === 'GET') return json({ ok: true })

  // GET /api/admin/posts — every post in the repo, drafts included, newest first.
  if (path === 'posts' && method === 'GET') {
    const entries = (await gh.list(BLOG_DIR)).filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    const posts = await Promise.all(
      entries.map(async (e) => {
        const file = await gh.read(e.path)
        const { body: _body, ...meta } = parsePost(e.name.replace(/\.md$/, ''), file?.content ?? '')
        return { ...meta, sha: file?.sha ?? e.sha }
      }),
    )
    posts.sort((a, b) => b.date.localeCompare(a.date))
    return json({ posts })
  }

  const postMatch = path.match(/^posts\/([^/]+)$/)
  if (postMatch) {
    const slug = decodeURIComponent(postMatch[1])
    const file = postPath(slug)

    // GET /api/admin/posts/:slug
    if (method === 'GET') {
      const found = await gh.read(file)
      if (!found) throw new HttpError(404, 'Post not found.')
      return json({ post: { ...parsePost(slug, found.content), sha: found.sha } })
    }

    // PUT /api/admin/posts/:slug — create (no sha) or update (sha of the version being edited).
    if (method === 'PUT') {
      const input = await readBody<Partial<PostFields> & { sha?: string }>(request)
      const invalid = validatePost(input)
      if (invalid) throw new HttpError(400, invalid)
      const markdown = toMarkdown({
        title: input.title!,
        date: input.date,
        summary: input.summary,
        cover: input.cover,
        draft: Boolean(input.draft),
        body: input.body,
      })
      const verb = input.sha ? 'Update' : 'Publish'
      try {
        const { sha } = await gh.write(file, markdown, `${verb} blog post: ${input.title!.trim()}`, input.sha)
        return json({ slug, sha }, input.sha ? 200 : 201)
      } catch (e) {
        // GitHub answers 422 when creating a file that exists, 409 when the sha is stale.
        if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) {
          throw new HttpError(
            409,
            input.sha
              ? 'This post was changed somewhere else since you opened it. Reload it and make your edits again.'
              : `A post with the URL "/blog/${slug}" already exists. Choose another URL slug.`,
          )
        }
        throw e
      }
    }

    // DELETE /api/admin/posts/:slug?sha=...
    if (method === 'DELETE') {
      const sha = new URL(request.url).searchParams.get('sha')
      if (!sha) throw new HttpError(400, 'Missing sha.')
      try {
        await gh.remove(file, `Delete blog post: ${slug}`, sha)
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          throw new HttpError(409, 'This post was changed somewhere else. Reload and try again.')
        }
        throw e
      }
      return json({ ok: true })
    }
  }

  // GET /api/admin/work — all case studies (hidden ones included), in home-page order.
  if (path === 'work' && method === 'GET') {
    const file = await gh.read(WORK_FILE)
    if (!file) throw new HttpError(404, `${WORK_FILE} not found in the repository.`)
    return json({ posts: JSON.parse(file.content) as WorkPost[], sha: file.sha })
  }

  // PUT /api/admin/work — replaces the whole list ({ posts, sha }). The sha guards against
  // overwriting changes saved elsewhere since the list was loaded.
  if (path === 'work' && method === 'PUT') {
    const input = await readBody<{ posts?: unknown; sha?: string }>(request)
    if (!input.sha) throw new HttpError(400, 'Missing sha.')
    let posts: WorkPost[]
    try {
      posts = normalizeWorkList(input.posts)
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e))
    }
    const current = await gh.read(WORK_FILE)
    if (!current) throw new HttpError(404, `${WORK_FILE} not found in the repository.`)
    if (current.sha !== input.sha) {
      throw new HttpError(409, 'The case studies were changed somewhere else since you loaded them. Reload and make your edits again.')
    }
    const content = serializeWorkList(posts)
    // Nothing changed: don't commit, which would trigger a rebuild for nothing.
    if (content === current.content) return json({ posts, sha: current.sha, unchanged: true })
    const message = describeWorkChange(JSON.parse(current.content) as WorkPost[], posts)
    try {
      const { sha } = await gh.write(WORK_FILE, content, message, input.sha)
      return json({ posts, sha })
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
        throw new HttpError(409, 'The case studies were changed somewhere else since you loaded them. Reload and make your edits again.')
      }
      throw e
    }
  }

  // POST /api/admin/images — multipart form with a "file" field and optional "folder" (blog|work).
  // Returns the image's public URL.
  if (path === 'images' && method === 'POST') {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new HttpError(400, 'Expected a file upload.')
    }
    const upload = form.get('file')
    if (!upload || typeof upload === 'string') throw new HttpError(400, 'Expected a file upload.')
    const ext = IMAGE_TYPES[upload.type]
    if (!ext) throw new HttpError(400, 'Images must be PNG, JPEG, GIF, WebP or AVIF.')
    if (upload.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Images must be 5 MB or smaller.')
    const base = (upload.name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image').slice(0, 60)
    const folder = form.get('folder') === 'work' ? 'work' : 'blog'
    const name = `${base}-${Date.now().toString(36)}.${ext}`
    await gh.write(`${IMAGE_DIRS[folder]}/${name}`, new Uint8Array(await upload.arrayBuffer()), `Upload ${folder === 'work' ? 'case study' : 'blog'} image: ${name}`)
    return json({ url: `/images/${folder}/${name}` }, 201)
  }

  throw new HttpError(404, 'Not found.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/admin/')) {
      try {
        return await handleApi(request, env, pathname.slice('/api/admin/'.length))
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status)
        if (e instanceof GitHubError) {
          const hint = e.status === 401 || e.status === 403 ? ' Check that GITHUB_TOKEN is valid and can write to the repo.' : ''
          return json({ error: `GitHub error: ${e.message}.${hint}` }, 502)
        }
        console.error(e)
        return json({ error: 'Unexpected server error.' }, 500)
      }
    }
    if (pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
