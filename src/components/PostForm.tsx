import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { renderMarkdown } from '../lib/blog'
import { slugify, today, type PostFields } from '../lib/post-format'

type Props = {
  /** Existing post when editing. */
  initial?: Partial<PostFields> & { slug?: string }
  /** The slug can't change once a post exists (it is the file name / URL). */
  slugLocked?: boolean
  submitLabel: string
  /** Shown under the title, e.g. where the file is saved. */
  note?: (slug: string) => ReactNode
  onSubmit: (slug: string, fields: PostFields) => Promise<void>
  /** When provided, image upload buttons are shown. Resolves to the image's public URL. */
  onUploadImage?: (file: File) => Promise<string>
}

export default function PostForm({ initial, slugLocked, submitLabel, note, onSubmit, onUploadImage }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [date, setDate] = useState(initial?.date || today())
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [cover, setCover] = useState(initial?.cover ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [draft, setDraft] = useState(initial?.draft ?? false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'saving' | 'uploading'>('')
  // Uploaded images aren't on the live site until it rebuilds, so preview them from memory.
  const [localImages, setLocalImages] = useState<Record<string, string>>({})
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const bodyInput = useRef<HTMLInputElement>(null)

  const effectiveSlug = slugLocked ? (initial?.slug ?? '') : slugify(slug || title)
  const withLocalImages = (html: string) =>
    Object.entries(localImages).reduce((h, [url, blob]) => h.split(`"${url}"`).join(`"${blob}"`), html)
  const previewHtml = preview ? withLocalImages(renderMarkdown(body || '_Nothing to preview yet._')) : ''

  async function upload(file: File | undefined, target: 'cover' | 'body') {
    if (!file || !onUploadImage) return
    setError('')
    setBusy('uploading')
    try {
      const url = await onUploadImage(file)
      setLocalImages((m) => ({ ...m, [url]: URL.createObjectURL(file) }))
      if (target === 'cover') {
        setCover(url)
      } else {
        const alt = file.name.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ')
        const snippet = `![${alt}](${url})`
        const el = bodyRef.current
        const at = el && !preview ? el.selectionStart : body.length
        setBody((b) => `${b.slice(0, at)}${at > 0 && !b.slice(0, at).endsWith('\n\n') ? '\n\n' : ''}${snippet}\n\n${b.slice(at)}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy('saving')
    try {
      await onSubmit(effectiveSlug, { title, date, summary, cover: cover || undefined, body, draft })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <form className="blog-editor" onSubmit={submit}>
      {note && <p className="blog-muted">{note(effectiveSlug)}</p>}
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <div className="blog-editor-row">
        <label>
          URL
          {slugLocked ? (
            <input value={`/blog/${effectiveSlug}`} readOnly disabled />
          ) : (
            <input value={slug} placeholder={slugify(title) || 'my-post'} onChange={(e) => setSlug(e.target.value)} />
          )}
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label>
        Summary <span className="blog-muted">(shown on the blog list)</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
      </label>
      <label>
        Cover image <span className="blog-muted">(optional)</span>
        <div className="blog-editor-inline">
          <input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="/images/blog/my-image.png" />
          {onUploadImage && (
            <button type="button" className="blog-button-secondary" disabled={!!busy} onClick={() => coverInput.current?.click()}>
              Upload
            </button>
          )}
        </div>
      </label>
      {cover && <img src={localImages[cover] ?? cover} alt="" className="blog-editor-cover" />}

      <div className="blog-editor-tabs">
        <button type="button" className={!preview ? 'is-active' : ''} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" className={preview ? 'is-active' : ''} onClick={() => setPreview(true)}>
          Preview
        </button>
        {onUploadImage && (
          <button type="button" className="blog-editor-tab-action" disabled={!!busy} onClick={() => bodyInput.current?.click()}>
            {busy === 'uploading' ? 'Uploading…' : '+ Insert image'}
          </button>
        )}
      </div>
      {preview ? (
        <div className="blog-body blog-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : (
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          placeholder={'Write in Markdown.\n\n## A heading\n\nSome **bold** text, a [link](https://example.com) and an image:\n\n![alt text](/images/blog/picture.png)'}
        />
      )}

      {onUploadImage && (
        <>
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden
            onChange={(e) => { upload(e.target.files?.[0], 'cover'); e.target.value = '' }} />
          <input ref={bodyInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden
            onChange={(e) => { upload(e.target.files?.[0], 'body'); e.target.value = '' }} />
        </>
      )}

      <label className="blog-checkbox">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        Draft (saved, but hidden from the live site)
      </label>

      {error && <div className="blog-error" role="alert">{error}</div>}
      <button type="submit" className="blog-button" disabled={!!busy || !effectiveSlug}>
        {busy === 'saving' ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
