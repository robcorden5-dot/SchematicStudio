// Multi-wire tool: the geometry, kept free of any canvas code so it can be tested on its own.
//
// The tool works in two sweeps. The person drags a line across a row of pins (the "from" pins), then another
// across the pins to connect them to (the "to" pins). The pins in each sweep are put in the order the line
// passed over them and paired up one to one, and routeBundle() works out one orthogonal wire for each pair —
// leaving each pin in the direction the symbol points, and staggering the turns so the wires run side by side
// instead of on top of each other.

export const MW_LEAD = 20;   // straight run out of a pin before a wire may turn
export const MW_GRID = 20;
const EPS = 1e-6;

// Pins lying on the straight (horizontal or vertical) line from (x1,y1) to (x2,y2), in the order the line meets
// them. `pins` is [{x, y, ...}]. Two pins at the same spot count once.
export function pinsOnSegment(pins, x1, y1, x2, y2, tol = 6) {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const dir = horizontal ? Math.sign(x2 - x1) || 1 : Math.sign(y2 - y1) || 1;
  const lo = horizontal ? Math.min(x1, x2) : Math.min(y1, y2);
  const hi = horizontal ? Math.max(x1, x2) : Math.max(y1, y2);
  const seen = new Set();
  const hits = [];
  pins.forEach(p => {
    const across = horizontal ? p.y - y1 : p.x - x1;
    const along = horizontal ? p.x : p.y;
    if (Math.abs(across) > tol || along < lo - tol || along > hi + tol) return;
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(p);
  });
  hits.sort((a, b) => dir * ((horizontal ? a.x : a.y) - (horizontal ? b.x : b.y)));
  return { pins: hits, axis: horizontal ? 'h' : 'v' };
}

const centroid = (pins) => ({ x: pins.reduce((s, p) => s + p.x, 0) / pins.length, y: pins.reduce((s, p) => s + p.y, 0) / pins.length });

// The way the wires of one sweep should leave their pins: a unit vector at right angles to the sweep line.
// A symbol that says which way its pins point (p.out) wins; otherwise the wires head toward the other end.
export function bundleDirection(pins, axis, otherPins) {
  const wanted = axis === 'h' ? 'y' : 'x';
  for (const p of pins) {
    if (p.out && Math.abs(p.out[wanted]) > 0.5) return axis === 'h' ? { x: 0, y: Math.sign(p.out.y) } : { x: Math.sign(p.out.x), y: 0 };
  }
  const here = centroid(pins), there = centroid(otherPins);
  const d = axis === 'h' ? there.y - here.y : there.x - here.x;
  const s = d < 0 ? -1 : 1;
  return axis === 'h' ? { x: 0, y: s } : { x: s, y: 0 };
}

// Drops repeated points and merges vertices that lie in a straight line. null if the route folds back on itself.
function tidy(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (out.length >= 2 && Math.abs(out[out.length - 2] - x) < EPS && Math.abs(out[out.length - 1] - y) < EPS) continue;
    out.push(x, y);
    while (out.length >= 6) {
      const n = out.length;
      const ax = out[n - 6], ay = out[n - 5], bx = out[n - 4], by = out[n - 3], cx = out[n - 2], cy = out[n - 1];
      if (Math.abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) > EPS) break;
      if ((bx - ax) * (cx - bx) + (by - ay) * (cy - by) < 0) return null;
      out.splice(n - 4, 2);
    }
  }
  return out;
}

export function isOrthogonal(pts) {
  if (!Array.isArray(pts) || pts.length < 4 || pts.length % 2) return false;
  for (const v of pts) if (!Number.isFinite(v)) return false;
  for (let i = 0; i < pts.length - 2; i += 2) {
    if (Math.abs(pts[i] - pts[i + 2]) > EPS && Math.abs(pts[i + 1] - pts[i + 3]) > EPS) return false;
  }
  return true;
}

