import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'
import { renderMarkdown } from '../lib/blog'

// Mirrors slugify() in scripts/blog-files.ts so the URL preview matches what the server writes.
const slugify = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dev-only editor: saves a Markdown file into src/content/blog via the Vite dev server. */
export default function NewBlogPost() {
  useBodyClass('body-7')
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [date, setDate] = useState(today)
  const [summary, setSummary] = useState('')
  const [cover, setCover] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const effectiveSlug = slugify(slug || title)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/__blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug: effectiveSlug, date, summary, cover, body, draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not save the post.')
      navigate(`/blog/${json.slug}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <>
      <Nav />
      <div className="blog-wrap">
        <Link to="/blog" className="blog-link blog-back">
          ← All posts
        </Link>
        <h1 className="blog-title">New blog post</h1>
        <p className="blog-muted">
          Saves <code>src/content/blog/{effectiveSlug || '<slug>'}.md</code>. Commit that file to publish it.
        </p>

        <form className="blog-editor" onSubmit={onSubmit}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <div className="blog-editor-row">
            <label>
              URL slug
              <input value={slug} placeholder={slugify(title)} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
          </div>
          <label>
            Summary <span className="blog-muted">(shown on the blog list)</span>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          <label>
            Cover image URL <span className="blog-muted">(optional, e.g. /images/blog/my-image.png)</span>
            <input value={cover} onChange={(e) => setCover(e.target.value)} />
          </label>

          <div className="blog-editor-tabs">
            <button type="button" className={!preview ? 'is-active' : ''} onClick={() => setPreview(false)}>
              Write
            </button>
            <button type="button" className={preview ? 'is-active' : ''} onClick={() => setPreview(true)}>
              Preview
            </button>
          </div>
          {preview ? (
            <div
              className="blog-body blog-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Nothing to preview yet._') }}
            />
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              placeholder={'Write in Markdown.\n\n## A heading\n\nSome **bold** text, a [link](https://example.com) and an image:\n\n![alt text](/images/blog/picture.png)'}
            />
          )}

          <label className="blog-checkbox">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Draft (only visible while running the dev server)
          </label>

          {error && <div className="blog-error">{error}</div>}
          <button type="submit" className="blog-button" disabled={saving || !effectiveSlug}>
            {saving ? 'Saving…' : 'Create post'}
          </button>
        </form>
      </div>
    </>
  )
}
