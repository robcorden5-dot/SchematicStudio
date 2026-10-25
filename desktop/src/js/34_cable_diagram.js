// ==========================================
// 34. CABLE DIAGRAM PAGE (single line: locations joined by cables)
// ==========================================
// An automatic page, like Contents and Locations: nothing is stored on it, it is drawn fresh from the project each time.
// Every location that a cable starts or ends in is a box; every cable is a line between the boxes it joins, labelled with its
// designator, type and cores. A cable whose two ends are in the same location is listed inside that box instead of drawn as a
// line. Which location an end is in comes from the device or terminal it lands on (its own Location, else its parent's, else
// its sheet's), the same rule the Locations page and the part labels use.
import { state, pushHistory, scheduleAutosave, getPageType, todayStr, findLocationById, appAlert } from './1_config_state.js';
import { traceCableCores } from './33_cable_routes.js';
import { findOpenWireEndpoints } from './3_schematic_engine.js';
import { loadActiveSheet } from './5_portfolio_sheets.js';

const NONE = '?';   // devices that have no location

// ---- the data ----
// { nodes: [{ key, abbr, description, devices: [..], internal: [cable designators] }],
//   edges: [{ a, b, cable: { designator, type, cores, csa }, aDevs: [devices at a], bDevs: [devices at b] }],
//   open: [designators of cables with an end that reaches no device] }
export function buildCableDiagram() {
  let openMap;
  try { openMap = findOpenWireEndpoints(); } catch (e) { openMap = new Map(); }
  const nodes = new Map();
  const edges = [];
  const open = [];

  const node = (key) => {
    if (!nodes.has(key)) {
      const loc = key === NONE ? null : findLocationById(key);
      nodes.set(key, { key, abbr: loc ? `+${loc.abbreviation}` : 'No location', description: loc ? (loc.description || '') : 'Devices with no location set', devices: [], internal: [], none: !loc });
    }
    return nodes.get(key);
  };

  // inside a location's own box its prefix is redundant: +JB-X1 is just X1 there
  const tidy = (device, key) => { const loc = key === NONE ? null : findLocationById(key); return loc ? String(device).split(`+${loc.abbreviation}-`).join('') : String(device); };

  (state.cables || []).forEach(cable => {
    let routes = {};
    try { routes = traceCableCores(cable, openMap); } catch (e) { routes = {}; }
    const sides = { from: new Map(), to: new Map() };
    let looseFrom = 0, looseTo = 0, any = false;
    Object.values(routes).forEach(r => {
      any = true;
      looseFrom += r.fromLoose; looseTo += r.toLoose;
      [['from', r.fromPins], ['to', r.toPins]].forEach(([side, list]) => list.forEach(e => {
        const key = e.loc !== null && e.loc !== undefined && findLocationById(e.loc) ? String(findLocationById(e.loc).id) : NONE;
        if (!sides[side].has(key)) sides[side].set(key, new Set());
        sides[side].get(key).add(e.device);
      }));
    });
    if (!any) return;                                                   // nothing assigned to its cores yet
    if (!sides.from.size || !sides.to.size) { open.push(cable.designator || '?'); return; }
    if (looseFrom || looseTo) open.push(cable.designator || '?');
    const info = { designator: cable.designator || '?', type: cable.cableType || '', cores: cable.coreCount || 0, csa: cable.csa || '' };

    sides.from.forEach((devs, a) => sides.to.forEach((devs2, b) => {
      const aDevs = [...devs].map(d => tidy(d, a)), bDevs = [...devs2].map(d => tidy(d, b));
      node(a).devices.push(...aDevs); node(b).devices.push(...bDevs);
      if (a === b) { node(a).internal.push(info.designator); return; }
      edges.push({ a, b, cable: info, aDevs, bDevs });
    }));
  });

  nodes.forEach(n => { n.devices = [...new Set(n.devices)].sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true })); n.internal = [...new Set(n.internal)]; });
  return { nodes: [...nodes.values()], edges, open: [...new Set(open)] };
}

