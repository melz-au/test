import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'
import { blogPosts, formatDate } from '../lib/blog'

export default function Blog() {
  useBodyClass('body-7')

  return (
    <>
      <Nav />
      <div className="blog-wrap">
        <div className="blog-header">
          <h1 className="blog-title">Blog</h1>
          {import.meta.env.DEV && (
            <Link to="/blog/new" className="blog-button">
              + New post
            </Link>
          )}
        </div>

        {blogPosts.length === 0 ? (
          <div className="w-dyn-empty">
            <div>No items found.</div>
          </div>
        ) : (
          <div role="list" className="blog-list">
            {blogPosts.map((p) => (
              <Link key={p.slug} to={`/blog/${p.slug}`} role="listitem" className="blog-card">
                {p.cover && <img src={p.cover} alt="" className="blog-card-cover" loading="lazy" />}
                <div className="blog-card-text">
                  <div className="blog-meta">
                    {formatDate(p.date)}
                    {p.draft && <span className="blog-draft">Draft</span>}
                  </div>
                  <h2 className="blog-card-title">{p.title}</h2>
                  {p.summary && <p className="blog-card-summary">{p.summary}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
