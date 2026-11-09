import { useEffect } from 'react'

/**
 * Webflow styles each page through a class on <body> (body-3, body-5, ...).
 * Every page sets its own class, so there is deliberately no cleanup: clearing it on unmount
 * would briefly expose Webflow's default (bright blue) body background.
 */
export default function useBodyClass(className: string) {
  useEffect(() => {
    document.body.className = className
  }, [className])
}
