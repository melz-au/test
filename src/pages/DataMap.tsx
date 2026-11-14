import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'
import { lines, linesAt, roundedPath, routePoints, stationById, stations, type Line, type Station } from '../lib/datamap'
import { membranePath, organelles, organs, placements, regions, smoothPath } from '../lib/organism'

const VIEW_W = 1220
const VIEW_H = 700

/** Two views of the same platform: a metro map, and a living organism. */
export type DataMapVariant = 'metro' | 'organism'

const metroPaths = new Map(lines.map((l) => [l.id, roundedPath(routePoints(l))]))
// In the organism, each line is a smooth vessel through its stations.
const organismPaths = new Map(
  lines.map((l) => [l.id, smoothPath(l.stops.map((id) => [placements[id].x, placements[id].y] as [number, number]))]),
)
// The membrane breathes between these shapes (same point count, so SVG can morph between them).
const MEMBRANE = [0, 1.6, 3.2, 1.6, 0].map((phase) => membranePath(phase)).join(';')
const MEMBRANE_INNER = [0.8, 2.4, 4, 2.4, 0.8].map((phase) => membranePath(phase, 8)).join(';')

// Label placement around a station marker.
const LABEL: Record<Station['label'], { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  n: { dx: 0, dy: -18, anchor: 'middle' },
  s: { dx: 0, dy: 28, anchor: 'middle' },
  e: { dx: 16, dy: 5, anchor: 'start' },
  w: { dx: -16, dy: 5, anchor: 'end' },
  ne: { dx: 12, dy: -14, anchor: 'start' },
  nw: { dx: -12, dy: -14, anchor: 'end' },
  se: { dx: 12, dy: 24, anchor: 'start' },
  sw: { dx: -12, dy: 24, anchor: 'end' },
}

type Tip = { x: number; y: number; flip: boolean; content: ReactNode }

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function LineDot({ line }: { line: Line }) {
  return <span className="datamap-swatch" style={{ background: line.color }} aria-hidden="true" />
}

function StationTip({ station }: { station: Station }) {
  const served = linesAt(station.id)
  return (
    <>
      <div className="datamap-tip-title">{station.name}</div>
      <div className="datamap-tip-body">{station.description}</div>
      <ul className="datamap-tip-lines">
        {served.map((l) => (
          <li key={l.id}>
            <LineDot line={l} />
            {l.name}
          </li>
        ))}
      </ul>
      {served.length > 1 && <div className="datamap-tip-meta">Interchange · {served.length} lines</div>}
    </>
  )
}

function LineTip({ line, organism }: { line: Line; organism?: boolean }) {
  const first = stationById.get(line.stops[0])!
  const last = stationById.get(line.stops[line.stops.length - 1])!
  return (
    <>
      <div className="datamap-tip-title">
        <LineDot line={line} />
        {line.name}
      </div>
      {organism && (
        <div className="datamap-tip-organ">
          {organs[line.id].organ}: {organs[line.id].role.toLowerCase()}.
        </div>
      )}
      <div className="datamap-tip-body">{line.carries}.</div>
      <div className="datamap-tip-meta">
        {first.name} → {last.name} · {line.stops.length} stations · {line.throughput}
      </div>
    </>
  )
}

