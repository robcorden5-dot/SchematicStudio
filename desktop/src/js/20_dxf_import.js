// ==========================================
// 20. DXF IMPORT (rules)
// ==========================================
// Reads an ASCII DXF drawing and turns what it draws into plain polylines in
// millimetres - the one thing a panel layout needs from a manufacturer's
// drawing: its outline, mounting holes and fixing points. No page access here,
// so it is tested on its own.
//
// Read: LINE, ARC, CIRCLE, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE/VERTEX, and
// INSERT (a block placed in the drawing, flattened). Everything else (text,
// hatches, dimensions, 3D solids ...) is counted in `skipped` and left out.
// Curves are cut into short straight pieces that stay within 0.05 mm of the
// true curve, and neighbouring pieces are joined into longer polylines.

const TAU = Math.PI * 2;
export const MAX_DXF_BYTES = 20 * 1024 * 1024;
export const MAX_FOOTPRINT_POINTS = 40000;

// $INSUNITS -> millimetres per drawing unit. 0 (unspecified) is taken as millimetres.
const UNIT_TO_MM = { 0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1000000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100, 15: 10000 };
export const UNIT_NAMES = { 0: 'unspecified', 1: 'inches', 2: 'feet', 3: 'miles', 4: 'millimetres', 5: 'centimetres', 6: 'metres', 7: 'kilometres', 8: 'microinches', 9: 'mils', 10: 'yards', 13: 'microns', 14: 'decimetres', 15: 'decametres' };

function readPairs(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { if (lines[i].trim() === '' && i + 2 < lines.length && !Number.isNaN(parseInt(lines[i + 1].trim(), 10))) { i -= 1; continue; } return pairs; }
    pairs.push([code, lines[i + 1]]);
  }
  return pairs;
}

// Splits the pairs into entities ({ type, p: [[code, value], ...] }) between two indexes.
function splitEntities(pairs, from, to) {
  const out = [];
  let cur = null;
  for (let i = from; i < to; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { cur = { type: v.trim(), p: [] }; out.push(cur); }
    else if (cur) cur.p.push([c, v]);
  }
  return out;
}

const num = (v) => { const n = parseFloat(String(v).trim()); return Number.isFinite(n) ? n : 0; };
const first = (e, code, dflt = 0) => { const h = e.p.find(x => x[0] === code); return h ? num(h[1]) : dflt; };
const firstStr = (e, code, dflt = '') => { const h = e.p.find(x => x[0] === code); return h ? String(h[1]).trim() : dflt; };
const all = (e, code) => e.p.filter(x => x[0] === code).map(x => num(x[1]));

// The "arbitrary axis" rule: how an entity's own (OCS) x/y map to the drawing's. Only a
// flipped extrusion (0,0,-1) is common, but any normal is handled.
function ocsAxes(e) {
  let nx = first(e, 210, 0), ny = first(e, 220, 0), nz = first(e, 230, 1);
  const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
  if (Math.abs(nx) < 1e-6 && Math.abs(ny) < 1e-6 && nz > 0) return null;   // the normal case: nothing to do
  let ax, ay, az;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) { ax = nz; ay = 0; az = -nx; }  // (0,1,0) x N
  else { ax = -ny; ay = nx; az = 0; }                                                                                         // (0,0,1) x N
  const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az;                                                                        // N x Ax
  return { ax, ay, bx, by };
}
const toWcs = (axes, x, y) => (axes ? [x * axes.ax + y * axes.bx, x * axes.ay + y * axes.by] : [x, y]);

