// ==========================================
// 33. WHERE A CABLE GOES (From / To)
// ==========================================
// For each core of a cable, follows the wire it was assigned to from the cable marker out to the devices at both ends:
// "K1:A1", "X1:3". A wire that runs on to another sheet (an open end with the same wire ID there) is followed across,
// so the answer is the real far end, not the edge of the page.
//
// Which end is "From": the left end for wires that run across the sheet, the top end for wires that run up and down,
// worked out from the side of the cable marker each end is on. It is a reading order, not a direction of current.
import { state, getPageType, getSchematicSheetNumber, getEffectiveLocationId } from './1_config_state.js';
import { pinAt, deviceName } from './28_wire_markers.js';
import { isTerminal, terminalDisplayText } from './11_terminal_blocks.js';
import { findOpenWireEndpoints } from './3_schematic_engine.js';

const MAX_HOPS = 4;
const TOL = 1.5;
const key = (x, y) => `${x},${y}`;

function onSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= TOL;
}

// The wire a core assignment was made on: by its own id, else whichever wire with that wire ID passes through the crossing.
function wireOfAssignment(sheet, ca) {
  const wires = sheet.wires || [];
  const byId = wires.find(w => w.id === ca.wireObjId);
  if (byId) return byId;
  return wires.find(w => {
    if (ca.wireId && String(w.wireId) !== String(ca.wireId)) return false;
    const p = w.points || [];
    for (let i = 0; i + 3 < p.length; i += 2) if (onSegment(ca.x, ca.y, p[i], p[i + 1], p[i + 2], p[i + 3])) return true;
    return false;
  }) || null;
}

// Everything electrically joined to `seed` on one sheet: the pins its wires end on, and ends that touch nothing.
function floodNet(sheetIdx, seeds, visited) {
  const sheet = state.sheets[sheetIdx];
  const wires = sheet.wires || [];
  const at = new Map();
  wires.forEach((w, i) => { const p = w.points || []; for (let k = 0; k + 1 < p.length; k += 2) { const kk = key(p[k], p[k + 1]); if (!at.has(kk)) at.set(kk, new Set()); at.get(kk).add(i); } });
  const pins = [], opens = [];
  const queue = seeds.slice();
  while (queue.length) {
    const w = queue.pop();
    const vid = `${sheetIdx}:${w.id}`;
    if (visited.has(vid)) continue;
    visited.add(vid);
    const p = w.points || [];
    if (p.length < 4) continue;
    [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]].forEach(([x, y]) => {
      const hit = pinAt(sheet, x, y);
      if (hit) { pins.push({ hit, sheetIdx }); return; }
      const others = [...(at.get(key(x, y)) || [])].filter(i => wires[i] !== w);
      if (!others.length) opens.push({ sheetIdx, x, y, wire: w });
    });
    // junctions anywhere along the wire pull in the wires that meet it
    for (let k = 0; k + 1 < p.length; k += 2) (at.get(key(p[k], p[k + 1])) || []).forEach(i => { if (!visited.has(`${sheetIdx}:${wires[i].id}`)) queue.push(wires[i]); });
  }
  return { pins, opens };
}

// Follows an open end onto other sheets that carry the same wire ID, up to MAX_HOPS sheets away.
function followOpen(open, visited, openMap, hops, out) {
  const id = open.wire.wireId;
  if (!id || hops >= MAX_HOPS) { out.loose.push(open); return; }
  const matches = (openMap.get(id) || []).filter(m => !(m.sheetIdx === open.sheetIdx && m.x === open.x && m.y === open.y) && !visited.has(`${m.sheetIdx}:${m.wire.id}`));
  if (!matches.length) { out.loose.push(open); return; }
  matches.forEach(m => {
    if (visited.has(`${m.sheetIdx}:${m.wire.id}`)) return;
    const net = floodNet(m.sheetIdx, [m.wire], visited);
    net.pins.forEach(p => out.pins.push(p));
    net.opens.forEach(o => { if (!(o.sheetIdx === m.sheetIdx && o.x === m.x && o.y === m.y)) followOpen(o, visited, openMap, hops + 1, out); });
  });
}

