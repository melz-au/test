// The case-study format (src/data/work.json), shared by the site and the Cloudflare Worker.
// No imports and only erasable TypeScript, so Vite and Wrangler can both load it.

export type Image = { src: string; alt: string }

export type WorkPost = {
  /** URL: /work-posts/<slug>. Fixed once created. */
  slug: string
  /** Large headline on the home page and the case-study subtitle, e.g. "Reducing time on task". */
  headline: string
  /** Project name and year, e.g. "Scheduling (2023)". */
  title: string
  /** Markdown, shown on the home page. */
  summary: string
  /** Home page image (desktop). */
  cardImage: Image | null
  /** Home page image on phones; falls back to cardImage. */
  mobileImage: Image | null
  tags: string[]
  /** Large image at the top of the case study. */
  heroImage: Image | null
  heroCaption: string
  /** Markdown, the case study's opening text. */
  intro: string
  /** "My Role" list. */
  roles: string[]
  /** Markdown, up to three columns under "My Role". */
  roleColumns: string[]
  midImage: Image | null
  /** Markdown, the "Outcomes" section. */
  outcomes: string
  outcomesImage: Image | null
  /** Hidden from the live site (still listed in /admin). */
  draft?: boolean
}

export const WORK_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const IMAGE_FIELDS = ['cardImage', 'mobileImage', 'heroImage', 'midImage', 'outcomesImage'] as const

const str = (v: unknown, max: number, field: string): string => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new Error(`${field} must be text.`)
  if (v.length > max) throw new Error(`${field} is too long (${max} characters max).`)
  return v.trim()
}

const image = (v: unknown, field: string): Image | null => {
  if (!v || typeof v !== 'object') return null
  const { src, alt } = v as Record<string, unknown>
  const s = str(src, 500, `${field} URL`)
  if (!s) return null
  if (!/^(\/(?!\/)|https:\/\/)/.test(s)) throw new Error(`${field} URL must start with / or https://`)
  return { src: s, alt: str(alt, 300, `${field} description`) }
}

const list = (v: unknown, maxItems: number, maxLen: number, field: string): string[] => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new Error(`${field} must be a list.`)
  if (v.length > maxItems) throw new Error(`${field} can have at most ${maxItems} items.`)
  return v.map((x, i) => str(x, maxLen, `${field} item ${i + 1}`)).filter(Boolean)
}

/** Validates and normalises one case study. Throws an Error with a readable message. */
export function normalizeWorkPost(input: unknown): WorkPost {
  if (!input || typeof input !== 'object') throw new Error('Invalid case study.')
  const p = input as Record<string, unknown>
  const slug = str(p.slug, 80, 'URL slug')
  if (!WORK_SLUG_RE.test(slug)) throw new Error(`Invalid URL slug "${slug}". Use lowercase letters, numbers and dashes.`)
  const title = str(p.title, 200, 'Title')
  if (!title) throw new Error('A title is required.')
  const post: WorkPost = {
    slug,
    headline: str(p.headline, 200, 'Headline'),
    title,
    summary: str(p.summary, 20_000, 'Summary'),
    cardImage: image(p.cardImage, 'Home page image'),
    mobileImage: image(p.mobileImage, 'Phone image'),
    tags: list(p.tags, 20, 60, 'Tags'),
    heroImage: image(p.heroImage, 'Top image'),
    heroCaption: str(p.heroCaption, 500, 'Top image caption'),
    intro: str(p.intro, 50_000, 'Introduction'),
    roles: list(p.roles, 40, 120, 'Roles'),
    roleColumns: list(p.roleColumns, 3, 20_000, 'Role columns'),
    midImage: image(p.midImage, 'Middle image'),
    outcomes: str(p.outcomes, 50_000, 'Outcomes'),
    outcomesImage: image(p.outcomesImage, 'Outcomes image'),
  }
  if (p.draft === true) post.draft = true
  return post
}

/** Validates the whole list; slugs must be unique. */
export function normalizeWorkList(input: unknown): WorkPost[] {
  if (!Array.isArray(input)) throw new Error('Expected a list of case studies.')
  if (input.length > 200) throw new Error('Too many case studies.')
  const posts = input.map((p, i) => {
    try {
      return normalizeWorkPost(p)
    } catch (e) {
      throw new Error(`Case study ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  const seen = new Set<string>()
  for (const p of posts) {
    if (seen.has(p.slug)) throw new Error(`Two case studies use the URL slug "${p.slug}".`)
    seen.add(p.slug)
  }
  return posts
}

export const serializeWorkList = (posts: WorkPost[]) => JSON.stringify(posts, null, 2) + '\n'

/** A short commit message describing what changed between two versions of the list. */
export function describeWorkChange(before: WorkPost[], after: WorkPost[]): string {
  const old = new Map(before.map((p) => [p.slug, p]))
  const now = new Map(after.map((p) => [p.slug, p]))
  const added = after.filter((p) => !old.has(p.slug)).map((p) => p.title)
  const removed = before.filter((p) => !now.has(p.slug)).map((p) => p.title)
  const hidden: string[] = []
  const shown: string[] = []
  const changed: string[] = []
  for (const p of after) {
    const prev = old.get(p.slug)
    if (!prev || JSON.stringify(prev) === JSON.stringify(p)) continue
    // Only the hidden flag changed: say "hide"/"show" rather than "update".
    if (JSON.stringify({ ...prev, draft: undefined }) === JSON.stringify({ ...p, draft: undefined })) {
      ;(p.draft ? hidden : shown).push(p.title)
    } else {
      changed.push(p.title)
    }
  }
  const sameSlugs = before.filter((p) => now.has(p.slug)).map((p) => p.slug)
  const reordered = sameSlugs.join() !== after.filter((p) => old.has(p.slug)).map((p) => p.slug).join()
  const parts: string[] = []
  if (added.length) parts.push(`add ${added.join(', ')}`)
  if (removed.length) parts.push(`remove ${removed.join(', ')}`)
  if (changed.length) parts.push(`update ${changed.join(', ')}`)
  if (hidden.length) parts.push(`hide ${hidden.join(', ')}`)
  if (shown.length) parts.push(`show ${shown.join(', ')}`)
  if (reordered) parts.push('reorder')
  const text = parts.join('; ') || 'no changes'
  return `Case studies: ${text}`.slice(0, 200)
}