const TOL = 0.05;   // mm: how far a drawn piece may stray from the true curve
function arcPoints(cx, cy, r, a0, a1, axes) {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += TAU;
  if (sweep > TAU + 1e-9) sweep = TAU;
  const step = r > TOL ? 2 * Math.acos(Math.max(0, 1 - TOL / r)) : Math.PI / 2;
  const n = Math.max(2, Math.min(720, Math.ceil(sweep / Math.max(step, 0.02))));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * i / n;
    pts.push(toWcs(axes, cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}

function bulgeArc(p, q, bulge) {
  // the arc from p to q that a polyline bulge describes (bulge = tan(sweep / 4))
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const chord = Math.hypot(dx, dy);
  if (!chord || !bulge) return [q];
  const sweep = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const h = r * Math.cos(sweep / 2);
  const ux = -dy / chord, uy = dx / chord;           // left of p->q
  const cx = mx + ux * h * Math.sign(bulge), cy = my + uy * h * Math.sign(bulge);
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const step = r > TOL ? 2 * Math.acos(Math.max(0, 1 - TOL / r)) : Math.PI / 2;
  const n = Math.max(2, Math.min(360, Math.ceil(Math.abs(sweep) / Math.max(step, 0.02))));
  const out = [];
  for (let i = 1; i <= n; i++) { const a = a0 + sweep * i / n; out.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); }
  out[out.length - 1] = q;
  return out;
}

function polylineFromVertices(verts, closed, axes) {
  const pts = verts.map(v => ({ xy: toWcs(axes, v.x, v.y), b: v.b }));
  const out = [];
  if (!pts.length) return out;
  out.push(pts[0].xy);
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    // a bulge is measured in the entity's own plane; a mirrored plane reverses it
    const b = axes && (axes.ax * axes.by - axes.ay * axes.bx) < 0 ? -p.b : p.b;
    bulgeArc(p.xy, q.xy, b).forEach(pt => out.push(pt));
  }
  return out;
}

// B-spline / NURBS evaluation (de Boor).
function evalSpline(deg, knots, ctrl, weights, u) {
  const n = ctrl.length;
  let k = deg;
  while (k < n - 1 && u >= knots[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= deg; j++) {
    const w = weights ? weights[j + k - deg] : 1;
    d.push([ctrl[j + k - deg][0] * w, ctrl[j + k - deg][1] * w, w]);
  }
  for (let r = 1; r <= deg; r++) {
    for (let j = deg; j >= r; j--) {
      const den = knots[j + 1 + k - r] - knots[j + k - deg];
      const a = den === 0 ? 0 : (u - knots[j + k - deg]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
  }
  const w = d[deg][2] || 1;
  return [d[deg][0] / w, d[deg][1] / w];
}

function splinePoints(e) {
  const deg = first(e, 71, 3);
  const knots = all(e, 40);
  const weights = all(e, 41);
  const ctrl = [], fit = [];
  let cur = null;
  e.p.forEach(([c, v]) => {
    if (c === 10) { cur = [num(v), 0]; ctrl.push(cur); }
    else if (c === 20 && cur && ctrl[ctrl.length - 1] === cur) cur[1] = num(v);
    else if (c === 11) { cur = [num(v), 0]; fit.push(cur); }
    else if (c === 21 && cur && fit[fit.length - 1] === cur) cur[1] = num(v);
  });
  if (ctrl.length > deg && knots.length === ctrl.length + deg + 1) {
    const lo = knots[deg], hi = knots[ctrl.length];
    if (!(hi > lo)) return ctrl.slice();
    const w = weights.length === ctrl.length ? weights : null;
    const n = Math.min(500, Math.max(24, ctrl.length * 12));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i === n ? hi - (hi - lo) * 1e-12 : lo + (hi - lo) * i / n;
      pts.push(evalSpline(deg, knots, ctrl, w, u));
    }
    return pts;
  }
  return fit.length ? fit : ctrl;
}

function ellipsePoints(e) {
  const cx = first(e, 10), cy = first(e, 20), mx = first(e, 11), my = first(e, 21);
  const ratio = first(e, 40, 1), t0 = first(e, 41, 0), t1 = first(e, 42, TAU);
  const nz = first(e, 230, 1);
  const minor = nz < 0 ? [my * ratio, -mx * ratio] : [-my * ratio, mx * ratio];
  let sweep = t1 - t0; while (sweep <= 0) sweep += TAU; if (sweep > TAU + 1e-9) sweep = TAU;
  const major = Math.hypot(mx, my);
  const step = major > TOL ? 2 * Math.acos(Math.max(0, 1 - TOL / major)) : Math.PI / 2;
  const n = Math.max(8, Math.min(720, Math.ceil(sweep / Math.max(step, 0.02))));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + sweep * i / n;
    pts.push([cx + Math.cos(t) * mx + Math.sin(t) * minor[0], cy + Math.cos(t) * my + Math.sin(t) * minor[1]]);
  }
  return pts;
}

// Turns one entity into zero or more polylines (each a list of [x, y]).
function entityPolylines(e, ctx) {
  switch (e.type) {
    case 'LINE': return [[[first(e, 10), first(e, 20)], [first(e, 11), first(e, 21)]]];
    case 'ARC': return [arcPoints(first(e, 10), first(e, 20), first(e, 40), first(e, 50) * Math.PI / 180, first(e, 51) * Math.PI / 180, ocsAxes(e))];
    case 'CIRCLE': return [arcPoints(first(e, 10), first(e, 20), first(e, 40), 0, TAU, ocsAxes(e))];
    case 'ELLIPSE': return [ellipsePoints(e)];
    case 'SPLINE': return [splinePoints(e)];
    case 'LWPOLYLINE': {
      const verts = []; let cur = null;
      e.p.forEach(([c, v]) => {
        if (c === 10) { cur = { x: num(v), y: 0, b: 0 }; verts.push(cur); }
        else if (c === 20 && cur) cur.y = num(v);
        else if (c === 42 && cur) cur.b = num(v);
      });
      return [polylineFromVertices(verts, (first(e, 70, 0) & 1) === 1, ocsAxes(e))];
    }
    default: return [];
  }
}

// POLYLINE has its vertices as separate entities after it: gather them up.
function mergePolylines(entities) {
  const out = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type === 'POLYLINE') {
      const verts = [];
      let j = i + 1;
      while (j < entities.length && entities[j].type === 'VERTEX') { verts.push({ x: first(entities[j], 10), y: first(entities[j], 20), b: first(entities[j], 42, 0) }); j++; }
      if (j < entities.length && entities[j].type === 'SEQEND') j++;
      out.push({ type: 'POLYLINE_DONE', verts, closed: (first(e, 70, 0) & 1) === 1, axes: ocsAxes(e) });
      i = j - 1;
    } else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') out.push(e);
  }
  return out;
}

