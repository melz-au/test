import { Link, Navigate, useParams } from 'react-router-dom'
import useBodyClass from '../components/useBodyClass'
import { renderMarkdown } from '../lib/blog'
import { getWorkPost, renamedWorkSlugs } from '../lib/work'
import NotFound from './NotFound'

export default function WorkPost() {
  const { slug = '' } = useParams()
  useBodyClass('body-3')
  if (renamedWorkSlugs[slug]) return <Navigate to={`/work-posts/${renamedWorkSlugs[slug]}`} replace />
  const post = getWorkPost(slug)
  if (!post) return <NotFound />

  return (
    <>
      <section />
      <div className="work">
        <div className="button-style link">
          <div className="link w-embed">
            <Link to={`/#${post.slug}`} className="button-style" style={{ textDecoration: 'none' }}>
              {' '}
              Back
            </Link>
          </div>
        </div>
        <div className="div-block-19">
          <h1 className="heading-13">{post.title}</h1>
        </div>
        <h2 className="heading-12">{post.headline}</h2>
        <div className="w-dyn-list">
          <div role="list" className="collection-list-10 w-dyn-items">
            {post.tags.map((t) => (
              <div key={t} role="listitem" className="collection-item-12 w-dyn-item">
                <div className="text-block-7">{t}</div>
              </div>
            ))}
          </div>
        </div>

        <section className="section-8">
          <div className="w-layout-blockcontainer container-18 w-container">
            {post.heroImage && <img src={post.heroImage.src} alt={post.heroImage.alt} className="image-10" />}
            {post.heroCaption && <div className="text-block-5">{post.heroCaption}</div>}
          </div>
          <div className="rich-text-block-4 rte-dark large w-richtext" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.intro) }} />

          <div className="w-layout-blockcontainer container-13 w-container">
            <div className="div-block-16">
              <h2 className="work h2">
                <strong className="bold-text-2">My Role</strong>
              </h2>
              <div>
                <div className="collection-list-wrapper-10 w-dyn-list">
                  <div role="list" className="collection-list-11 w-dyn-items">
                    {post.roles.map((r, i) => (
                      <div key={i} role="listitem" className="w-dyn-item">
                        <div className="text-block-8">{r}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {post.roleColumns.length > 0 && (
                <div className="div-block-12">
                  {post.roleColumns.map((md, i) => (
                    <div key={i} className="div-block-13">
                      <div className="rte-dark w-richtext" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {post.midImage && (
              <div className="div-block-6">
                <div className="div-block-17">
                  <div>
                    <img src={post.midImage.src} loading="lazy" alt={post.midImage.alt} className="image-12" />
                  </div>
                </div>
              </div>
            )}

            {(post.outcomes || post.outcomesImage) && (
              <div className="div-block-16">
                <h2 className="work h2">
                  <strong className="bold-text">Outcomes</strong>
                </h2>
                <div className="rich-text-block-4 rte w-richtext" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.outcomes) }} />
                {post.outcomesImage && (
                  <img src={post.outcomesImage.src} loading="lazy" alt={post.outcomesImage.alt} className="image-12" />
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