// ---- the layout ----
// Columns follow the direction of the cables (From to To), so a feed reads left to right. Boxes in a column are ordered to keep
// the lines from crossing more than they must.
export function layoutCableDiagram(data) {
  const ids = data.nodes.map(n => n.key);
  // A cable that runs back to an earlier box (a loop) must not push the boxes along, so those are set aside first.
  const incoming = new Map(ids.map(k => [k, 0]));
  data.edges.forEach(e => incoming.set(e.b, incoming.get(e.b) + 1));
  const start = [...ids].sort((x, y) => incoming.get(x) - incoming.get(y));
  const seen = new Map(), back = new Set();
  const visit = (u) => {
    seen.set(u, 1);
    data.edges.filter(e => e.a === u).forEach(e => { const st = seen.get(e.b); if (st === 1) back.add(e); else if (!st) visit(e.b); });
    seen.set(u, 2);
  };
  start.forEach(k => { if (!seen.get(k)) visit(k); });
  const layer = new Map(ids.map(k => [k, 0]));
  for (let pass = 0; pass < ids.length; pass++) {                       // longest path along the cables that go forward
    let moved = false;
    data.edges.forEach(e => { if (!back.has(e) && layer.get(e.b) < layer.get(e.a) + 1) { layer.set(e.b, layer.get(e.a) + 1); moved = true; } });
    if (!moved) break;
  }
  const cols = [];
  ids.forEach(k => { const l = layer.get(k); (cols[l] = cols[l] || []).push(k); });
  for (let i = 0; i < cols.length; i++) if (!cols[i]) cols[i] = [];
  const order = new Map();
  cols.forEach(c => c.forEach((k, i) => order.set(k, i)));
  const neighbours = (k, dir) => data.edges.filter(e => !back.has(e) && (dir < 0 ? e.b === k : e.a === k)).map(e => dir < 0 ? e.a : e.b);
  for (let sweep = 0; sweep < 4; sweep++) {
    const sequence = sweep % 2 === 0 ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i);
    const dir = sweep % 2 === 0 ? -1 : 1;
    sequence.forEach(ci => {
      const keyed = cols[ci].map(k => { const ns = neighbours(k, dir); return { k, v: ns.length ? ns.reduce((a, n) => a + order.get(n), 0) / ns.length : order.get(k) }; });
      keyed.sort((x, y) => x.v - y.v);
      cols[ci] = keyed.map(o => o.k);
      cols[ci].forEach((k, i) => order.set(k, i));
    });
  }
  return { cols, layer, back };
}

