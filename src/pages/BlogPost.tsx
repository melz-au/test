import { Link, useParams } from 'react-router-dom'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'
import { formatDate, getBlogPost, renderMarkdown } from '../lib/blog'
import NotFound from './NotFound'

export default function BlogPost() {
  const { slug = '' } = useParams()
  useBodyClass('body-7')
  const post = getBlogPost(slug)
  if (!post) return <NotFound />

  return (
    <>
      <Nav />
      <article className="blog-wrap blog-article">
        <Link to="/blog" className="blog-link blog-back">
          ← All posts
        </Link>
        <div className="blog-meta">
          {formatDate(post.date)}
          {post.draft && <span className="blog-draft">Draft</span>}
        </div>
        <h1 className="blog-title">{post.title}</h1>
        {post.cover && <img src={post.cover} alt="" className="blog-cover" />}
        <div className="blog-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />
      </article>
    </>
  )
}