// One wire per pair S[i] -> D[i]. dirS / dirD: the unit vector each end leaves its pins by.
// Returns an array of point lists ([x1,y1,x2,y2,...]).
export function routeBundle(S, D, dirS, dirD, snap = (v) => Math.round(v / MW_GRID) * MW_GRID) {
  const N = S.length;
  const perp = { x: Math.abs(dirS.y), y: Math.abs(dirS.x) };           // positive unit vector at right angles to dirS
  const U = (p) => p.x * dirS.x + p.y * dirS.y;                          // distance along the leaving direction
  const V = (p) => p.x * perp.x + p.y * perp.y;                          // sideways position
  const at = (u, v) => [dirS.x * u + perp.x * v, dirS.y * u + perp.y * v];
  const dotd = dirS.x * dirD.x + dirS.y * dirD.y;
  const routes = new Array(N).fill(null);

  // Generic route: out of each pin, across, along, into the other pin.
  const generic = (P, Q) => {
    const a = [P.x + dirS.x * MW_LEAD, P.y + dirS.y * MW_LEAD];
    const b = [Q.x + dirD.x * MW_LEAD, Q.y + dirD.y * MW_LEAD];
    const c = at(U({ x: a[0], y: a[1] }), V({ x: b[0], y: b[1] }));
    return tidy([P.x, P.y, a[0], a[1], c[0], c[1], b[0], b[1], Q.x, Q.y]);
  };

  // Which lane (0 = the one nearest the source) each wire turns on. Wires that all shift the same way nest cleanly
  // so long as the one furthest in the direction of travel turns first.
  const laneOrder = (idx) => {
    const shift = idx.reduce((s, i) => s + (V(D[i]) - V(S[i])), 0);
    const sorted = idx.slice().sort((i, j) => (V(S[j]) - V(S[i])) * (shift >= 0 ? 1 : -1));
    const rank = {};
    sorted.forEach((i, r) => { rank[i] = r; });
    return rank;
  };

  const bending = [];
  for (let i = 0; i < N; i++) if (Math.abs(V(D[i]) - V(S[i])) > EPS) bending.push(i);

  if (dotd < -0.5) {
    // Facing each other: a lane between the two rows for every wire that has to shift sideways.
    const ua = Math.max(...S.map(U)) + MW_LEAD, ub = Math.min(...D.map(U)) - MW_LEAD;
    if (ub >= ua - EPS) {
      const rank = laneOrder(bending);
      const M = bending.length;
      const gap = ub - ua;
      const spacing = M > 1 ? Math.min(MW_GRID, gap / (M - 1)) : 0;
      const total = spacing * Math.max(M - 1, 0);
      let first = ua + (gap - total) / 2;
      if (spacing === MW_GRID || M <= 1) first = Math.min(Math.max(snap(first), ua), ub - total);   // on the grid whenever there is room
      for (let i = 0; i < N; i++) {
        const P = S[i], Q = D[i];
        if (!bending.includes(i)) { routes[i] = [P.x, P.y, Q.x, Q.y]; continue; }
        const lane = first + rank[i] * spacing;
        const l1 = at(lane, V(P)), l2 = at(lane, V(Q));
        routes[i] = tidy([P.x, P.y, l1[0], l1[1], l2[0], l2[1], Q.x, Q.y]);
      }
    }
  } else if (dotd > 0.5) {
    // Both leave the same way (a U): the lanes are beyond whichever end sticks out furthest.
    const base = Math.max(Math.max(...S.map(U)), Math.max(...D.map(U))) + MW_LEAD;
    const rank = laneOrder(bending);
    for (let i = 0; i < N; i++) {
      if (!bending.includes(i)) continue;
      const P = S[i], Q = D[i];
      const lane = base + rank[i] * MW_GRID;
      const l1 = at(lane, V(P)), l2 = at(lane, V(Q));
      routes[i] = tidy([P.x, P.y, l1[0], l1[1], l2[0], l2[1], Q.x, Q.y]);
    }
  } else {
    // At right angles: one corner each, when the pins allow it.
    for (let i = 0; i < N; i++) {
      const P = S[i], Q = D[i];
      const c = at(U(Q), V(P));
      const ahead = (U(Q) - U(P)) > EPS;
      const arrives = (c[0] - Q.x) * dirD.x + (c[1] - Q.y) * dirD.y > EPS;
      if (ahead && arrives) routes[i] = [P.x, P.y, c[0], c[1], Q.x, Q.y];
    }
  }

  for (let i = 0; i < N; i++) {
    if (!routes[i] || !isOrthogonal(routes[i])) routes[i] = generic(S[i], D[i]);
    if (!routes[i] || !isOrthogonal(routes[i])) {
      // Last resort: a single elbow, so the wire is at least orthogonal.
      const P = S[i], Q = D[i];
      routes[i] = Math.abs(P.x - Q.x) < EPS || Math.abs(P.y - Q.y) < EPS ? [P.x, P.y, Q.x, Q.y]
        : (dirS.x === 0 ? [P.x, P.y, P.x, Q.y, Q.x, Q.y] : [P.x, P.y, Q.x, P.y, Q.x, Q.y]);
    }
  }
  return routes;
}
