// Minimal GitHub "contents" API client used to read and commit blog files.

export type GitHubConfig = {
  token: string
  /** "owner/name" */
  repo: string
  branch: string
  /** Overridable for local testing. */
  apiUrl: string
}

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type GitHubFile = { path: string; sha: string; content: string }
export type GitHubDirEntry = { name: string; path: string; sha: string; type: string }

const bytesToBase64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const base64ToText = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))

export function createGitHub(cfg: GitHubConfig) {
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
  const url = (path: string, query = '') =>
    `${cfg.apiUrl.replace(/\/$/, '')}/repos/${cfg.repo}/contents/${encodePath(path)}${query}`

  async function call(method: string, path: string, body?: unknown, query = '') {
    const res = await fetch(url(path, query), {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'flytype-blog-admin',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.ok) return res.status === 204 ? null : res.json()
    const detail = await res.text().catch(() => '')
    let message = `GitHub returned ${res.status}`
    try {
      message = JSON.parse(detail).message || message
    } catch {
      /* not JSON */
    }
    throw new GitHubError(res.status, message)
  }

  const ref = `?ref=${encodeURIComponent(cfg.branch)}`

  return {
    async list(dir: string): Promise<GitHubDirEntry[]> {
      try {
        return (await call('GET', dir, undefined, ref)) as GitHubDirEntry[]
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return []
        throw e
      }
    },

    async read(path: string): Promise<GitHubFile | null> {
      try {
        const json = (await call('GET', path, undefined, ref)) as { sha: string; content: string }
        return { path, sha: json.sha, content: base64ToText(json.content) }
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return null
        throw e
      }
    },

    /** Creates the file when sha is omitted (fails if it exists); otherwise updates that exact version. */
    async write(path: string, content: string | Uint8Array, message: string, sha?: string) {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
      const json = (await call('PUT', path, {
        message,
        content: bytesToBase64(bytes),
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      })) as { content: { sha: string } }
      return { sha: json.content.sha }
    },

    async remove(path: string, message: string, sha: string) {
      await call('DELETE', path, { message, sha, branch: cfg.branch })
    },
  }
}
