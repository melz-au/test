import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'about' },
  { to: '/blog', label: 'BLOG' },
]

function Links({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `navigation-item w-nav-link${isActive ? ' w--current' : ''}`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </>
  )
}

export default function Nav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setOpen(false)
  }

  return (
    <div data-collapse="medium" role="banner" className="navigation w-nav">
      <div className="navigation-items">
        <div className="navigation-wrap">
          <nav role="navigation" className="navigation-items w-nav-menu">
            <Links />
          </nav>
          <button
            type="button"
            aria-label="menu"
            aria-expanded={open}
            className={`menu-button w-nav-button nav-toggle${open ? ' w--open' : ''}`}
            onClick={() => setOpen((o) => !o)}
          >
            <img src="/images/flytype.png" alt="" className="menu-icon" />
          </button>
        </div>
      </div>
      {open && (
        <div className="w-nav-overlay" style={{ display: 'block' }}>
          <nav role="navigation" className="navigation-items w-nav-menu" data-nav-menu-open="">
            <Links onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </div>
  )
}