// ---- drawing ----
const ROW = 20;                 // one device per row inside a box; a cable's line meets the box at its device's row
const wrapLines = (text, chars) => {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  words.forEach(w => { if ((cur + ' ' + w).trim().length > chars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
  if (cur) lines.push(cur);
  return lines;
};
const detailOf = (c) => [c.type, c.cores ? `${c.cores}${c.csa ? '×' + c.csa + 'mm²' : ' core'}` : ''].filter(Boolean).join('  ');
// A cable's label: a small white tag with its designator and, smaller, its type and size. Sized so that tags on neighbouring
// rows never touch (the rows are 20 apart).
const LABEL_H = 15, LABEL_PITCH = 17, LABEL_DES_FS = 11, LABEL_DETAIL_FS = 9, LABEL_DES_CW = 6.8, LABEL_DETAIL_CW = 4.9;
const labelWidth = (c) => 10 + String(c.designator).length * LABEL_DES_CW + (detailOf(c) ? 6 + detailOf(c).length * LABEL_DETAIL_CW : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The size of one location's box: its name, description, then one row for each device a cable lands on.
function boxModel(n, boxW) {
  const chars = Math.floor((boxW - 16) / 6.2);
  const desc = wrapLines(n.description, chars);
  const internal = n.internal.length ? wrapLines('Within: ' + n.internal.join(', '), chars + 4) : [];
  const rowTop = 10 + 22 + desc.length * 14 + (n.devices.length ? 6 : 0);
  const h = rowTop + n.devices.length * ROW + (internal.length ? 6 + internal.length * 13 : 0) + 10;
  return { n, desc, internal, rowTop, w: boxW, h, x: 0, y: 0 };
}

const hitsBox = (pts, boxes, skipA, skipB) => {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = Math.min(pts[i], pts[i + 2]), x2 = Math.max(pts[i], pts[i + 2]), y1 = Math.min(pts[i + 1], pts[i + 3]), y2 = Math.max(pts[i + 1], pts[i + 3]);
    for (const b of boxes) {
      if (b === skipA || b === skipB) continue;
      if (x2 > b.x - 3 && x1 < b.x + b.w + 3 && y2 > b.y - 3 && y1 < b.y + b.h + 3) return true;
    }
  }
  return false;
};

// Works out every line from where the boxes are now, so it can be done again while a box is being dragged.
//   - boxes side by side: out of the side of one box at the row of its device, across, a right-angled turn, and in at the row of
//     the device at the other end; boxes one above the other: out of the bottom or top;
//   - a cable that would run through another box goes round underneath instead.
function routeAll(boxMap, edges) {
  const boxes = [...boxMap.values()];
  const rowY = (b, devs) => { const i = devs && devs.length ? b.n.devices.indexOf(devs[0]) : -1; return i < 0 ? b.y + b.h / 2 : b.y + b.rowTop + i * ROW + ROW / 2; };
  const items = edges.map(e => {
    const A = boxMap.get(e.a), B = boxMap.get(e.b);
    const mode = B.x - (A.x + A.w) >= 30 ? 'R' : A.x - (B.x + B.w) >= 30 ? 'L' : (B.y + B.h / 2 >= A.y + A.h / 2 ? 'D' : 'U');
    const sides = { R: ['right', 'left'], L: ['left', 'right'], D: ['bottom', 'top'], U: ['top', 'bottom'] }[mode];
    return { e, A, B, mode, sideA: sides[0], sideB: sides[1], w: labelWidth(e.cable) };
  });

  // where on its box each line starts and ends
  const reqs = new Map();
  items.forEach(it => {
    [['pa', it.A, it.sideA, it.e.aDevs, it.B], ['pb', it.B, it.sideB, it.e.bDevs, it.A]].forEach(([field, box, side, devs, other]) => {
      const k = box.n.key + '|' + side;
      if (!reqs.has(k)) reqs.set(k, []);
      const sideways = side === 'left' || side === 'right';
      reqs.get(k).push({ it, field, box, side, sideways, ideal: sideways ? rowY(box, devs) : other.x + other.w / 2, tie: other.y + other.h / 2 });
    });
  });
  reqs.forEach(list => {
    list.sort((p, q) => (p.ideal - q.ideal) || (p.tie - q.tie));
    const box = list[0].box;
    if (list[0].sideways) {
      // several cables to one device sit side by side; then every attachment is kept a label's height from the one before,
      // or the tags of neighbouring rows land on top of one another
      const lo = box.y + 8, hi = box.y + box.h - 8, pos = [];
      for (let i = 0; i < list.length;) {
        let j = i; while (j < list.length && Math.abs(list[j].ideal - list[i].ideal) < 1) j++;
        for (let k = i; k < j; k++) pos[k] = clamp(list[k].ideal + (k - i - (j - i - 1) / 2) * LABEL_PITCH, lo, hi);
        i = j;
      }
      const gap = list.length > 1 ? Math.min(LABEL_PITCH, (hi - lo) / (list.length - 1)) : LABEL_PITCH;
      for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + gap);
      if (pos.length && pos[pos.length - 1] > hi) { pos[pos.length - 1] = hi; for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - gap); }
      list.forEach((r, k) => { r.it[r.field] = pos[k]; });
    } else list.forEach((r, i) => { r.it[r.field] = box.x + box.w * (i + 1) / (list.length + 1); });
  });
  const point = (box, side, pos) => side === 'right' ? { x: box.x + box.w, y: pos } : side === 'left' ? { x: box.x, y: pos } : side === 'bottom' ? { x: pos, y: box.y + box.h } : { x: pos, y: box.y };
  items.forEach(it => { it.P = point(it.A, it.sideA, it.pa); it.Q = point(it.B, it.sideB, it.pb); });

  // the turning points of lines that share a gap are spread so they never lie on one another and stay clear of the labels
  const corridors = new Map();
  items.forEach(it => {
    const key = (it.mode === 'R' || it.mode === 'L') ? `${it.mode}|${Math.round(it.P.x)}|${Math.round(it.Q.x)}` : `${it.mode}|${Math.round(it.P.y)}|${Math.round(it.Q.y)}`;
    if (!corridors.has(key)) corridors.set(key, []);
    corridors.get(key).push(it);
  });
  corridors.forEach(list => {
    const it0 = list[0];
    if (it0.mode === 'R' || it0.mode === 'L') {
      const dir = it0.mode === 'R' ? 1 : -1, span = Math.abs(it0.Q.x - it0.P.x), lw = Math.max(...list.map(i => i.w));
      const step = clamp((span - lw - 40) / list.length, 8, 16);
      const up = list.filter(i => i.Q.y < i.P.y).sort((p, q) => p.P.y - q.P.y), down = list.filter(i => i.Q.y > i.P.y).sort((p, q) => q.P.y - p.P.y);
      [...up, ...down].forEach((it, i) => { it.x1 = it.P.x + dir * Math.min(span - 12, lw + 22 + step * i); });
    } else {
      const mid = (it0.P.y + it0.Q.y) / 2;
      list.forEach((it, i) => { it.ym = clamp(mid + (i - (list.length - 1) / 2) * 22, Math.min(it.P.y, it.Q.y) + 8, Math.max(it.P.y, it.Q.y) - 8); });
    }
  });

  // Lines from different corridors can still land on the same turning point (two cables leaving one side for different boxes).
  // Any two parallel runs that overlap are pushed apart until each has a lane to itself.
  const side = items.filter(i => (i.mode === 'R' || i.mode === 'L') && i.P.y !== i.Q.y), vert = items.filter(i => (i.mode === 'D' || i.mode === 'U') && i.P.x !== i.Q.x);
  const overlap = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)) > -2;
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    side.forEach((a, i) => side.forEach((b, j) => {
      if (j <= i || Math.abs(a.x1 - b.x1) >= 9 || !overlap(a.P.y, a.Q.y, b.P.y, b.Q.y)) return;
      const dir = b.mode === 'R' ? 1 : -1, span = Math.abs(b.Q.x - b.P.x);
      if (Math.abs(b.x1 - b.P.x) + 10 <= span - 12) { b.x1 += dir * 10; moved = true; }
      else if (Math.abs(a.x1 - a.P.x) - 10 > a.w + 22) { a.x1 -= dir * 10; moved = true; }
    }));
    vert.forEach((a, i) => vert.forEach((b, j) => {
      if (j <= i || Math.abs(a.ym - b.ym) >= 9 || !overlap(a.P.x, a.Q.x, b.P.x, b.Q.x)) return;
      b.ym += 12; moved = true;
    }));
    if (!moved) break;
  }

  const maxBottom = Math.max(...boxes.map(b => b.y + b.h));
  let belowN = 0, maxY = maxBottom;
  const paths = items.map(it => {
    const { P, Q } = it;
    let pts, lx, ly;
    if (it.mode === 'R' || it.mode === 'L') {
      const dir = it.mode === 'R' ? 1 : -1;
      if (P.y === Q.y) { pts = [P.x, P.y, Q.x, Q.y]; lx = (P.x + Q.x) / 2; ly = P.y; }
      else { pts = [P.x, P.y, it.x1, P.y, it.x1, Q.y, Q.x, Q.y]; lx = P.x + dir * (6 + it.w / 2); ly = P.y; }
    } else if (P.x === Q.x) { pts = [P.x, P.y, Q.x, Q.y]; lx = P.x; ly = (P.y + Q.y) / 2; }
    else { pts = [P.x, P.y, P.x, it.ym, Q.x, it.ym, Q.x, Q.y]; lx = (P.x + Q.x) / 2; ly = it.ym; }
    let around = false;
    if (hitsBox(pts, boxes, it.A, it.B)) {                                    // it would cross another box: go round underneath
      const run = maxBottom + 28 + 24 * belowN, k = belowN++;
      const exitX = (box, other) => {                                        // a place on the box's bottom edge with nothing underneath it
        const cands = [0, -1, 1, -2, 2, -3, 3, -4, 4].map(m => box.x + box.w / 2 + m * 18 + ((k % 5) - 2) * 3).filter(x => x > box.x + 6 && x < box.x + box.w - 6);
        return cands.find(x => !hitsBox([x, box.y + box.h, x, run], boxes, box, null)) ?? cands[0];
      };
      const xa = exitX(it.A), xb = exitX(it.B);
      pts = [xa, it.A.y + it.A.h, xa, run, xb, run, xb, it.B.y + it.B.h];
      lx = xa + (xb - xa) * (0.25 + 0.5 * ((k % 3) / 2)); ly = run; around = true; maxY = Math.max(maxY, run + 24);
    }
    return { pts, lx, ly, e: it.e, w: it.w, ends: around ? [] : [[P.x, P.y], [Q.x, Q.y]] };
  });
  return { paths, maxY };
}

