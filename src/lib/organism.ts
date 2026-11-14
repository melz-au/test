// Layout for /data-map/organism: the same lines and stations as the metro map (datamap.ts),
// drawn as a living organism. The Lakehouse is the heart at the centre, sources sit on the
// membrane as senses, outputs on the far side as the parts that act, and each line is a body system.
import type { Station } from './datamap'

type Pt = [number, number]
export type Placement = { x: number; y: number; label: Station['label'] }

/** The body: an ellipse the membrane wobbles around. */
export const BODY = { cx: 610, cy: 355, rx: 500, ry: 290 }

/** A point on the membrane at `deg` (0° = right, 90° = bottom), pulled `inset` px towards the centre. */
function onMembrane(deg: number, inset = 0): Pt {
  const t = (deg * Math.PI) / 180
  return [
    Math.round(BODY.cx + (BODY.rx - inset) * Math.cos(t)),
    Math.round(BODY.cy + (BODY.ry - inset) * Math.sin(t)),
  ]
}

const at = ([x, y]: Pt, label: Placement['label']): Placement => ({ x, y, label })

export const placements: Record<string, Placement> = {
  // The heart
  lakehouse: { x: BODY.cx, y: BODY.cy, label: 's' },

  // Senses: sources on the membrane, left side
  app: at(onMembrane(218), 'nw'),
  iot: at(onMembrane(192), 'w'),
  telemetry: at(onMembrane(166), 'n'),
  crm: at(onMembrane(143), 'sw'),
  catalogue: at(onMembrane(118), 's'),
  iam: at(onMembrane(250), 'n'),

  // Inside the body, left of the heart
  stream: { x: 270, y: 255, label: 'se' },
  streamproc: { x: 405, y: 275, label: 'n' },
  classify: { x: 470, y: 175, label: 'e' },
  identity: { x: 330, y: 470, label: 'n' },

  // Brain: upper right
  feature: { x: 745, y: 250, label: 'nw' },
  training: { x: 810, y: 160, label: 'n' },
  registry: { x: 915, y: 235, label: 'n' },
  gateway: { x: 990, y: 180, label: 'n' },

  // Inside the body, right of the heart
  bi: { x: 845, y: 345, label: 's' },
  decision: { x: 925, y: 435, label: 's' },
  quality: { x: 735, y: 470, label: 'sw' },

  // Immune response and self-awareness: lower middle
  threat: { x: 600, y: 520, label: 'e' },
  aiobs: { x: 470, y: 520, label: 'w' },

  // Actions: outputs on the membrane, right side and bottom
  agents: at(onMembrane(330), 'n'),
  dashboards: at(onMembrane(354), 'n'),
  alerts: at(onMembrane(10), 's'),
  audit: at(onMembrane(38), 's'),
  personalisation: at(onMembrane(64), 's'),
  soc: at(onMembrane(92), 's'),
  incidents: at(onMembrane(112), 'e'),
}

/** The body system each line plays. */
export const organs: Record<string, { organ: string; role: string }> = {
  ingestion: { organ: 'Digestion', role: 'Breaks raw signals down into nutrients the whole body can use' },
  customer: { organ: 'Memory', role: 'Remembers who each customer is' },
  ai: { organ: 'Brain', role: 'Learns, predicts and decides' },
  governance: { organ: 'Endocrine system', role: 'Regulates the whole body with rules and quality signals' },
  realtime: { organ: 'Nervous system', role: 'Carries fast reflexes from senses to action' },
  observability: { organ: 'Self-awareness', role: 'Senses how the body itself is doing' },
  security: { organ: 'Immune system', role: 'Recognises intruders and fights threats' },
}

/** Faint labels for the regions of the body. */
export const regions: { text: string; x: number; y: number }[] = [
  { text: 'SENSES', x: 205, y: 365 },
  { text: 'BRAIN', x: 880, y: 125 },
  { text: 'IMMUNE', x: 705, y: 600 },
  { text: 'ACTIONS', x: 1085, y: 262 },
]

/** A smooth open curve through the points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: Pt[], tension = 1): string {
  if (points.length < 2) return ''
  const p = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = p(i - 1)
    const [x1, y1] = p(i)
    const [x2, y2] = p(i + 1)
    const [x3, y3] = p(i + 2)
    const c1x = x1 + ((x2 - x0) / 6) * tension
    const c1y = y1 + ((y2 - y0) / 6) * tension
    const c2x = x2 - ((x3 - x1) / 6) * tension
    const c2y = y2 - ((y3 - y1) / 6) * tension
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x2} ${y2}`
  }
  return d
}

/** A smooth closed curve through the points. */
function closedSmoothPath(points: Pt[]): string {
  const n = points.length
  const p = (i: number) => points[((i % n) + n) % n]
  let d = `M ${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p(i - 1)
    const [x1, y1] = p(i)
    const [x2, y2] = p(i + 1)
    const [x3, y3] = p(i + 2)
    d += ` C ${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
  }
  return `${d} Z`
}

/**
 * The membrane outline, `grow` px outside the body ellipse, wobbled by `phase` (radians).
 * Every phase uses the same number of points, so SVG can animate smoothly between them (breathing).
 */
export function membranePath(phase: number, grow = 26): string {
  const pts: Pt[] = []
  const N = 18
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    const wobble = 1 + 0.055 * Math.sin(3 * t + phase) + 0.035 * Math.sin(5 * t - phase * 1.7) + 0.02 * Math.sin(2 * t + 1)
    pts.push([
      BODY.cx + (BODY.rx + grow) * wobble * Math.cos(t),
      BODY.cy + (BODY.ry + grow) * wobble * Math.sin(t),
    ])
  }
  return closedSmoothPath(pts)
}

/** Small organelles drifting inside the body (purely decorative). */
export const organelles: { x: number; y: number; r: number; delay: number }[] = [
  [200, 300, 3], [340, 170, 2], [520, 120, 2.5], [690, 150, 3.5], [1000, 300, 2], [1060, 420, 3],
  [860, 520, 2.5], [690, 600, 2], [400, 580, 3], [250, 470, 2], [560, 410, 2], [790, 410, 2.5],
  [960, 560, 2], [470, 340, 1.8],
].map(([x, y, r], i) => ({ x, y, r, delay: -(i * 1.7) % 11 }))
