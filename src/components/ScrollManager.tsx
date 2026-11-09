import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** Scrolls to the #hash target after navigation (e.g. "Back" from a case study), else to the top. */
export default function ScrollManager() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (el) {
        el.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}