const mul = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const compose = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

function collect(entities, ctx, matrix, depth, out) {
  mergePolylines(entities).forEach(e => {
    if (e.type === 'POLYLINE_DONE') { out.push(polylineFromVertices(e.verts, e.closed, e.axes).map(p => mul(matrix, p))); ctx.entities++; return; }
    if (e.type === 'INSERT') {
      const block = ctx.blocks[firstStr(e, 2)];
      if (!block || depth >= 6) { ctx.skipped.INSERT = (ctx.skipped.INSERT || 0) + 1; return; }
      const sx = first(e, 41, 1), sy = first(e, 42, 1), rot = first(e, 50, 0) * Math.PI / 180;
      const c = Math.cos(rot), s = Math.sin(rot);
      const m = compose(matrix, [c * sx, s * sx, -s * sy, c * sy, first(e, 10), first(e, 20)]);
      collect(block, ctx, m, depth + 1, out);
      return;
    }
    const polys = entityPolylines(e, ctx);
    if (!polys.length) { ctx.skipped[e.type] = (ctx.skipped[e.type] || 0) + 1; return; }
    ctx.entities++;
    polys.forEach(pl => { if (pl.length >= 2) out.push(pl.map(p => mul(matrix, p))); });
  });
}

// Joins polylines whose ends meet (within 0.002 mm) into longer ones.
export function joinPolylines(polys) {
  const key = (p) => `${Math.round(p[0] / 0.002)},${Math.round(p[1] / 0.002)}`;
  const items = polys.map(p => p.slice());
  const byEnd = new Map();
  const add = (i, pt) => { const k = key(pt); if (!byEnd.has(k)) byEnd.set(k, new Set()); byEnd.get(k).add(i); };
  const del = (i, pt) => { const s = byEnd.get(key(pt)); if (s) s.delete(i); };
  items.forEach((p, i) => { add(i, p[0]); add(i, p[p.length - 1]); });
  const used = new Array(items.length).fill(false);
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    del(i, items[i][0]); del(i, items[i][items[i].length - 1]);
    let chain = items[i];
    for (const forward of [true, false]) {
      for (;;) {
        const endPt = forward ? chain[chain.length - 1] : chain[0];
        const set = byEnd.get(key(endPt));
        if (!set || !set.size) break;
        const j = set.values().next().value;
        const other = items[j];
        used[j] = true;
        del(j, other[0]); del(j, other[other.length - 1]);
        if (forward) {
          const seg = key(other[0]) === key(endPt) ? other : other.slice().reverse();   // starts where the chain ends
          chain = chain.concat(seg.slice(1));
        } else {
          const seg = key(other[other.length - 1]) === key(endPt) ? other : other.slice().reverse();   // ends where the chain begins
          chain = seg.slice(0, -1).concat(chain);
        }
      }
    }
    out.push(chain);
  }
  return out;
}

