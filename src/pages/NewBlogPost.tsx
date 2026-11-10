import { Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import PostForm from '../components/PostForm'
import useBodyClass from '../components/useBodyClass'

/** Dev-only editor (`npm run dev`): saves a Markdown file into src/content/blog via the Vite dev server. */
export default function NewBlogPost() {
  useBodyClass('body-7')
  const navigate = useNavigate()

  return (
    <>
      <Nav />
      <div className="blog-wrap">
        <Link to="/blog" className="blog-link blog-back">
          ← All posts
        </Link>
        <h1 className="blog-title">New blog post</h1>
        <PostForm
          submitLabel="Create post"
          note={(slug) => (
            <>
              Saves <code>src/content/blog/{slug || '<slug>'}.md</code>. Commit that file to publish it, or publish
              straight from the live site at <code>/admin</code>.
            </>
          )}
          onSubmit={async (slug, fields) => {
            const res = await fetch('/__blog/posts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...fields, slug }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Could not save the post.')
            navigate(`/blog/${json.slug}`)
          }}
        />
      </div>
    </>
  )
}
