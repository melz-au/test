import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Nav from '../components/Nav'
import PostForm from '../components/PostForm'
import useBodyClass from '../components/useBodyClass'
import useSignOutOn401 from '../components/useSignOutOn401'
import { adminApi, getPassword, setPassword, type AdminPost, type AdminPostSummary } from '../lib/admin-api'
import { formatDate } from '../lib/blog'

const NOTICE_KEY = 'flytype-admin-notice'
const LIVE_NOTE = 'Published posts go live after the site rebuilds, usually within 2 minutes.'

/** Asks for the admin password once per browser session, then renders the admin page. */
export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  useBodyClass('body-7')
  const onWork = useLocation().pathname.startsWith('/admin/work')
  const [authed, setAuthed] = useState<boolean | null>(getPassword() ? null : false)
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    document.title = `${title} · Flytype admin`
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [title])

  useEffect(() => {
    if (authed !== null) return
    adminApi
      .checkPassword(getPassword())
      .then(() => setAuthed(true))
      .catch(() => {
        setPassword(null)
        setAuthed(false)
      })
  }, [authed])

  async function login(e: FormEvent) {
    e.preventDefault()
    setChecking(true)
    setError('')
    try {
      await adminApi.checkPassword(pw)
      setPassword(pw)
      setAuthed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <Nav />
      <div className="blog-wrap">
        {authed === null && <p className="blog-muted">Checking…</p>}
        {authed === false && (
          <>
            <h1 className="blog-title">Blog admin</h1>
            <form className="blog-editor admin-login" onSubmit={login}>
              <label>
                Password
                <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
              </label>
              {error && <div className="blog-error" role="alert">{error}</div>}
              <button type="submit" className="blog-button" disabled={checking}>
                {checking ? 'Checking…' : 'Sign in'}
              </button>
            </form>
          </>
        )}
        {authed && (
          <>
            <nav className="admin-tabs" aria-label="Admin sections">
              <Link to="/admin" className={onWork ? '' : 'is-active'}>
                Blog posts
              </Link>
              <Link to="/admin/work" className={onWork ? 'is-active' : ''}>
                Case studies
              </Link>
            </nav>
            {children}
          </>
        )}
      </div>
    </>
  )
}

export function SignOut() {
  return (
    <button
      type="button"
      className="blog-button-secondary"
      onClick={() => {
        setPassword(null)
        window.location.reload()
      }}
    >
      Sign out
    </button>
  )
}

function PostList() {
  const [posts, setPosts] = useState<AdminPostSummary[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [deleting, setDeleting] = useState('')
  // A message left by the editor after saving ("Published ..."), shown once.
  const [notice, setNotice] = useState(() => sessionStorage.getItem(NOTICE_KEY) ?? '')
  useSignOutOn401(error)

  useEffect(() => {
    sessionStorage.removeItem(NOTICE_KEY)
    adminApi.listPosts().then(setPosts, setError)
  }, [])

  async function remove(p: AdminPostSummary) {
    if (!confirm(`Delete "${p.title}"? It will be removed from the live site after the next rebuild.`)) return
    setDeleting(p.slug)
    try {
      await adminApi.deletePost(p.slug, p.sha)
      setPosts((list) => list?.filter((x) => x.slug !== p.slug) ?? null)
      setNotice(`Deleted "${p.title}". The live site updates after it rebuilds, usually within 2 minutes.`)
    } catch (e) {
      setError(e)
    } finally {
      setDeleting('')
    }
  }

  return (
    <>
      <div className="blog-header">
        <h1 className="blog-title">Blog admin</h1>
        <div className="admin-actions">
          <Link to="/admin/new" className="blog-button">
            + New post
          </Link>
          <SignOut />
        </div>
      </div>
      {notice && <div className="admin-notice" role="status">{notice}</div>}
      {error != null && <div className="blog-error" role="alert">{error instanceof Error ? error.message : String(error)}</div>}
      {posts === null && error == null && <p className="blog-muted">Loading posts…</p>}
      {posts?.length === 0 && <p className="blog-muted">No posts yet.</p>}
      {posts && posts.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Post</th>
              <th>Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.slug}>
                <td>
                  <Link to={`/admin/edit/${p.slug}`} className="blog-link admin-post-title">
                    {p.title}
                  </Link>
                  {p.draft && <span className="blog-draft">Draft</span>}
                  <div className="blog-muted">/blog/{p.slug}</div>
                </td>
                <td className="admin-date">{formatDate(p.date)}</td>
                <td className="admin-row-actions">
                  {!p.draft && (
                    <a href={`/blog/${p.slug}`} className="blog-link" target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                  <Link to={`/admin/edit/${p.slug}`} className="blog-link">
                    Edit
                  </Link>
                  <button type="button" className="admin-delete" disabled={deleting === p.slug} onClick={() => remove(p)}>
                    {deleting === p.slug ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="blog-muted admin-footnote">
        Posts are saved to GitHub (<code>src/content/blog</code>). {LIVE_NOTE} Posts published in the last couple of
        minutes may not be on the live blog yet.
      </p>
    </>
  )
}

function AdminEditor({ post }: { post?: AdminPost }) {
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  useSignOutOn401(error)

  return (
    <>
      <Link to="/admin" className="blog-link blog-back">
        ← All posts
      </Link>
      <h1 className="blog-title">{post ? 'Edit post' : 'New post'}</h1>
      <PostForm
        initial={post}
        slugLocked={!!post}
        submitLabel={post ? 'Save changes' : 'Publish'}
        note={() => LIVE_NOTE}
        onUploadImage={async (file) => {
          try {
            return await adminApi.uploadImage(file)
          } catch (e) {
            setError(e)
            throw e
          }
        }}
        onSubmit={async (slug, fields) => {
          try {
            await adminApi.savePost(slug, fields, post?.sha)
          } catch (e) {
            setError(e)
            throw e
          }
          const what = fields.draft ? 'Saved draft' : post ? 'Saved changes to' : 'Published'
          sessionStorage.setItem(NOTICE_KEY, `${what} "${fields.title}". ${fields.draft ? '' : LIVE_NOTE}`)
          navigate('/admin')
        }}
      />
    </>
  )
}

function EditPostLoader() {
  const { slug = '' } = useParams()
  const [post, setPost] = useState<AdminPost | null>(null)
  const [error, setError] = useState<unknown>(null)
  useSignOutOn401(error)

  useEffect(() => {
    adminApi.getPost(slug).then(setPost, setError)
  }, [slug])

  if (error != null) {
    return (
      <>
        <Link to="/admin" className="blog-link blog-back">
          ← All posts
        </Link>
        <div className="blog-error" role="alert">{error instanceof Error ? error.message : String(error)}</div>
      </>
    )
  }
  if (!post) return <p className="blog-muted">Loading…</p>
  return <AdminEditor key={post.sha} post={post} />
}

export function AdminHome() {
  return (
    <AdminShell title="Posts">
      <PostList />
    </AdminShell>
  )
}

export function AdminNewPost() {
  return (
    <AdminShell title="New post">
      <AdminEditor />
    </AdminShell>
  )
}

export function AdminEditPost() {
  return (
    <AdminShell title="Edit post">
      <EditPostLoader />
    </AdminShell>
  )
}
