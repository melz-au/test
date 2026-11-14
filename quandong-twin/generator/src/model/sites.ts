/**
 * Site configuration for Murray Flats Water (fictional).
 *
 * The default is 5 pump stations (PS01–PS05) to stay inside the free tiers. Set SITE_COUNT in
 * wrangler.jsonc (up to 40) to scale out; every site's layout is derived deterministically from its
 * index, so no other change is needed. See the README for the request and row-write arithmetic.
 */
export const DEFAULT_SITE_COUNT = 5;
export const MAX_SITES = 40;
export const HEAD_OFFICE_ID = "HO";

export interface SiteSpec {
  id: string;
  index: number;
  name: string;
  role: "pump_station" | "head_office";
  /** Number of duty/standby pumps (2 or 3). */
  pumps: number;
  hasEngineeringWorkstation: boolean;
  /** Reservoir capacity in litres. */
  reservoirLitres: number;
  /** Mean customer demand drawn from the reservoir, litres per second. */
  baseDemandLps: number;
  /** Nominal output of one pump, litres per second. */
  pumpRatedLps: number;
}

const PLACES = [
  "Saltbush Flat", "Mallee Bend", "Redgum Crossing", "Pelican Reach", "Quandong Hill", "Black Swamp",
  "Bluebush Plain", "Coorong Rise", "Lignum Creek", "Myall Downs", "Yabby Lagoon", "Emu Hollow",
];

export function siteId(index: number): string {
  return `PS${String(index).padStart(2, "0")}`;
}

export function pumpStation(index: number): SiteSpec {
  if (index < 1 || index > MAX_SITES) throw new Error(`site index ${index} out of range 1..${MAX_SITES}`);
  const place = PLACES[(index - 1) % PLACES.length] ?? "Murray Flats";
  const round = Math.floor((index - 1) / PLACES.length);
  return {
    id: siteId(index),
    index,
    name: round === 0 ? `${place} Pump Station` : `${place} No. ${round + 1} Pump Station`,
    role: "pump_station",
    pumps: index % 3 === 0 ? 3 : 2,
    // PS01, PS03, PS05 … have an on-site engineering workstation.
    hasEngineeringWorkstation: index % 2 === 1,
    reservoirLitres: 600_000 + (index % 4) * 100_000,
    baseDemandLps: 14 + (index % 5) * 1.5,
    pumpRatedLps: 30,
  };
}

export const headOffice: SiteSpec = {
  id: HEAD_OFFICE_ID,
  index: 0,
  name: "Murray Flats Water Head Office",
  role: "head_office",
  pumps: 0,
  hasEngineeringWorkstation: false,
  reservoirLitres: 0,
  baseDemandLps: 0,
  pumpRatedLps: 0,
};

/** All pump stations for a deployment. */
export function pumpStations(count = DEFAULT_SITE_COUNT): SiteSpec[] {
  const n = Math.max(1, Math.min(MAX_SITES, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => pumpStation(i + 1));
}

export function siteById(id: string): SiteSpec {
  if (id === HEAD_OFFICE_ID) return headOffice;
  const m = /^PS(\d{2})$/.exec(id);
  if (!m) throw new Error(`unknown site ${id}`);
  return pumpStation(Number(m[1]));
}
