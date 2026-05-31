// Pure geometry for the "auto-fan overlapping markers" feature.
//
// When several photo markers project to nearly the same screen pixel (e.g.
// a stack of photos shot at one rally turning point), they collapse into an
// unclickable blob. This module clusters markers by SCREEN-PIXEL proximity
// and fans each cluster out into a tight circle around the group centroid,
// returning a per-marker pixel offset plus the leader-line segments
// (centroid → fanned dot) that visually tie the cluster back to its place.
//
// Kept free of any map/React dependency so the clustering + layout maths can
// be unit-tested with plain numbers. The hook (`useMarkerFan`) supplies the
// screen-projected points and turns the screen-space leader segments back
// into lng/lat for the GL line layer.

/** A marker projected to screen-pixel space. */
export interface ScreenPoint {
  id: string
  x: number
  y: number
}

/** A leader line in screen space: centroid (`from`) → fanned dot (`to`). */
export interface LeaderSegment {
  id: string
  from: [number, number]
  to: [number, number]
}

/** A fanned cluster: its members (markerIds) and the screen-space centroid the
 *  fan radiates from. Used to anchor the "Compare N" pill and to know which
 *  photos a cluster gesture should compare. */
export interface MarkerCluster {
  ids: string[]
  centroid: [number, number]
}

export interface MarkerFanResult {
  /** markerId → [dx, dy] pixel offset. Only members of a fanned group appear. */
  offsets: Map<string, [number, number]>
  /** One per fanned marker. Empty when nothing overlaps. */
  leaders: LeaderSegment[]
  /** One per fanned group (size ≥ 2). Empty when nothing overlaps. */
  clusters: MarkerCluster[]
}

export interface MarkerFanOptions {
  /** Two markers within this pixel distance are considered overlapping. */
  thresholdPx?: number
  /** Base fan radius for a 2-member group (px). */
  baseRadiusPx?: number
  /** Extra radius per member beyond 2 (px). */
  radiusStepPx?: number
  /** Lower/upper clamp on the fan radius (px). */
  minRadiusPx?: number
  maxRadiusPx?: number
}

const DEFAULTS = {
  thresholdPx: 20,
  baseRadiusPx: 16,
  radiusStepPx: 2,
  minRadiusPx: 16,
  maxRadiusPx: 40,
} as const

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Single-link spatial clustering: any two points within `threshold` px are
 * placed in the same group (transitively). O(n²) — fine for the few dozen
 * markers a competition produces. Returns groups as arrays of indices into
 * `points`.
 */
export function clusterByProximity(
  points: readonly ScreenPoint[],
  threshold: number,
): number[][] {
  const n = points.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const t2 = threshold * threshold
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x
      const dy = points[i].y - points[j].y
      if (dx * dx + dy * dy <= t2) union(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }
  return Array.from(groups.values())
}

/**
 * Compute pixel offsets + leader segments that fan every overlapping group
 * out into a circle around its centroid. Solitary markers get no offset.
 *
 * Members are laid out at evenly-spaced angles starting from straight up
 * (-π/2), sorted by id so a given marker keeps a stable slot across
 * recomputes (no angular jitter on pan/zoom).
 */
export function computeMarkerFan(
  points: readonly ScreenPoint[],
  options: MarkerFanOptions = {},
): MarkerFanResult {
  const opt = { ...DEFAULTS, ...options }
  const offsets = new Map<string, [number, number]>()
  const leaders: LeaderSegment[] = []
  const clusters: MarkerCluster[] = []

  const groups = clusterByProximity(points, opt.thresholdPx)
  for (const group of groups) {
    if (group.length < 2) continue

    const members = group
      .map(i => points[i])
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const cx = members.reduce((s, p) => s + p.x, 0) / members.length
    const cy = members.reduce((s, p) => s + p.y, 0) / members.length
    const n = members.length
    clusters.push({ ids: members.map(p => p.id), centroid: [cx, cy] })
    const radius = clamp(
      opt.baseRadiusPx + opt.radiusStepPx * (n - 2),
      opt.minRadiusPx,
      opt.maxRadiusPx,
    )

    for (let k = 0; k < n; k++) {
      const p = members[k]
      const theta = -Math.PI / 2 + (2 * Math.PI * k) / n
      const tx = cx + radius * Math.cos(theta)
      const ty = cy + radius * Math.sin(theta)
      // Anchor stays at the marker's own projected point, so the offset must
      // carry it from there to the target slot on the fan circle.
      offsets.set(p.id, [tx - p.x, ty - p.y])
      leaders.push({ id: p.id, from: [cx, cy], to: [tx, ty] })
    }
  }

  return { offsets, leaders, clusters }
}
