import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import Reveal from '../components/Reveal'
import ContactForm from '../components/ContactForm'
import useBodyClass from '../components/useBodyClass'
import { workPosts } from '../lib/work'

const logos = [
  { src: '/images/logo-accenture.png', alt: 'Accenture' },
  { src: '/images/logo-news.png', alt: 'News Corp' },
  { src: '/images/logo-sbs.png', alt: 'SBS' },
  { src: '/images/logo-yr.png', alt: 'Y&R' },
  { src: '/images/logo-ericsson.png', alt: 'Ericsson' },
]

export default function Home() {
  useBodyClass('body-5')

  return (
    <>
      <Nav />
      <Reveal as="section" className="section-13">
        <div className="cube-container">
          <div className="cube">
            <div className="face custom-bottom" />
            <div className="face custom-left" />
            <div className="face custom-right" />
            <div className="face custom-top" />
            <div className="face custom-back" />
            <div className="face custom-front" />
          </div>
        </div>
      </Reveal>

      <section className="section-16">
        <div className="sub">
          <div className="name-text">Melissa Slattery</div>
          <h1 className="heading-jumbo">
            DATA &amp; AI STRATEGY <br />
          </h1>
        </div>
        <div className="w-layout-blockcontainer container-20 w-container">
          <div className="container">
            <div className="w-layout-blockcontainer container-9 logos w-container">
              {logos.map((l) => (
                <img key={l.alt} src={l.src} loading="lazy" alt={l.alt} className="logo" />
              ))}
            </div>
          </div>
          <div className="section" />
        </div>
      </section>

      <section className="section-14">
        <div className="div-block-2">
          <div className="collection-list-wrapper-7 w-dyn-list">
            <div role="list" className="collection-list-8 w-dyn-items">
              {workPosts.map((p) => (
                <div key={p.slug} role="listitem" className="collection-item-8 w-dyn-item">
                  <section id={p.slug} />
                  <section className="section-9">
                    <div className="div-block-23">
                      <Reveal as="h1" className="heading-8">
                        {p.headline}
                      </Reveal>
                    </div>
                    <div className="div-block-4 top">
                      <div className="div-block-20">
                        <Reveal as="h2" className="heading-9">
                          {p.title}
                        </Reveal>
                        <div className="rich-text-block-6 w-richtext" dangerouslySetInnerHTML={{ __html: p.summary }} />
                        <Reveal as={Link} to={`/work-posts/${p.slug}`} className="button-3 w-button">
                          View Work
                        </Reveal>
                      </div>
                      {p.cardImage && (
                        <div className="div-block-22">
                          <img src={p.cardImage.src} loading="lazy" width={538} alt={p.cardImage.alt} className="image-16" />
                        </div>
                      )}
                      {p.mobileImage && (
                        <div className="collection-list-wrapper-8 w-dyn-list">
                          <div role="list" className="collection-list-7 w-dyn-items">
                            <Reveal role="listitem" className="collection-item-9 w-dyn-item w-dyn-repeater-item">
                              <img src={p.mobileImage.src} loading="lazy" alt={p.mobileImage.alt} className="image-11" />
                            </Reveal>
                          </div>
                        </div>
                      )}
                      <Link to={`/work-posts/${p.slug}`} className="button-4 w-button">
                        View work
                      </Link>
                    </div>
                  </section>
                </div>
              ))}
            </div>
          </div>
          <ContactForm />
        </div>
      </section>
    </>
  )
}