export function drawCableDiagram(sheet, width, height) {
  const group = new Konva.Group();
  const margin = 60;
  group.add(new Konva.Rect({ x: 40, y: 40, width: width - 80, height: height - 80, stroke: '#000000', strokeWidth: 2 }));
  group.add(new Konva.Text({ x: margin, y: margin + 10, text: sheet.title || 'Cable diagram', fontSize: 22, fontStyle: 'bold', fill: '#0f172a' }));
  group.add(new Konva.Line({ points: [margin, margin + 44, width - margin, margin + 44], stroke: '#cbd5e1', strokeWidth: 1 }));

  const data = buildCableDiagram();
  const say = (text, y) => group.add(new Konva.Text({ x: margin, y, text, fontSize: 12, fontStyle: 'italic', fill: '#94a3b8', width: width - margin * 2 }));
  if (!data.nodes.length) {
    say('Nothing to show yet. Assign wires to a cable with the Cable tool, and give the devices at each end a location (from the sheet\'s properties or the part\'s own Location). Each location then appears here as a box, with the cables drawn between them.', margin + 66);
    return group;
  }

  const { cols, layer, back } = layoutCableDiagram(data);
  const nCols = cols.length;
  const boxW = 170;
  const boxMap = new Map(data.nodes.map(n => [n.key, boxModel(n, boxW)]));

  // the space between columns: room for the longest label, the turns of the lines and a little air
  const isForward = (e) => !back.has(e) && layer.get(e.b) === layer.get(e.a) + 1;
  const perGap = new Map();
  data.edges.filter(isForward).forEach(e => { const k = layer.get(e.a), o = perGap.get(k) || { n: 0, w: 0 }; o.n += 1; o.w = Math.max(o.w, labelWidth(e.cable)); perGap.set(k, o); });
  let gap = 0;
  if (nCols > 1) { gap = 120; perGap.forEach(o => { gap = Math.max(gap, o.w + 22 + 10 * o.n + 24); }); }
  cols.forEach((col, ci) => {                                           // the automatic arrangement: columns in the direction of the cables
    const spacing = 44;
    const total = col.reduce((acc, k) => acc + boxMap.get(k).h, 0) + spacing * (col.length - 1);
    let y = -total / 2;
    col.forEach(k => { const b = boxMap.get(k); b.x = ci * (boxW + gap); b.y = y; b.baseX = b.x; b.baseY = y; y += b.h + spacing; });
  });

  // The page is fitted and centred from the automatic arrangement, so moving a box leaves everything else where it is.
  const base = routeAll(boxMap, data.edges);
  const bx = [...boxMap.values()];
  const minX = Math.min(...bx.map(b => b.x)), maxX = Math.max(...bx.map(b => b.x + b.w)), minY = Math.min(...bx.map(b => b.y)), maxY = base.maxY;
  const availW = width - margin * 2, availH = height - margin - 60 - (margin + 70);
  const scale = Math.max(0.25, Math.min(1, availW / (maxX - minX), availH / (maxY - minY)));
  const g = new Konva.Group();
  g.setAttrs({ x: margin + (availW - (maxX - minX) * scale) / 2 - minX * scale, y: margin + 70 + (availH - (maxY - minY) * scale) / 2 - minY * scale, scaleX: scale, scaleY: scale });

  // boxes the user has moved keep their own place, as an offset from the automatic one
  const layout = sheet.cableLayout || {};
  boxMap.forEach((b, k) => { const o = layout[k]; if (o && Number.isFinite(o.dx) && Number.isFinite(o.dy)) { b.x = b.baseX + o.dx; b.y = b.baseY + o.dy; } });

  const linesGroup = new Konva.Group(), boxesGroup = new Konva.Group();
  g.add(linesGroup); g.add(boxesGroup);
  const drawLines = () => {
    linesGroup.destroyChildren();
    const { paths } = routeAll(boxMap, data.edges);
    paths.forEach(p => linesGroup.add(new Konva.Line({ points: p.pts, stroke: '#0f172a', strokeWidth: 2, lineJoin: 'miter' })));
    paths.forEach(p => p.ends.forEach(([x, y]) => linesGroup.add(new Konva.Circle({ x, y, radius: 3, fill: '#0f172a' }))));
    paths.forEach(({ lx, ly, e, w }) => {
      const detail = detailOf(e.cable), des = String(e.cable.designator);
      linesGroup.add(new Konva.Rect({ x: lx - w / 2, y: ly - LABEL_H / 2, width: w, height: LABEL_H, fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, cornerRadius: 3 }));
      linesGroup.add(new Konva.Text({ x: lx - w / 2 + 5, y: ly - 6.5, text: des, fontSize: LABEL_DES_FS, fontStyle: 'bold', fill: '#0f172a' }));
      if (detail) linesGroup.add(new Konva.Text({ x: lx - w / 2 + 5 + des.length * LABEL_DES_CW + 6, y: ly - 4.5, text: detail, fontSize: LABEL_DETAIL_FS, fill: '#475569' }));
    });
  };
  drawLines();

  const container = () => { try { return g.getStage() && g.getStage().container(); } catch (err) { return null; } };
  boxMap.forEach((b, key) => {
    const node = new Konva.Group({ x: b.x, y: b.y, draggable: true, name: 'cable-diagram-box' });
    node.add(new Konva.Rect({ x: 0, y: 0, width: b.w, height: b.h, fill: b.n.none ? '#f8fafc' : '#eff6ff', stroke: b.n.none ? '#94a3b8' : '#2563eb', strokeWidth: 2, cornerRadius: 4, dash: b.n.none ? [6, 4] : undefined }));
    node.add(new Konva.Text({ x: 8, y: 10, width: b.w - 16, text: b.n.abbr, fontSize: 16, fontStyle: 'bold', fill: b.n.none ? '#475569' : '#1d4ed8' }));
    let y = 32;
    b.desc.forEach(l => { node.add(new Konva.Text({ x: 8, y, text: l, fontSize: 11, fill: '#0f172a' })); y += 14; });
    b.n.devices.forEach((d, i) => {
      const ry = b.rowTop + i * ROW;
      node.add(new Konva.Line({ points: [8, ry + ROW - 1, b.w - 8, ry + ROW - 1], stroke: '#dbeafe', strokeWidth: 1 }));
      node.add(new Konva.Text({ x: 10, y: ry + 4, width: b.w - 20, text: String(d).length > 26 ? String(d).slice(0, 25) + '…' : String(d), fontSize: 11, fill: '#334155' }));
    });
    y = b.rowTop + b.n.devices.length * ROW + 6;
    b.internal.forEach(l => { node.add(new Konva.Text({ x: 8, y, text: l, fontSize: 10, fontStyle: 'italic', fill: '#64748b' })); y += 13; });
    boxesGroup.add(node);

    node.on('mouseenter', () => { const c = container(); if (c) c.style.cursor = 'move'; });
    node.on('mouseleave', () => { const c = container(); if (c) c.style.cursor = ''; });
    node.on('dragstart', () => pushHistory());
    node.on('dragmove', () => {
      // keep the box on the page
      const nx = clamp(node.x(), (50 - g.x()) / scale, (width - 50 - g.x()) / scale - b.w), ny = clamp(node.y(), (margin + 50 - g.y()) / scale, (height - 70 - g.y()) / scale - b.h);
      node.position({ x: nx, y: ny });
      b.x = nx; b.y = ny;
      drawLines();
      const layerNode = node.getLayer && node.getLayer(); if (layerNode && layerNode.batchDraw) layerNode.batchDraw();
    });
    node.on('dragend', () => {
      sheet.cableLayout = sheet.cableLayout || {};
      sheet.cableLayout[key] = { dx: Math.round(b.x - b.baseX), dy: Math.round(b.y - b.baseY) };
      scheduleAutosave();
    });
    node.on('dblclick dbltap', () => {                                   // double-click puts a box back in its automatic place
      if (!sheet.cableLayout || !sheet.cableLayout[key]) return;
      pushHistory();
      delete sheet.cableLayout[key];
      if (!Object.keys(sheet.cableLayout).length) delete sheet.cableLayout;
      scheduleAutosave();
      setTimeout(() => loadActiveSheet(), 0);
    });
  });
  group.add(g);

  // The how-to text lives in a tip window, so the page itself stays clean for printing.
  const tips = [];
  if (data.open.length) tips.push(`Not fully connected: ${data.open.join(', ')}. An end that reaches no device is not drawn.`);
  tips.push('Each line is a cable, drawn to the device it lands on.', 'Drag a location box to move it; the lines follow. Double-click a box to put it back in its automatic place.', 'The page is drawn from the project, so it updates when cables, devices or locations change.');
  const tipBtn = new Konva.Group({ x: width - margin - 62, y: margin + 10, name: 'cable-diagram-tip' });
  tipBtn.add(new Konva.Rect({ width: 62, height: 24, fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 1, cornerRadius: 12 }));
  tipBtn.add(new Konva.Text({ x: 0, y: 6, width: 62, align: 'center', text: '\u24d8 Tips', fontSize: 12, fill: '#475569' }));
  tipBtn.on('mouseenter', () => { const c = container(); if (c) c.style.cursor = 'pointer'; });
  tipBtn.on('mouseleave', () => { const c = container(); if (c) c.style.cursor = ''; });
  tipBtn.on('click tap', () => { appAlert(tips.join('\n\n'), 'Cable diagram tips'); });
  group.add(tipBtn);
  return group;
}

// ---- adding the page ----
export async function addCableDiagramPage() {
  if (state.sheets.some(s => getPageType(s) === 'cables')) {
    await appAlert('This portfolio already has a cable diagram page.');
    state.activeSheetIndex = state.sheets.findIndex(s => getPageType(s) === 'cables');
    loadActiveSheet();
    return;
  }
  pushHistory();
  // after Contents and Locations, before the schematic sheets
  let insertIdx = 0;
  while (state.sheets[insertIdx] && ['title', 'contents', 'locations'].includes(getPageType(state.sheets[insertIdx]))) insertIdx++;
  state.sheets.splice(insertIdx, 0, {
    id: Date.now(), pageType: 'cables', size: 'A3', orientation: 'landscape',
    title: 'Cable diagram', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = insertIdx;
  loadActiveSheet();
  scheduleAutosave();
}