// Douglas-Peucker: drops points that lie within `tol` of the line between their neighbours.
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (len2 === 0) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      else { const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2)); d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy)); }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Reads DXF text. Returns { ok, error } or
//   { ok, polylines: [[[x,y],...]] (mm, y up), bounds: {minX,minY,maxX,maxY}, units, unitName, unitScale,
//     entities, skipped: {TYPE: count}, points }
export function parseDxf(text, { unitScale = null } = {}) {
  if (typeof text !== 'string' || !text.length) return { ok: false, error: 'That file is empty.' };
  if (text.startsWith('AutoCAD Binary DXF')) return { ok: false, error: 'That is a binary DXF. Save it as an ASCII DXF and try again.' };
  if (text.startsWith('AC10') || (text.charCodeAt(0) === 0x41 && /^AC10\d\d/.test(text))) return { ok: false, error: 'That is a DWG file, not a DXF. Save it as DXF from your CAD package (Save As → DXF) and import that.' };
  const pairs = readPairs(text);
  if (pairs.length < 4) return { ok: false, error: 'That does not look like a DXF file.' };

  let insUnits = 0;
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 9 && pairs[i][1].trim() === '$INSUNITS') { const h = pairs[i + 1]; if (h && h[0] === 70) insUnits = parseInt(h[1], 10) || 0; }
  }
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'SECTION' && pairs[i + 1] && pairs[i + 1][0] === 2) {
      const name = pairs[i + 1][1].trim();
      let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1].trim() === 'ENDSEC')) j++;
      sections[name] = [i + 2, j];
      i = j;
    }
  }
  if (!sections.ENTITIES) return { ok: false, error: 'That does not look like a DXF file (no drawing entities found).' };

  const blocks = {};
  if (sections.BLOCKS) {
    const ents = splitEntities(pairs, sections.BLOCKS[0], sections.BLOCKS[1]);
    let name = null, body = null;
    ents.forEach(e => {
      if (e.type === 'BLOCK') { name = firstStr(e, 2); body = []; }
      else if (e.type === 'ENDBLK') { if (name !== null) blocks[name] = body; name = null; body = null; }
      else if (body) body.push(e);
    });
  }
  const ctx = { blocks, skipped: {}, entities: 0 };
  const raw = [];
  collect(splitEntities(pairs, sections.ENTITIES[0], sections.ENTITIES[1]), ctx, [1, 0, 0, 1, 0, 0], 0, raw);

  const scale = unitScale && unitScale > 0 ? unitScale : (UNIT_TO_MM[insUnits] ?? 1);
  const scaled = raw.map(pl => pl.map(([x, y]) => [x * scale, y * scale])).filter(pl => pl.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  if (!scaled.length) return { ok: false, error: 'No lines, arcs or curves could be read from that drawing.', skipped: ctx.skipped };

  let joined = joinPolylines(scaled);
  let tol = 0.02;
  let polylines = joined.map(p => simplify(p, tol));
  let points = polylines.reduce((n, p) => n + p.length, 0);
  while (points > MAX_FOOTPRINT_POINTS && tol < 2) {
    tol *= 2;
    polylines = joined.map(p => simplify(p, tol));
    points = polylines.reduce((n, p) => n + p.length, 0);
  }
  polylines = polylines.filter(p => p.length >= 2);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polylines.forEach(p => p.forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }));
  return { ok: true, polylines, bounds: { minX, minY, maxX, maxY }, units: insUnits, unitName: UNIT_NAMES[insUnits] || 'unknown', unitScale: scale, entities: ctx.entities, skipped: ctx.skipped, points };
}

// Turns a parsed drawing into the footprint a project keeps: centred on its own middle,
// y turned to point down (as on screen), coordinates rounded to 0.01 mm and stored flat
// ([x1, y1, x2, y2, ...] per polyline) to keep the saved project small.
export function buildFootprintGeometry(parsed) {
  const { minX, minY, maxX, maxY } = parsed.bounds;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const r = (v) => Math.round(v * 100) / 100;
  const lines = parsed.polylines.map(pl => { const flat = []; pl.forEach(([x, y]) => { flat.push(r(x - cx), r(-(y - cy))); }); return flat; });
  return { width: r(maxX - minX), height: r(maxY - minY), lines };
}
