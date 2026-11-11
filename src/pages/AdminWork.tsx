import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import WorkForm from '../components/WorkForm'
import { adminApi } from '../lib/admin-api'
import type { WorkPost } from '../lib/work-format'
import useSignOutOn401 from '../components/useSignOutOn401'
import { AdminShell, SignOut } from './Admin'

const NOTICE_KEY = 'flytype-admin-work-notice'
const LIVE_NOTE = 'The live site updates after it rebuilds, usually within 2 minutes.'

type Loaded = { posts: WorkPost[]; sha: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function useWork() {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<unknown>(null)
  useSignOutOn401(error)
  useEffect(() => {
    adminApi.listWork().then(setData, setError)
  }, [])
  return { data, setData, error, setError }
}

function WorkList() {
  const { data, setData, error, setError } = useWork()
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(() => sessionStorage.getItem(NOTICE_KEY) ?? '')

  useEffect(() => {
    sessionStorage.removeItem(NOTICE_KEY)
  }, [])

  async function save(posts: WorkPost[], key: string, done: string) {
    if (!data) return
    setBusy(key)
    setError(null)
    try {
      setData(await adminApi.saveWork(posts, data.sha))
      setNotice(`${done} ${LIVE_NOTE}`)
    } catch (e) {
      setError(e)
    } finally {
      setBusy('')
    }
  }

  const move = (i: number, by: number) => {
    const posts = [...data!.posts]
    const [p] = posts.splice(i, 1)
    posts.splice(i + by, 0, p)
    save(posts, `move:${p.slug}`, `Moved "${p.title}" ${by < 0 ? 'up' : 'down'}.`)
  }
  const toggleHidden = (p: WorkPost) => {
    const posts = data!.posts.map((x) => (x.slug === p.slug ? { ...x, draft: !x.draft || undefined } : x))
    save(posts, `hide:${p.slug}`, p.draft ? `"${p.title}" is visible again.` : `Hid "${p.title}".`)
  }
  const remove = (p: WorkPost) => {
    if (!confirm(`Delete the case study "${p.title}"? Its images stay in the repository.`)) return
    save(data!.posts.filter((x) => x.slug !== p.slug), `delete:${p.slug}`, `Deleted "${p.title}".`)
  }

  return (
    <>
      <div className="blog-header">
        <h1 className="blog-title">Case studies</h1>
        <div className="admin-actions">
          <Link to="/admin/work/new" className="blog-button">
            + New case study
          </Link>
          <SignOut />
        </div>
      </div>
      {notice && (
        <div className="admin-notice" role="status">
          {notice}
        </div>
      )}
      {error != null && (
        <div className="blog-error" role="alert">
          {message(error)}
        </div>
      )}
      {!data && error == null && <p className="blog-muted">Loading case studies…</p>}
      {data && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Case study</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.posts.map((p, i) => (
              <tr key={p.slug}>
                <td className="admin-order">
                  <button type="button" aria-label={`Move ${p.title} up`} disabled={!!busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${p.title} down`}
                    disabled={!!busy || i === data.posts.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </td>
                <td>
                  <Link to={`/admin/work/edit/${p.slug}`} className="blog-link admin-post-title">
                    {p.title}
                  </Link>
                  {p.draft && <span className="blog-draft">Hidden</span>}
                  <div className="blog-muted">{p.headline}</div>
                </td>
                <td className="admin-row-actions">
                  {!p.draft && (
                    <a href={`/work-posts/${p.slug}`} className="blog-link" target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                  <Link to={`/admin/work/edit/${p.slug}`} className="blog-link">
                    Edit
                  </Link>
                  <button type="button" className="admin-link-button" disabled={!!busy} onClick={() => toggleHidden(p)}>
                    {busy === `hide:${p.slug}` ? 'Saving…' : p.draft ? 'Show' : 'Hide'}
                  </button>
                  <button type="button" className="admin-delete" disabled={!!busy} onClick={() => remove(p)}>
                    {busy === `delete:${p.slug}` ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="blog-muted admin-footnote">
        The order here is the order on the home page. Changes are saved to GitHub (<code>src/data/work.json</code>).{' '}
        {LIVE_NOTE}
      </p>
    </>
  )
}

function WorkEditor({ slug }: { slug?: string }) {
  const navigate = useNavigate()
  const { data, error, setError } = useWork()

  if (error != null) {
    return (
      <>
        <Link to="/admin/work" className="blog-link blog-back">
          ← All case studies
        </Link>
        <div className="blog-error" role="alert">
          {message(error)}
        </div>
      </>
    )
  }
  if (!data) return <p className="blog-muted">Loading…</p>
  const existing = slug ? data.posts.find((p) => p.slug === slug) : undefined
  if (slug && !existing) {
    return (
      <>
        <Link to="/admin/work" className="blog-link blog-back">
          ← All case studies
        </Link>
        <div className="blog-error">Case study not found.</div>
      </>
    )
  }

  return (
    <>
      <Link to="/admin/work" className="blog-link blog-back">
        ← All case studies
      </Link>
      <h1 className="blog-title">{existing ? 'Edit case study' : 'New case study'}</h1>
      {!existing && <p className="blog-muted">New case studies appear first on the home page. You can reorder them in the list.</p>}
      <WorkForm
        initial={existing}
        takenSlugs={data.posts.map((p) => p.slug)}
        submitLabel={existing ? 'Save changes' : 'Publish'}
        onUploadImage={async (file) => {
          try {
            return await adminApi.uploadImage(file, 'work')
          } catch (e) {
            // A wrong/expired password signs out; other errors are shown inside the form.
            if ((e as { status?: number }).status === 401) setError(e)
            throw e
          }
        }}
        onSubmit={async (post) => {
          const posts = existing ? data.posts.map((p) => (p.slug === post.slug ? post : p)) : [post, ...data.posts]
          try {
            await adminApi.saveWork(posts, data.sha)
          } catch (e) {
            if ((e as { status?: number }).status === 401) setError(e)
            throw e
          }
          const what = post.draft ? 'Saved hidden case study' : existing ? 'Saved changes to' : 'Published'
          sessionStorage.setItem(NOTICE_KEY, `${what} "${post.title}". ${post.draft ? '' : LIVE_NOTE}`)
          navigate('/admin/work')
        }}
      />
    </>
  )
}

export function AdminWorkList() {
  return (
    <AdminShell title="Case studies">
      <WorkList />
    </AdminShell>
  )
}

export function AdminWorkNew() {
  return (
    <AdminShell title="New case study">
      <WorkEditor />
    </AdminShell>
  )
}

export function AdminWorkEdit() {
  const { slug = '' } = useParams()
  return (
    <AdminShell title="Edit case study">
      <WorkEditor key={slug} slug={slug} />
    </AdminShell>
  )
}
