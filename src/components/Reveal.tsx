import { useEffect, useRef, useState, type ElementType, type ComponentPropsWithoutRef } from 'react'

type RevealProps<T extends ElementType> = { as?: T } & ComponentPropsWithoutRef<T>

/** Fades its element in when it scrolls into view (stands in for the Webflow scroll interactions). */
export default function Reveal<T extends ElementType = 'div'>({ as, className, ...rest }: RevealProps<T>) {
  const Tag = (as ?? 'div') as ElementType
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return <Tag ref={ref} className={`${className ?? ''} reveal${shown ? ' is-shown' : ''}`} {...rest} />
}