export default function DataMap({ variant = 'metro' }: { variant?: DataMapVariant }) {
  const organism = variant === 'organism'
  const paths = organism ? organismPaths : metroPaths
  useBodyClass('body-5')
  const [paused, setPaused] = useState(prefersReducedMotion)
  const [view, setView] = useState<'map' | 'table'>('map')
  const [isolated, setIsolated] = useState<string | null>(null)
  const [hoverLine, setHoverLine] = useState<string | null>(null)
  const [hoverStation, setHoverStation] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRefs = useRef(new Map<string, SVGPathElement>())
  const packetRefs = useRef(new Map<string, SVGGElement[]>())

  useEffect(() => {
    document.title = organism ? 'The data organism · Flytype' : 'Data in motion · Flytype'
  }, [organism])

  // Pause the membrane's breathing (an SVG animation) along with the packets.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || view !== 'map') return
    if (paused) svg.pauseAnimations()
    else svg.unpauseAnimations()
  }, [paused, view])

  // Move the packets along their lines. Positions are written straight to the DOM each frame
  // so React doesn't re-render 60 times a second.
  useEffect(() => {
    if (view !== 'map') return
    const lengths = new Map(lines.map((l) => [l.id, pathRefs.current.get(l.id)?.getTotalLength() ?? 0]))
    let elapsed = 0
    let last = performance.now()
    let frame = 0
    const place = () => {
      for (const line of lines) {
        const path = pathRefs.current.get(line.id)
        const len = lengths.get(line.id) ?? 0
        const packets = packetRefs.current.get(line.id) ?? []
        if (!path || !len) continue
        packets.forEach((g, i) => {
          const at = (elapsed * line.speed + (i * len) / line.packets) % len
          const p = path.getPointAtLength(at)
          g.setAttribute('transform', `translate(${p.x} ${p.y})`)
        })
      }
    }
    const tick = (now: number) => {
      elapsed += Math.min(now - last, 100) / 1000
      last = now
      place()
      frame = requestAnimationFrame(tick)
    }
    place()
    if (!paused) frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paused, view, paths])

  const highlighted = hoverLine ?? isolated
  const lineState = (id: string) => (!highlighted ? '' : highlighted === id ? ' is-active' : ' is-dimmed')
  const stationDimmed = (id: string) =>
    highlighted ? !lines.find((l) => l.id === highlighted)!.stops.includes(id) : hoverStation ? hoverStation !== id : false

  // Tooltip position in the stage's coordinates (the SVG may be scaled to fit).
  function tipAt(svgX: number, svgY: number, content: ReactNode) {
    const svg = svgRef.current
    if (!svg) return
    const width = svg.getBoundingClientRect().width
    const x = svgX * (width / VIEW_W)
    setTip({ x, y: svgY * (width / VIEW_W), flip: x > width * 0.65, content })
  }
  function tipAtPointer(e: React.PointerEvent, content: ReactNode) {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTip({ x, y: e.clientY - rect.top, flip: x > rect.width * 0.65, content })
  }
  const clearHover = () => {
    setHoverLine(null)
    setHoverStation(null)
    setTip(null)
  }

  return (
    <>
      <Nav />
      <main className={`datamap${organism ? ' is-organism' : ''}`}>
        <header className="datamap-header">
          <div className="name-text datamap-kicker">Data &amp; AI strategy</div>
          {organism ? (
            <>
              <h1 className="datamap-title">The data organism</h1>
              <p className="datamap-intro">
                The same platform, seen as a living thing. Senses on the membrane take in signals, the lakehouse heart
                pumps them through every system in the body, the brain learns, the immune system defends, and the body
                acts on what it knows.
              </p>
            </>
          ) : (
            <>
              <h1 className="datamap-title">Data in motion</h1>
              <p className="datamap-intro">
                How data travels through a modern data and AI platform: from the signals it starts as, through the
                platforms that make it trustworthy, to the dashboards, models and decisions it powers. Each line is a
                journey; each interchange is where journeys meet.
              </p>
            </>
          )}
          <nav className="datamap-view-switch" aria-label="Visualisation">
            <Link to="/data-map" aria-current={organism ? undefined : 'page'}>
              Metro map
            </Link>
            <Link to="/data-map/organism" aria-current={organism ? 'page' : undefined}>
              Organism
            </Link>
          </nav>
        </header>

        <div className="datamap-controls">
          <div className="datamap-legend" role="group" aria-label="Lines (select one to isolate it)">
            {lines.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`datamap-legend-item${isolated === l.id ? ' is-selected' : ''}${isolated && isolated !== l.id ? ' is-off' : ''}`}
                aria-pressed={isolated === l.id}
                onClick={() => setIsolated((cur) => (cur === l.id ? null : l.id))}
                onPointerEnter={() => setHoverLine(l.id)}
                onPointerLeave={() => setHoverLine(null)}
              >
                <span
                  className={`datamap-legend-line${l.pattern ? ` is-${l.pattern}` : ''}`}
                  style={{ ['--swatch' as string]: l.color }}
                  aria-hidden="true"
                />
                <span className="datamap-legend-name">{organism ? organs[l.id].organ : l.name}</span>
                <span className="datamap-legend-value">{l.throughput}</span>
              </button>
            ))}
          </div>
          <div className="datamap-actions">
            {view === 'map' && (
              <button type="button" className="datamap-action" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
                {paused ? '▶ Play' : '❚❚ Pause'}
              </button>
            )}
            <button type="button" className="datamap-action" onClick={() => setView((v) => (v === 'map' ? 'table' : 'map'))}>
              {view === 'map' ? 'Table view' : 'Map view'}
            </button>
          </div>
        </div>

        {view === 'map' ? (
          <>
          <p className="datamap-swipe" aria-hidden="true">Swipe to explore the map →</p>
          <div className="datamap-scroll">
            <div className="datamap-stage" onPointerLeave={clearHover}>
              <svg
                ref={svgRef}
                className="datamap-svg"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                role="img"
                aria-labelledby="datamap-svg-title datamap-svg-desc"
              >
                <title id="datamap-svg-title">
                  {organism
                    ? 'The data organism: a data and AI platform drawn as a living organism'
                    : 'Data in motion: a metro-style map of a data and AI platform'}
                </title>
                <desc id="datamap-svg-desc">
                  {lines.length} lines and {stations.length} stations. Use the table view for the same information as a list.
                </desc>
                <defs>
                  <pattern id="datamap-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" className="datamap-gridline" />
                  </pattern>
                  <radialGradient id="datamap-vignette" cx="50%" cy="45%" r="70%">
                    <stop offset="0%" stopColor="#1b1450" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#0a061a" stopOpacity="0" />
                  </radialGradient>
                  <filter id="datamap-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="6" />
                  </filter>
                  <radialGradient id="organism-body" cx="50%" cy="50%" r="55%">
                    <stop offset="0%" stopColor="#2a1d6e" stopOpacity="0.55" />
                    <stop offset="70%" stopColor="#160f40" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#0a061a" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="organism-heart" cx="50%" cy="45%" r="55%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="55%" stopColor="#e4dcff" />
                    <stop offset="100%" stopColor="#9c8cff" />
                  </radialGradient>
                  <filter id="datamap-packet-glow" x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {organism ? (
                  <g aria-hidden="true">
                    {/* The body: a glowing membrane that slowly breathes */}
                    <path className="organism-body" fill="url(#organism-body)">
                      <animate attributeName="d" values={MEMBRANE} dur="9s" repeatCount="indefinite" />
                    </path>
                    <path className="organism-membrane-glow" filter="url(#datamap-glow)">
                      <animate attributeName="d" values={MEMBRANE} dur="9s" repeatCount="indefinite" />
                    </path>
                    <path className="organism-membrane">
                      <animate attributeName="d" values={MEMBRANE} dur="9s" repeatCount="indefinite" />
                    </path>
                    <path className="organism-membrane-inner">
                      <animate attributeName="d" values={MEMBRANE_INNER} dur="9s" repeatCount="indefinite" />
                    </path>
                    {organelles.map((o, i) => (
                      <circle key={i} cx={o.x} cy={o.y} r={o.r} className="organism-organelle" style={{ animationDelay: `${o.delay}s` }} />
                    ))}
                    {regions.map((r) => (
                      <text key={r.text} x={r.x} y={r.y} textAnchor="middle" className="organism-region">
                        {r.text}
                      </text>
                    ))}
                  </g>
                ) : (
                  <rect width={VIEW_W} height={VIEW_H} fill="url(#datamap-grid)" />
                )}
                <rect width={VIEW_W} height={VIEW_H} fill="url(#datamap-vignette)" />

                {/* Soft glow under each line */}
                <g filter="url(#datamap-glow)" aria-hidden="true">
                  {lines.map((l) => (
                    <path
                      key={l.id}
                      d={paths.get(l.id)}
                      className={`datamap-line-glow${l.pattern === 'dashed' ? ' is-dashed' : ''}${lineState(l.id)}`}
                      style={{ stroke: l.color }}
                    />
                  ))}
                </g>

                {/* The lines */}
                {lines.map((l) => (
                  <path
                    key={l.id}
                    ref={(el) => {
                      if (el) pathRefs.current.set(l.id, el)
                    }}
                    d={paths.get(l.id)}
                    className={`datamap-line${l.pattern ? ` is-${l.pattern}` : ''}${lineState(l.id)}`}
                    style={{ stroke: l.color }}
                  />
                ))}

                {/* Centre stripe for double lines */}
                {lines
                  .filter((l) => l.pattern === 'double')
                  .map((l) => (
                    <path key={l.id} d={paths.get(l.id)} className={`datamap-line-stripe${lineState(l.id)}`} aria-hidden="true" />
                  ))}

                {/* Data packets */}
                <g filter="url(#datamap-packet-glow)" aria-hidden="true">
                  {lines.map((l) => (
                    <g key={l.id} className={`datamap-packets${lineState(l.id)}`}>
                      {Array.from({ length: l.packets }, (_, i) => (
                        <g
                          key={i}
                          ref={(el) => {
                            const list = packetRefs.current.get(l.id) ?? []
                            if (el) list[i] = el
                            packetRefs.current.set(l.id, list)
                          }}
                        >
                          <circle r="6" className="datamap-packet-halo" style={{ fill: l.color }} />
                          <circle r="2.6" className="datamap-packet-core" />
                        </g>
                      ))}
                    </g>
                  ))}
                </g>

                {/* Wide invisible strokes make the lines easy to hover */}
                {lines.map((l) => (
                  <path
                    key={l.id}
                    d={paths.get(l.id)}
                    className="datamap-line-hit"
                    onPointerMove={(e) => {
                      setHoverLine(l.id)
                      setHoverStation(null)
                      tipAtPointer(e, <LineTip line={l} organism={organism} />)
                    }}
                    onPointerLeave={clearHover}
                  />
                ))}

                {/* Stations */}
                {stations.map((s) => {
                  const served = linesAt(s.id)
                  const interchange = served.length > 1
                  const place = organism ? placements[s.id] : s
                  const pos = LABEL[place.label]
                  // On the metro map a long interchange (the Lakehouse) is a capsule spanning x..x2.
                  // In the organism, the Lakehouse is the heart.
                  const heart = organism && s.id === 'lakehouse'
                  const half = !organism && s.x2 !== undefined ? (s.x2 - s.x) / 2 : 0
                  const cx = place.x + half
                  const cy = place.y
                  return (
                    <g
                      key={s.id}
                      className={`datamap-station${interchange ? ' is-interchange' : ''}${half ? ' is-capsule' : ''}${heart ? ' is-heart' : ''}${stationDimmed(s.id) ? ' is-dimmed' : ''}${hoverStation === s.id ? ' is-hover' : ''}`}
                      transform={`translate(${cx} ${cy})`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${s.name}. ${s.description} Lines: ${served.map((l) => l.name).join(', ')}.`}
                      onPointerEnter={() => {
                        setHoverStation(s.id)
                        setHoverLine(null)
                        tipAt(cx, cy, <StationTip station={s} />)
                      }}
                      onPointerLeave={clearHover}
                      onFocus={() => {
                        setHoverStation(s.id)
                        tipAt(cx, cy, <StationTip station={s} />)
                      }}
                      onBlur={clearHover}
                    >
                      {heart ? (
                        <>
                          <circle r="46" className="datamap-station-hit" />
                          <circle r="40" className="organism-heart-ring" />
                          <circle r="40" className="organism-heart-ring is-second" />
                          <g className="organism-heart">
                            <circle r="30" fill="url(#organism-heart)" className="organism-heart-core" />
                          </g>
                          <text y={58} textAnchor="middle" className="organism-heart-label">
                            {s.name}
                          </text>
                        </>
                      ) : half ? (
                        <>
                          <rect x={-half - 20} y={-20} width={half * 2 + 40} height={40} rx={20} className="datamap-station-hit" />
                          <rect x={-half - 18} y={-18} width={half * 2 + 36} height={36} rx={18} className="datamap-station-pulse is-capsule" />
                          <rect x={-half - 12} y={-12} width={half * 2 + 24} height={24} rx={12} className="datamap-station-interchange" />
                          <text y={5} textAnchor="middle" className="datamap-capsule-label">
                            {s.name}
                          </text>
                        </>
                      ) : (
                        <>
                          <circle r="20" className="datamap-station-hit" />
                          {interchange ? (
                            <>
                              <circle r="13" className="datamap-station-pulse" />
                              <circle r="9" className="datamap-station-interchange" />
                            </>
                          ) : (
                            <>
                              <circle r="6" className="datamap-station-stop" style={{ stroke: served[0]?.color }} />
                              {organism && <circle r="2" className="organism-nucleus" style={{ fill: served[0]?.color }} />}
                            </>
                          )}
                          <text x={pos.dx} y={pos.dy} textAnchor={pos.anchor} className="datamap-label">
                            {s.name}
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}
              </svg>

              {tip && (
                <div
                  className="datamap-tip"
                  role="tooltip"
                  style={{ left: tip.x, top: tip.y }}
                  data-flip={tip.flip ? 'left' : 'right'}
                >
                  {tip.content}
                </div>
              )}
            </div>
          </div>
          </>
        ) : (
          <div className="datamap-table-wrap">
            <table className="datamap-table">
              <caption>Lines, what they carry, and their stations in the direction data flows</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  {organism && <th scope="col">Body system</th>}
                  <th scope="col">Carries</th>
                  <th scope="col">Throughput</th>
                  <th scope="col">Stations</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      <LineDot line={l} />
                      {l.name}
                    </th>
                    {organism && <td>{organs[l.id].organ}: {organs[l.id].role.toLowerCase()}</td>}
                    <td>{l.carries}</td>
                    <td className="datamap-num">{l.throughput}</td>
                    <td>{l.stops.map((id) => stationById.get(id)!.name).join(' → ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="datamap-table">
              <caption>Stations</caption>
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">What happens there</th>
                  <th scope="col">Lines</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th>
                    <td>{s.description}</td>
                    <td>{linesAt(s.id).map((l) => l.name).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="datamap-note">
          Illustrative: the platform, stations and throughput figures are a representative example, not live data.
        </p>
      </main>
    </>
  )
}
