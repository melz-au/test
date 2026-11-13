// Data for the /data-map page: an illustrative "tube map" of a data & AI platform.
// Coordinates are in the SVG's viewBox (0 0 1220 700). Segments run at 0°, 45° or 90°, like a metro map.

export type Station = {
  id: string
  name: string
  description: string
  x: number
  y: number
  /** A long interchange (drawn as a capsule) runs horizontally from x to x2, like Bank–Monument. */
  x2?: number
  /** Where the label sits relative to the station. */
  label: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
}

export type Line = {
  id: string
  name: string
  /** Validated categorical slot colour (dark mode) — see site.css --line-* tokens. */
  color: string
  /** Illustrative throughput, shown in the legend and tooltips. */
  throughput: string
  /** What travels on this line. */
  carries: string
  /** Station ids in travel order; data flows from the first to the last. */
  stops: string[]
  /** Path through the map: station ids and bend points, in order. */
  route: (string | [number, number])[]
  /**
   * Drawn dashed. Secondary encoding for a line whose colour is too close to another's when
   * every line is on screen at once (the validator's all-pairs check), so it never relies on colour alone.
   */
  dashed?: boolean
  /** Packets on the line at once, and their speed in viewBox units per second. */
  packets: number
  speed: number
}

export const stations: Station[] = [
  { id: 'iot', name: 'IoT Sensors', description: 'Telemetry from devices, vehicles and equipment.', x: 90, y: 140, label: 's' },
  { id: 'app', name: 'App Events', description: 'Clicks, views and interactions from web and mobile apps.', x: 280, y: 40, label: 'e' },
  { id: 'stream', name: 'Event Stream', description: 'A real-time event bus that ingests every signal as it happens.', x: 280, y: 140, label: 'sw' },
  { id: 'streamproc', name: 'Stream Processing', description: 'Filters, enriches and aggregates events while they are in flight.', x: 380, y: 140, label: 'n' },
  { id: 'catalogue', name: 'Data Catalogue', description: 'Every dataset described, owned and discoverable in one place.', x: 460, y: 60, label: 'e' },
  {
    id: 'telemetry',
    name: 'System Telemetry',
    description:
      'Logs, metrics and traces from applications, infrastructure and AI services such as the AI Gateway and agents.',
    x: 520,
    y: 100,
    label: 'e',
  },
  {
    id: 'aiobs',
    name: 'AI Observability',
    description:
      'AI watches every system’s telemetry in the lakehouse: spotting anomalies, drift and failures, and explaining the likely root cause.',
    x: 290,
    y: 320,
    label: 's',
  },
  {
    id: 'incidents',
    name: 'Incident Response',
    description: 'Prioritised, explained alerts routed to the right team, with suggested fixes.',
    x: 110,
    y: 320,
    label: 's',
  },
  { id: 'quality', name: 'Quality Checks', description: 'Automated tests for freshness, completeness and accuracy.', x: 460, y: 500, label: 'w' },
  { id: 'crm', name: 'CRM', description: 'Customer records, contacts and interaction history.', x: 700, y: 60, label: 'e' },
  { id: 'identity', name: 'Identity Resolution', description: 'Matches records from every system into a single customer view.', x: 700, y: 200, label: 'e' },
  {
    id: 'lakehouse',
    name: 'Lakehouse',
    description:
      'One platform for every kind of data: open, low-cost lake storage with warehouse-grade tables, governance and performance, serving BI, AI and real-time workloads from the same copy.',
    x: 460,
    x2: 700,
    y: 320,
    label: 's',
  },
  { id: 'bi', name: 'Self-serve BI', description: 'Teams explore governed data and answer their own questions.', x: 900, y: 320, label: 'n' },
  { id: 'dashboards', name: 'Executive Dashboards', description: 'The few numbers leadership steers by, refreshed automatically.', x: 1130, y: 320, label: 'n' },
  { id: 'feature', name: 'Feature Store', description: 'Reusable model inputs, served the same way for training and live predictions.', x: 700, y: 460, label: 'sw' },
  { id: 'personalisation', name: 'Personalisation', description: 'Tailored content and offers for each customer, in real time.', x: 700, y: 650, label: 'e' },
  { id: 'training', name: 'Model Training', description: 'Models are trained and evaluated on curated features.', x: 860, y: 460, label: 'n' },
  { id: 'registry', name: 'Model Registry', description: 'Versioned, approved models with full lineage back to their data.', x: 980, y: 580, label: 'sw' },
  {
    id: 'gateway',
    name: 'AI Gateway',
    description:
      'The single, controlled front door to AI models: routing, guardrails, rate and cost limits, and logging for every request.',
    x: 1055,
    y: 580,
    label: 'n',
  },
  { id: 'agents', name: 'AI Agents', description: 'Assistants and automations that act on approved models.', x: 1130, y: 580, label: 'e' },
  { id: 'decision', name: 'Decision API', description: 'Scores and recommendations served to other systems in milliseconds.', x: 900, y: 380, label: 's' },
  { id: 'alerts', name: 'Real-time Alerts', description: 'Anomalies and opportunities flagged the moment they happen.', x: 1130, y: 380, label: 's' },
  { id: 'audit', name: 'Audit & Compliance', description: 'Evidence of how data and models were used, for regulators and risk teams.', x: 1130, y: 640, label: 's' },
]

