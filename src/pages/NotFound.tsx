import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'

export default function NotFound() {
  useBodyClass('body-7')

  return (
    <>
      <Nav />
      <div className="blog-wrap">
        <h1 className="blog-title">Page not found</h1>
        <p className="blog-muted">
          <Link to="/" className="blog-link">
            Back to home
          </Link>
        </p>
      </div>
    </>
  )
}