// `verts` are the wire's own corner points on one side of the cable marker, nearest the marker first and the far end last.
// Wires meeting it anywhere along that side (a T-junction) are followed too.
function traceSide(sheetIdx, wire, verts, openMap) {
  const sheet = state.sheets[sheetIdx];
  const out = { pins: [], loose: [] };
  const visited = new Set([`${sheetIdx}:${wire.id}`]);
  const touching = (x, y) => (sheet.wires || []).filter(w => w !== wire && (w.points || []).some((v, i) => i % 2 === 0 && v === x && w.points[i + 1] === y));
  const [ex, ey] = verts[verts.length - 1];
  const hit = pinAt(sheet, ex, ey);
  if (hit) out.pins.push({ hit, sheetIdx });
  const seeds = new Set();
  verts.forEach(([x, y]) => touching(x, y).forEach(w => seeds.add(w)));
  if (seeds.size) {
    const net = floodNet(sheetIdx, [...seeds], visited);
    net.pins.forEach(p => out.pins.push(p));
    net.opens.forEach(o => followOpen(o, visited, openMap, 1, out));
  }
  if (!hit && !touching(ex, ey).length) followOpen({ sheetIdx, x: ex, y: ey, wire }, visited, openMap, 0, out);
  return out;
}

// A terminal is always given with its block ("X1:3"), even where the sheet itself draws just the position beside it.
const fullDeviceName = (hit, sheet) => {
  if (isTerminal(hit.comp)) {
    const t = terminalDisplayText(hit.comp, sheet, { alwaysBlock: true });
    if (t) return { device: t, pin: '' };
  }
  return deviceName(hit, sheet);
};
const fullEndText = (hit, sheet) => { const n = fullDeviceName(hit, sheet); return n.pin ? `${n.device}:${n.pin}` : n.device; };

const describe = (side, homeSheetIdx) => {
  const seen = new Set(), list = [];
  side.pins.forEach(({ hit, sheetIdx }) => {
    let t = fullEndText(hit, state.sheets[sheetIdx]);
    if (sheetIdx !== homeSheetIdx) { const n = getSchematicSheetNumber(sheetIdx); if (n) t += ` (Sh.${n})`; }
    if (!seen.has(t)) { seen.add(t); list.push(t); }
  });
  return list;
};

// The same ends as separate device and pin, for tables: { device: 'K1', pin: 'A1', sheet: '', terminal: false }. A terminal is its block and its
// position ("X1" and "3"). `sheet` is the sheet number when the end is not on the sheet the cable marker is on.
const detail = (side, homeSheetIdx) => {
  const seen = new Set(), list = [];
  side.pins.forEach(({ hit, sheetIdx }) => {
    const n = fullDeviceName(hit, state.sheets[sheetIdx]);
    let device = n.device, pin = n.pin;
    if (!pin && device.includes(':')) { const i = device.lastIndexOf(':'); pin = device.slice(i + 1); device = device.slice(0, i); }
    const sheet = sheetIdx !== homeSheetIdx ? String(getSchematicSheetNumber(sheetIdx) || '') : '';
    const terminal = isTerminal(hit.comp);
    const k = `${device}|${pin}|${sheet}`;
    if (!seen.has(k)) { seen.add(k); list.push({ device, pin, sheet, terminal, loc: getEffectiveLocationId(hit.comp, state.sheets[sheetIdx]) || null }); }
  });
  return list;
};

