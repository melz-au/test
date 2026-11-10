import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { renamedWorkSlugs } from '../lib/work'

/** Scrolls to the #hash target after navigation (e.g. "Back" from a case study), else to the top. */
export default function ScrollManager() {
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      // Old home-page anchors for renamed case studies, e.g. /#digital-diagnositcs
      if (renamedWorkSlugs[id]) {
        navigate(`${pathname}#${renamedWorkSlugs[id]}`, { replace: true })
        return
      }
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash, navigate])

  return null
}