export const lines: Line[] = [
  {
    id: 'ingestion',
    name: 'Ingestion line',
    color: 'var(--line-1)',
    throughput: '12.4k events/s',
    carries: 'Raw signals, landed in the lakehouse and modelled for analytics',
    stops: ['iot', 'stream', 'lakehouse', 'bi', 'dashboards'],
    route: ['iot', 'stream', [460, 320], [700, 320], 'bi', 'dashboards'],
    packets: 9,
    speed: 120,
  },
  {
    id: 'customer',
    name: 'Customer line',
    color: 'var(--line-2)',
    throughput: '1.8k records/s',
    carries: 'Customer records, joined into one view',
    stops: ['crm', 'identity', 'lakehouse', 'feature', 'personalisation'],
    route: ['crm', 'identity', [700, 320], 'feature', 'personalisation'],
    packets: 5,
    speed: 70,
  },
  {
    id: 'ai',
    name: 'AI line',
    color: 'var(--line-3)',
    throughput: '640 features/s',
    carries: 'Features and models, from data to deployed AI',
    stops: ['lakehouse', 'feature', 'training', 'registry', 'gateway', 'agents'],
    route: [[460, 320], [600, 460], 'feature', 'training', 'registry', 'gateway', 'agents'],
    packets: 6,
    speed: 85,
  },
  {
    id: 'governance',
    name: 'Governance line',
    color: 'var(--line-4)',
    throughput: '320 checks/s',
    carries: 'Ownership, quality and lineage metadata',
    stops: ['catalogue', 'lakehouse', 'quality', 'registry', 'audit'],
    route: ['catalogue', [460, 320], 'quality', [540, 580], 'registry', [1040, 640], 'audit'],
    packets: 4,
    speed: 55,
  },
  {
    id: 'realtime',
    name: 'Real-time line',
    color: 'var(--line-5)',
    throughput: '8.9k events/s',
    carries: 'Live events, streamed into the lakehouse and turned into instant decisions',
    stops: ['app', 'stream', 'streamproc', 'lakehouse', 'feature', 'decision', 'alerts'],
    route: ['app', 'stream', 'streamproc', [580, 140], [580, 340], 'feature', [780, 380], 'decision', 'alerts'],
    packets: 8,
    speed: 150,
  },
  {
    id: 'observability',
    name: 'Observability line',
    color: 'var(--line-6)',
    throughput: '2.1k signals/s',
    carries: 'Telemetry from other systems, collected in the lakehouse and analysed by AI',
    stops: ['telemetry', 'lakehouse', 'aiobs', 'incidents'],
    // Down into the lakehouse from above, then out of its west end.
    route: ['telemetry', [520, 320], 'aiobs', 'incidents'],
    dashed: true,
    packets: 5,
    speed: 90,
  },
]

export const stationById = new Map(stations.map((s) => [s.id, s]))

export const linesAt = (stationId: string) => lines.filter((l) => l.stops.includes(stationId))

export function routePoints(line: Line): [number, number][] {
  return line.route.map((p) => {
    if (typeof p !== 'string') return p
    const s = stationById.get(p)
    if (!s) throw new Error(`Unknown station ${p}`)
    return [s.x, s.y]
  })
}

/** An SVG path through the points with rounded corners at each bend, like a metro map. */
export function roundedPath(points: [number, number][], radius = 22): string {
  if (points.length < 2) return ''
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    const inLen = Math.hypot(x - px, y - py)
    const outLen = Math.hypot(nx - x, ny - y)
    // A straight-through point (a station on a straight run) needs no curve.
    const cross = (x - px) * (ny - y) - (y - py) * (nx - x)
    if (Math.abs(cross) < 1e-6) {
      d += ` L ${x} ${y}`
      continue
    }
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const ax = x - ((x - px) / inLen) * r
    const ay = y - ((y - py) / inLen) * r
    const bx = x + ((nx - x) / outLen) * r
    const by = y + ((ny - y) / outLen) * r
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`
  }
  const [lx, ly] = points[points.length - 1]
  return `${d} L ${lx} ${ly}`
}
