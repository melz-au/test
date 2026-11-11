import type { ParsedPost, PostFields } from './post-format'
import type { WorkPost } from './work-format'

const TOKEN_KEY = 'flytype-admin-password'

export type AdminPostSummary = Omit<ParsedPost, 'body'> & { sha: string }
export type AdminPost = ParsedPost & { sha: string }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getPassword(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setPassword(pw: string | null) {
  try {
    if (pw) sessionStorage.setItem(TOKEN_KEY, pw)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: the user will be asked again */
  }
}

async function request<T>(method: string, path: string, body?: unknown, password = getPassword()): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${password}`,
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }
  const text = await res.text()
  let data: { error?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // Not JSON: usually the Vite dev server, which has no admin API.
    throw new ApiError(
      res.status,
      import.meta.env.DEV
        ? 'The admin API only runs in the Cloudflare Worker. Use `npm run preview:worker` locally, or /blog/new with `npm run dev`.'
        : `Unexpected response from the server (${res.status}).`,
    )
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`)
  return data as T
}

export const adminApi = {
  checkPassword: (password: string) => request<{ ok: true }>('GET', 'session', undefined, password),
  listPosts: () => request<{ posts: AdminPostSummary[] }>('GET', 'posts').then((r) => r.posts),
  getPost: (slug: string) => request<{ post: AdminPost }>('GET', `posts/${encodeURIComponent(slug)}`).then((r) => r.post),
  savePost: (slug: string, fields: PostFields, sha?: string) =>
    request<{ slug: string; sha: string }>('PUT', `posts/${encodeURIComponent(slug)}`, { ...fields, sha }),
  deletePost: (slug: string, sha: string) =>
    request<{ ok: true }>('DELETE', `posts/${encodeURIComponent(slug)}?sha=${encodeURIComponent(sha)}`),
  uploadImage: (file: File, folder: 'blog' | 'work' = 'blog') => {
    const form = new FormData()
    form.append('file', file)
    form.append('folder', folder)
    return request<{ url: string }>('POST', 'images', form).then((r) => r.url)
  },
  /** All case studies in home-page order, plus the file version (sha) needed to save. */
  listWork: () => request<{ posts: WorkPost[]; sha: string }>('GET', 'work'),
  /** Saves the whole list. Fails with 409 if it changed since `sha` was loaded. */
  saveWork: (posts: WorkPost[], sha: string) => request<{ posts: WorkPost[]; sha: string }>('PUT', 'work', { posts, sha }),
}
