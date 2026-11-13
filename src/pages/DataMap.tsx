import { useEffect, useRef, useState, type ReactNode } from 'react'
import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'
import { lines, linesAt, roundedPath, routePoints, stationById, stations, type Line, type Station } from '../lib/datamap'

const VIEW_W = 1220
const VIEW_H = 700

const paths = new Map(lines.map((l) => [l.id, roundedPath(routePoints(l))]))

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

function LineTip({ line }: { line: Line }) {
  const first = stationById.get(line.stops[0])!
  const last = stationById.get(line.stops[line.stops.length - 1])!
  return (
    <>
      <div className="datamap-tip-title">
        <LineDot line={line} />
        {line.name}
      </div>
      <div className="datamap-tip-body">{line.carries}.</div>
      <div className="datamap-tip-meta">
        {first.name} → {last.name} · {line.stops.length} stations · {line.throughput}
      </div>
    </>
  )
}

export default function DataMap() {
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
    document.title = 'Data in motion · Flytype'
  }, [])

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
  }, [paused, view])

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
      <main className="datamap">
        <header className="datamap-header">
          <div className="name-text datamap-kicker">Data &amp; AI strategy</div>
          <h1 className="datamap-title">Data in motion</h1>
          <p className="datamap-intro">
            How data travels through a modern data and AI platform: from the signals it starts as, through the platforms
            that make it trustworthy, to the dashboards, models and decisions it powers. Each line is a journey; each
            interchange is where journeys meet.
          </p>
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
                <span className="datamap-legend-line" style={{ background: l.color }} aria-hidden="true" />
                <span className="datamap-legend-name">{l.name}</span>
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
                <title id="datamap-svg-title">Data in motion: a metro-style map of a data and AI platform</title>
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
                  <filter id="datamap-packet-glow" x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <rect width={VIEW_W} height={VIEW_H} fill="url(#datamap-grid)" />
                <rect width={VIEW_W} height={VIEW_H} fill="url(#datamap-vignette)" />

                {/* Soft glow under each line */}
                <g filter="url(#datamap-glow)" aria-hidden="true">
                  {lines.map((l) => (
                    <path key={l.id} d={paths.get(l.id)} className={`datamap-line-glow${lineState(l.id)}`} style={{ stroke: l.color }} />
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
                    className={`datamap-line${lineState(l.id)}`}
                    style={{ stroke: l.color }}
                  />
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
                      tipAtPointer(e, <LineTip line={l} />)
                    }}
                    onPointerLeave={clearHover}
                  />
                ))}

                {/* Stations */}
                {stations.map((s) => {
                  const served = linesAt(s.id)
                  const interchange = served.length > 1
                  const pos = LABEL[s.label]
                  return (
                    <g
                      key={s.id}
                      className={`datamap-station${interchange ? ' is-interchange' : ''}${stationDimmed(s.id) ? ' is-dimmed' : ''}${hoverStation === s.id ? ' is-hover' : ''}`}
                      transform={`translate(${s.x} ${s.y})`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${s.name}. ${s.description} Lines: ${served.map((l) => l.name).join(', ')}.`}
                      onPointerEnter={() => {
                        setHoverStation(s.id)
                        setHoverLine(null)
                        tipAt(s.x, s.y, <StationTip station={s} />)
                      }}
                      onPointerLeave={clearHover}
                      onFocus={() => {
                        setHoverStation(s.id)
                        tipAt(s.x, s.y, <StationTip station={s} />)
                      }}
                      onBlur={clearHover}
                    >
                      <circle r="20" className="datamap-station-hit" />
                      {interchange ? (
                        <>
                          <circle r="13" className="datamap-station-pulse" />
                          <circle r="9" className="datamap-station-interchange" />
                        </>
                      ) : (
                        <circle r="6" className="datamap-station-stop" style={{ stroke: served[0]?.color }} />
                      )}
                      <text x={pos.dx} y={pos.dy} textAnchor={pos.anchor} className="datamap-label">
                        {s.name}
                      </text>
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
