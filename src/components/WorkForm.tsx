import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { slugify } from '../lib/post-format'
import { normalizeWorkPost, type Image, type WorkPost } from '../lib/work-format'

type Props = {
  initial?: WorkPost
  /** Slugs already used by other case studies. */
  takenSlugs: string[]
  submitLabel: string
  onSubmit: (post: WorkPost) => Promise<void>
  onUploadImage: (file: File) => Promise<string>
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif'
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label>
      <span>
        {label} {hint && <span className="blog-muted">({hint})</span>}
      </span>
      {children}
    </label>
  )
}

type ImageState = { src: string; alt: string }

function ImageField({
  label,
  hint,
  value,
  onChange,
  onUpload,
  previews,
}: {
  label: string
  hint?: string
  value: ImageState
  onChange: (v: ImageState) => void
  onUpload: (file: File) => Promise<void>
  previews: Record<string, string>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  return (
    <fieldset className="admin-image-field">
      <legend>
        {label} {hint && <span className="blog-muted">({hint})</span>}
      </legend>
      <div className="blog-editor-inline">
        <input
          aria-label={`${label} URL`}
          value={value.src}
          placeholder="/images/work/picture.png"
          onChange={(e) => onChange({ ...value, src: e.target.value })}
        />
        <button type="button" className="blog-button-secondary" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        {value.src && (
          <button type="button" className="blog-button-secondary" onClick={() => onChange({ src: '', alt: '' })}>
            Remove
          </button>
        )}
      </div>
      {value.src && (
        <>
          <img src={previews[value.src] ?? value.src} alt="" className="blog-editor-cover" />
          <input
            aria-label={`${label} description`}
            value={value.alt}
            placeholder="Describe the image for screen readers (optional)"
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
          />
        </>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setUploading(true)
          try {
            await onUpload(file)
          } finally {
            setUploading(false)
          }
        }}
      />
    </fieldset>
  )
}

const toState = (img: Image | null | undefined): ImageState => ({ src: img?.src ?? '', alt: img?.alt ?? '' })
const fromState = (s: ImageState): Image | null => (s.src.trim() ? { src: s.src.trim(), alt: s.alt.trim() } : null)

export default function WorkForm({ initial, takenSlugs, submitLabel, onSubmit, onUploadImage }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState('')
  const [headline, setHeadline] = useState(initial?.headline ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [cardImage, setCardImage] = useState(toState(initial?.cardImage))
  const [mobileImage, setMobileImage] = useState(toState(initial?.mobileImage))
  const [heroImage, setHeroImage] = useState(toState(initial?.heroImage))
  const [heroCaption, setHeroCaption] = useState(initial?.heroCaption ?? '')
  const [intro, setIntro] = useState(initial?.intro ?? '')
  const [roles, setRoles] = useState((initial?.roles ?? []).join('\n'))
  const [cols, setCols] = useState<string[]>(() => [0, 1, 2].map((i) => initial?.roleColumns[i] ?? ''))
  const [midImage, setMidImage] = useState(toState(initial?.midImage))
  const [outcomes, setOutcomes] = useState(initial?.outcomes ?? '')
  const [outcomesImage, setOutcomesImage] = useState(toState(initial?.outcomesImage))
  const [draft, setDraft] = useState(initial?.draft ?? false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Uploaded images aren't on the live site until it rebuilds, so show them from memory.
  const [previews, setPreviews] = useState<Record<string, string>>({})

  const effectiveSlug = initial ? initial.slug : slugify(slug || title.replace(/\(\d{4}\)/, ''))

  const upload = (set: (v: ImageState) => void, current: ImageState) => async (file: File) => {
    setError('')
    try {
      const url = await onUploadImage(file)
      setPreviews((m) => ({ ...m, [url]: URL.createObjectURL(file) }))
      set({ src: url, alt: current.alt })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const image = (label: string, value: ImageState, set: (v: ImageState) => void, hint?: string) => (
    <ImageField label={label} hint={hint} value={value} onChange={set} onUpload={upload(set, value)} previews={previews} />
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!initial && takenSlugs.includes(effectiveSlug)) {
      setError(`A case study already uses the URL /work-posts/${effectiveSlug}. Choose another URL slug.`)
      return
    }
    let post: WorkPost
    try {
      post = normalizeWorkPost({
        slug: effectiveSlug,
        headline,
        title,
        summary,
        cardImage: fromState(cardImage),
        mobileImage: fromState(mobileImage),
        tags: tags.split(','),
        heroImage: fromState(heroImage),
        heroCaption,
        intro,
        roles: lines(roles),
        roleColumns: cols,
        midImage: fromState(midImage),
        outcomes,
        outcomesImage: fromState(outcomesImage),
        draft,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setSaving(true)
    try {
      await onSubmit(post)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form className="blog-editor work-editor" onSubmit={submit}>
      <p className="blog-muted">
        Text fields use Markdown: <code>**bold**</code>, <code>[link](https://…)</code>, a blank line between
        paragraphs, and <code>- item</code> for lists.
      </p>

      <h2 className="work-editor-section">Home page</h2>
      <div className="blog-editor-row">
        <Field label="Title" hint="project and year">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scheduling (2023)" required maxLength={200} />
        </Field>
        <Field label="URL">
          {initial ? (
            <input value={`/work-posts/${initial.slug}`} readOnly disabled />
          ) : (
            <input value={slug} placeholder={effectiveSlug || 'my-project'} onChange={(e) => setSlug(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Headline" hint="large text on the home page">
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Reducing time on task" maxLength={200} />
      </Field>
      <Field label="Summary">
        <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      {image('Home page image', cardImage, setCardImage)}
      {image('Phone image', mobileImage, setMobileImage, 'optional, shown on phones instead of the home page image')}

      <h2 className="work-editor-section">Case study page</h2>
      <Field label="Tags" hint="comma separated">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Product Design, UX / UI" />
      </Field>
      {image('Top image', heroImage, setHeroImage)}
      <Field label="Top image caption" hint="optional">
        <input value={heroCaption} onChange={(e) => setHeroCaption(e.target.value)} maxLength={500} />
      </Field>
      <Field label="Introduction">
        <textarea rows={8} value={intro} onChange={(e) => setIntro(e.target.value)} />
      </Field>
      <Field label="My role" hint="one per line">
        <textarea rows={6} value={roles} onChange={(e) => setRoles(e.target.value)} placeholder={'Design Leadership\nResearch\nPrototyping'} />
      </Field>
      <div className="work-editor-cols">
        {cols.map((c, i) => (
          <Field key={i} label={`Role column ${i + 1}`} hint="optional">
            <textarea rows={5} value={c} onChange={(e) => setCols((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
          </Field>
        ))}
      </div>
      {image('Middle image', midImage, setMidImage, 'optional')}
      <Field label="Outcomes">
        <textarea rows={6} value={outcomes} onChange={(e) => setOutcomes(e.target.value)} placeholder={'- Faster scheduling\n- Happier customers'} />
      </Field>
      {image('Outcomes image', outcomesImage, setOutcomesImage, 'optional')}

      <label className="blog-checkbox">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        Hidden (saved, but not shown on the live site)
      </label>

      {error && (
        <div className="blog-error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="blog-button" disabled={saving || !effectiveSlug}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