// { [coreNumber]: { from: ['K1:A1'], to: ['X1:3'], fromPins: [{device, pin, sheet}], toPins: [...] } } for one cable.
export function traceCableCores(cable, openMap = findOpenWireEndpoints()) {
  const result = {};
  state.sheets.forEach((sheet, sheetIdx) => {
    if (getPageType(sheet) !== 'schematic') return;
    (sheet.cableMarkers || []).forEach(marker => {
      if (marker.kind === 'connector' || String(marker.cableId) !== String(cable.id)) return;
      const trunkVertical = Math.abs(marker.x2 - marker.x1) < Math.abs(marker.y2 - marker.y1);   // wires run across the sheet
      (marker.coreAssignments || []).forEach(ca => {
        if (result[ca.coreNumber]) return;
        const wire = wireOfAssignment(sheet, ca);
        const p = wire && wire.points;
        if (!p || p.length < 4) return;
        // The corners either side of where the marker crosses the wire.
        const corners = []; for (let i = 0; i + 1 < p.length; i += 2) corners.push([p[i], p[i + 1]]);
        let seg = 0;
        for (let i = 0; i + 1 < corners.length; i++) if (onSegment(ca.x, ca.y, corners[i][0], corners[i][1], corners[i + 1][0], corners[i + 1][1])) { seg = i; break; }
        let sideA = corners.slice(0, seg + 1).reverse(), sideB = corners.slice(seg + 1);   // nearest the marker first
        const endA = sideA[sideA.length - 1], endB = sideB[sideB.length - 1];
        const first = trunkVertical ? endA[0] <= endB[0] : endA[1] <= endB[1];
        if (!first) [sideA, sideB] = [sideB, sideA];
        const from = traceSide(sheetIdx, wire, sideA, openMap), to = traceSide(sheetIdx, wire, sideB, openMap);
        result[ca.coreNumber] = { from: describe(from, sheetIdx), to: describe(to, sheetIdx), fromPins: detail(from, sheetIdx), toPins: detail(to, sheetIdx), fromLoose: from.loose.length, toLoose: to.loose.length };
      });
    });
  });
  return result;
}

// "K1:A1,A2 · X1:3,4": connections grouped by device so a cable to one device reads as one entry.
export function groupConnections(list) {
  const groups = new Map();
  list.forEach(t => {
    const m = /^([^:()]+):([^()]+?)(\s\(Sh\.\d+\))?$/.exec(t);
    const dev = m ? m[1] + (m[3] || '') : t;
    if (!groups.has(dev)) groups.set(dev, []);
    if (m) groups.get(dev).push(m[2]);
  });
  return [...groups.entries()].map(([dev, pins]) => {
    const sheet = /\s\(Sh\.\d+\)$/.exec(dev);
    const name = sheet ? dev.slice(0, sheet.index) : dev;
    return pins.length ? `${name}:${pins.join(',')}${sheet ? sheet[0] : ''}` : dev;
  });
}

// "K1" or "X1": just the devices, for the summary columns (the pins are shown on each core).
export function deviceNames(list) {
  const seen = new Set(), out = [];
  list.forEach(t => {
    const sheet = /\s\(Sh\.\d+\)$/.exec(t);
    const base = sheet ? t.slice(0, sheet.index) : t;
    const dev = base.includes(':') ? base.slice(0, base.lastIndexOf(':')) : base;
    const label = dev + (sheet ? sheet[0] : '');
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  });
  return out;
}

// One cable end, grouped by device so a cable that lands on one device reads as one entry with its pins:
// [{ device: '4U1', sheet: '', terminal: false, pins: ['U', 'V', 'W', 'PE'] }]. A terminal block is one entry too, with its positions.
export function groupEnds(entries) {
  const groups = new Map();
  (entries || []).forEach(e => {
    const k = `${e.device}|${e.sheet || ''}`;
    if (!groups.has(k)) groups.set(k, { device: e.device, sheet: e.sheet || '', terminal: !!e.terminal, pins: [] });
    const g = groups.get(k);
    if (e.pin && !g.pins.includes(e.pin)) g.pins.push(e.pin);
  });
  return [...groups.values()];
}
