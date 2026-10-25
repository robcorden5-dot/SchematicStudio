// ==========================================
// 43. TERMINAL SIDES AND PACKING
// ==========================================
// A DIN-rail terminal has two connection points per level: the wire from inside the panel goes on one side and the wire
// going out to the field on the other. If every connection is given a terminal of its own, a net that has 12 internal and
// 6 external connections uses 18 positions when the strip only needs 12 - and the same for the other way round.
//
// Each terminal symbol has a SIDE (comp.side: 'internal' | 'external', or absent = automatic). This module:
//   1. works out the automatic side: a connection whose wire goes to equipment (or into a location boundary) in a different
//      location from the block, or whose wire is a core of a cable, is external; everything else is internal. Locations are a
//      Pro feature; without them only cables count and the side can be set by hand.
//   2. PACKS a block: where a net has an internal connection and an external one on terminals of the same kind and level, the
//      external symbol moves onto the internal one's terminal (the two sides of one screw), the position it leaves empty is
//      closed up, and the strip is renumbered. Double and triple level terminals work the same way, level by level.
//
// The rules are here and have no DOM, so they can be tested on their own. The buttons live in 15_terminal_block_manager.js.

import { state, getEffectiveLocationId, getPinsForType, flipSX, flipSY, findLocationById } from './1_config_state.js';
import { findOpenWireEndpoints } from './3_schematic_engine.js';
import * as TB from './11_terminal_blocks.js';

const sameLoc = (a, b) => (a === undefined || a === null || a === '' ? null : String(a)) === (b === undefined || b === null || b === '' ? null : String(b));

// ---- the automatic side ----

function pinPoints(comp) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return getPinsForType(comp.type).map(p => ({
    x: comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin),
    y: comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos)
  }));
}

// Everything on the drawn net that starts at (x, y) on this sheet: its wires, and the equipment (not terminals, not
// documentation) whose pins sit on it. The net stops at any other terminal - that is where it hands over to its own symbol.
const NET_TOL = 2.5;   // drawn coordinates this close count as the same point (a terminal or wire end a hair off the grid still joins)

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
}
function pointTouchesWire(w, x, y) {
  const pts = w.points || [];
  if (pts.length === 2) return Math.hypot(pts[0] - x, pts[1] - y) <= NET_TOL;
  for (let i = 0; i + 3 < pts.length; i += 2) if (distToSegment(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= NET_TOL) return true;
  return false;
}
// The wires that meet a terminal's pin, as arms leading away from it. A wire that ends on the pin is one arm. A wire that runs
// straight THROUGH the pin (drawn before the terminal was put on it, so it was never split) is cut there into two arms, one
// each way: the wire above and the wire below are different connections, and must not be read as one.
function armsAt(sheet, x, y) {
  const arms = [], cut = [];
  (sheet.wires || []).forEach(w => {
    const pts = w.points || [];
    if (pts.length < 4) return;
    if (Math.hypot(pts[0] - x, pts[1] - y) <= NET_TOL || Math.hypot(pts[pts.length - 2] - x, pts[pts.length - 1] - y) <= NET_TOL) { arms.push(w); return; }
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (distToSegment(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) > NET_TOL) continue;
      const before = pts.slice(0, i + 2).concat([x, y]);
      const after = [x, y].concat(pts.slice(i + 2));
      arms.push({ id: null, wireId: w.wireId, points: before }, { id: null, wireId: w.wireId, points: after });
      cut.push(w);
      return;
    }
  });
  return { arms, cut };
}

// A wire drawn before a terminal was put on it runs straight through that terminal's pin. For working out what a terminal is
// connected to, the other terminals' pins are walls: such a wire is cut there into pieces, so one terminal does not read
// the connections that belong to the terminal next to it.
function cutAtPins(w, pins) {
  const pts = w.points || [];
  if (pts.length < 6 && !pins.length) return [w];
  const pieces = [];
  let cur = [pts[0], pts[1]], cuts = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const hits = [];
    pins.forEach(pn => {
      const t = len2 === 0 ? 0 : ((pn.x - x1) * dx + (pn.y - y1) * dy) / len2;
      if (t < 0 || t >= 1 - 1e-6) return;
      if (i === 0 && t * Math.sqrt(len2) <= NET_TOL) return;                     // the wire's own start
      if (distToSegment(pn.x, pn.y, x1, y1, x2, y2) > NET_TOL) return;
      if ((1 - t) * Math.sqrt(len2) <= NET_TOL && i + 4 >= pts.length) return;   // the wire's own end
      hits.push({ t, pn });
    });
    hits.sort((a, b) => a.t - b.t).forEach(h => { cur.push(h.pn.x, h.pn.y); pieces.push({ id: null, wireId: w.wireId, points: cur }); cur = [h.pn.x, h.pn.y]; cuts++; });
    cur.push(x2, y2);
  }
  if (!cuts) return [w];
  pieces.push({ id: null, wireId: w.wireId, points: cur });
  return pieces.filter(pc => pc.points.length >= 4);
}

function wireEnds(w) {
  const pts = w.points || [];
  return pts.length >= 4 ? [{ x: pts[0], y: pts[1] }, { x: pts[pts.length - 2], y: pts[pts.length - 1] }] : [];
}

// Everything on the drawn net that starts at (x, y) on this sheet: its wires, and the equipment (not terminals, not
// documentation) whose pins sit on it. The net stops at any other terminal - that is where it hands over to its own symbol.
// Points are matched within a couple of pixels, and a wire that ends part-way along another wire (a T) joins it.
function netEquipment(sheet, x, y, fromWire, exclude, ownKey) {
  // Walls: the other terminals of the SAME block (each is its own connection). A terminal of another block is not a wall: a
  // wire runs on through it (field wiring through a junction strip, say) to the equipment beyond.
  const sameBlock = (c) => !ownKey || TB.blockKey(c.label, TB.terminalLocationId(c, sheet)) === ownKey;
  const otherPins = (sheet.components || []).filter(c => TB.isTerminal(c) && sameBlock(c) && Math.hypot(c.x - x, c.y - y) > NET_TOL).map(c => ({ x: c.x, y: c.y }));
  const skip = new Set(exclude || []);
  const wires = [];
  (sheet.wires || []).forEach(w => { if (!skip.has(w)) cutAtPins(w, otherPins).forEach(pc => wires.push(pc)); });
  if (fromWire) {
    const pieces = cutAtPins(fromWire, otherPins);
    if (pieces.length > 1) fromWire = pieces.find(pc => (pc.points || []).some((v, k) => k % 2 === 0 && Math.hypot(v - x, pc.points[k + 1] - y) <= NET_TOL)) || pieces[0];
  }
  const allOthers = (sheet.components || []).filter(c => TB.isTerminal(c) && Math.hypot(c.x - x, c.y - y) > NET_TOL);
  const others = allOthers.filter(sameBlock);
  const atOtherTerminal = (px, py) => others.some(c => Math.hypot(c.x - px, c.y - py) <= NET_TOL);
  const seenWires = new Set(), netWires = [], points = [{ x, y }];
  // fromWire: follow just that one wire away from the terminal, not the wire on its other side
  const nearOwn = (px, py) => !!fromWire && Math.hypot(px - x, py - y) <= NET_TOL;
  if (fromWire) {
    points.length = 0; seenWires.add(fromWire); netWires.push(fromWire);
    (exclude || []).forEach(w => seenWires.add(w));   // the wire this arm was cut from, so the other arm is not pulled back in
    const fp = fromWire.points || [];
    for (let i = 0; i + 1 < fp.length; i += 2) if (!nearOwn(fp[i], fp[i + 1])) points.push({ x: fp[i], y: fp[i + 1] });
  }
  let grew = true;
  while (grew) {
    grew = false;
    wires.forEach(w => {
      if (seenWires.has(w)) return;
      const ends = wireEnds(w);
      // joins if a net point lies on it, or one of its own ends lies on a wire already in the net
      const joins = points.some(p => !atOtherTerminal(p.x, p.y) && !nearOwn(p.x, p.y) && pointTouchesWire(w, p.x, p.y)) ||
        ends.some(e => !nearOwn(e.x, e.y) && !atOtherTerminal(e.x, e.y) && netWires.some(n => pointTouchesWire(n, e.x, e.y)));
      if (!joins) return;
      seenWires.add(w); netWires.push(w); grew = true;
      const pts = w.points || [];
      for (let i = 0; i + 1 < pts.length; i += 2) if (!nearOwn(pts[i], pts[i + 1])) points.push({ x: pts[i], y: pts[i + 1] });
    });
  }
  const equipment = [], pinsHit = new Map();
  (sheet.components || []).forEach(c => {
    if (TB.isTerminal(c) || TB.isTerminalTableSymbol(c.type)) return;
    const pp = pinPoints(c), defs = getPinsForType(c.type) || [];
    const hit = [];
    pp.forEach((p, i) => { if (points.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= NET_TOL)) hit.push(defs[i] && defs[i].id !== undefined && defs[i].id !== null && defs[i].id !== '' ? String(defs[i].id) : String(i + 1)); });
    if (hit.length) { equipment.push(c); pinsHit.set(c, hit); }
  });
  // other terminals the net runs into (it stops there): where this wire goes next, for the origin / destination text
  const terminals = allOthers.filter(c => points.some(q => Math.hypot(q.x - c.x, q.y - c.y) <= NET_TOL));
  return { equipment, netWires, points, pinsHit, terminals };
}

// Location boundaries (the Draw -> Location Boundary rectangles): the locations whose rectangle the net's wires run into.
// A wire that crosses into the field, with nothing drawn on it yet, is still a connection to the field. A boundary the
// terminal itself sits inside is left out - that is the terminal's own surroundings, not somewhere the wire goes to.
function segmentTouchesRect(x1, y1, x2, y2, r) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const edges = [[-dx, x1 - r.minX], [dx, r.maxX - x1], [-dy, y1 - r.minY], [dy, r.maxY - y1]];
  for (const [pp, qq] of edges) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function boundaryLocations(sheet, netWires, ownX, ownY) {
  const out = [];
  (sheet.shapes || []).forEach(s => {
    if (!s || !s.locationId || s.type !== 'rect') return;
    const r = { minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2), minY: Math.min(s.y1, s.y2), maxY: Math.max(s.y1, s.y2) };
    if (ownX >= r.minX && ownX <= r.maxX && ownY >= r.minY && ownY <= r.maxY) return;
    const reached = netWires.some(w => {
      const pts = w.points || [];
      for (let i = 0; i + 3 < pts.length; i += 2) if (segmentTouchesRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r)) return true;
      return false;
    });
    if (reached) out.push(s.locationId);
  });
  return out;
}

// Cables: the cable markers (Insert -> Cable) the net's wires run through. A wire that is a core of a cable is the
// cabling out to the equipment, which is the external side. A core is matched by the wire it was drawn across (its own id), or
// failing that by the point it crosses the marker line.
function pointOnWire(w, x, y) {
  const pts = w.points || [];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    if (Math.hypot(x1 + t * dx - x, y1 + t * dy - y) < 3) return true;
  }
  return false;
}

function cablesOnNet(sheet, netWires, cores) {
  const names = [];
  (sheet.cableMarkers || []).forEach(m => {
    const cable = (state.cables || []).find(c => String(c.id) === String(m.cableId));
    if (!cable) return;                                  // a connector marker, not a cable
    const hits = (m.coreAssignments || []).filter(ca =>
      netWires.some(w => (ca.wireObjId !== undefined && ca.wireObjId !== null && w.id === ca.wireObjId) || (ca.x !== undefined && pointOnWire(w, ca.x, ca.y))));
    if (hits.length && !names.includes(cable.designator || 'a cable')) names.push(cable.designator || 'a cable');
    if (cores) hits.forEach(ca => { const c = `${cable.designator || 'cable'}/${ca.coreNumber}`; if (!cores.includes(c)) cores.push(c); });
  });
  return names;
}

// Everything on the wire from a terminal at (x, y) that says which side of the block it is: the locations of the equipment it
// goes to and of the location boundaries it runs into, and the cables it runs through.
function evidenceAt(sheet, x, y, fromWire, exclude, ownKey) {
  const net = netEquipment(sheet, x, y, fromWire, exclude, ownKey);
  const cores = [];
  const cableNames = cablesOnNet(sheet, net.netWires, cores);
  return {
    cores,
    dests: net.equipment.map(c => ({ ref: c.label || c.type, loc: getEffectiveLocationId(c, sheet), pins: net.pinsHit.get(c) || [] })).concat(net.equipment.length ? [] :
      net.terminals.map(c => ({ ref: `${TB.blockDisplayName(String(c.label || 'X').trim(), TB.terminalLocationId(c, sheet))}:${c.position}`, pins: [''], termKey: TB.blockKey(c.label, TB.terminalLocationId(c, sheet)) }))),
    locs: net.equipment.map(c => ({ loc: getEffectiveLocationId(c, sheet), what: c.label || c.type })).concat(
      boundaryLocations(sheet, net.netWires, x, y).map(loc => ({ loc, what: 'a location boundary' }))),
    cables: cableNames,
    wireCount: net.netWires.length,
    wireIds: Array.from(new Set(net.netWires.map(w => String(w.wireId || '').trim()).filter(Boolean)))
  };
}

function farEvidence(comp, sheet, fromWire, exclude) {
  const ownKey = TB.blockKey(comp.label, TB.terminalLocationId(comp, sheet));
  const here = evidenceAt(sheet, comp.x, comp.y, fromWire, exclude, ownKey);
  if (here.locs.length || here.cables.length) return here;
  // nothing on this sheet: the wire runs off it, so follow the wire with the same ID on the other sheet(s)
  const sheetIdx = (state.sheets || []).indexOf(sheet);
  if (!here.wireIds.length) return here;
  const open = findOpenWireEndpoints();
  const out = { locs: [], cables: [], cores: here.cores.slice(), dests: here.dests.slice(), wireIds: here.wireIds, wireCount: here.wireCount };
  here.wireIds.forEach(id => (open.get(id) || []).forEach(m => {
    if (m.sheetIdx === sheetIdx) return;
    const other = state.sheets[m.sheetIdx];
    if (!other) return;
    const ev = evidenceAt(other, m.x, m.y, null, null, ownKey);
    out.locs.push(...ev.locs); ev.cables.forEach(n => { if (!out.cables.includes(n)) out.cables.push(n); });
    ev.cores.forEach(n => { if (!out.cores.includes(n)) out.cores.push(n); }); out.dests.push(...ev.dests);
  }));
  return out;
}

const locName = (id) => { const l = findLocationById(id); return l && l.abbreviation ? `+${l.abbreviation}` : 'no location'; };

// { side, reason }: which side a terminal's connection is on when its Side is Automatic, and why - the reason is shown in the
// Terminal Blocks window so the choice can be checked. A different location (equipment, or a location boundary the wire runs
// into) means external; so does a wire that is a core of a cable; anything else is internal.
function decide(ev, blockLoc) {
  const different = ev.locs.length > 0 && !ev.locs.some(e => sameLoc(e.loc, blockLoc));
  if (different) {
    const first = ev.locs[0];
    return { side: TB.SIDE_EXTERNAL, reason: `it goes to ${first.what} in ${locName(first.loc)}, not in the block's location (${locName(blockLoc)})` };
  }
  if (ev.cables.length) return { side: TB.SIDE_EXTERNAL, reason: `its wire is a core of cable ${ev.cables.join(', ')}` };
  if (ev.locs.length) return { side: TB.SIDE_INTERNAL, reason: `it goes to equipment in the same location as the block (${locName(blockLoc)}), and not through a cable` };
  return { side: TB.SIDE_INTERNAL, reason: ev.wireCount === 0 ? 'no wire reaches this terminal (nothing is drawn on its pin), so there is nothing to say it is external' : 'nothing on its wire says it is external (no equipment in another location, no location boundary, no cable)' };
}

// A terminal drawn as ONE symbol with a wire on each side of it (the panel wire above, the cable below) is a feed-through:
// it carries an internal and an external connection at once. Each wire that ends on its pin is judged on its own; when they
// come out on different sides the result is { internal: { wireIds, reason }, external: { wireIds, reason } }, else null.
export function endsOf(comp, sheet) {
  if (!TB.isTerminal(comp) || TB.terminalSideSetting(comp) !== TB.SIDE_AUTO) return null;
  const blockLoc = TB.terminalLocationId(comp, sheet);
  const { arms: touching, cut } = armsAt(sheet, comp.x, comp.y);
  if (touching.length < 2) return null;
  const out = {};
  touching.forEach(w => {
    const r = decide(farEvidence(comp, sheet, w, cut), blockLoc);
    const id = String(w.wireId === undefined || w.wireId === null ? '' : w.wireId).trim();
    const e = out[r.side] || (out[r.side] = { wireIds: [], reason: r.reason });
    if (id && !e.wireIds.includes(id)) e.wireIds.push(id);
  });
  return out.internal && out.external ? out : null;
}

export function analyseSide(comp, sheet) {
  if (!TB.isTerminal(comp)) return { side: TB.SIDE_INTERNAL, reason: '' };
  const blockLoc = TB.terminalLocationId(comp, sheet);
  const ends = endsOf(comp, sheet);
  if (ends) return { side: TB.SIDE_EXTERNAL, ends, reason: `a feed-through: one wire is internal (${ends.internal.reason}), the other external (${ends.external.reason})` };
  return decide(farEvidence(comp, sheet), blockLoc);
}

// Where a terminal's wires come from and go to, for the terminal table: { internal: [text], external: [text] }. Each text is
// the cable core the wire runs in (W28/1) and the equipment pins it reaches (S11:A1, SK-5ES1:3). Wires that end on the pin
// are judged one by one, so a feed-through gives one entry on each side.
function destText(ev, ownKey, blockLoc, always) {
  const seen = [];
  (ev.dests || []).filter(d => !(d.termKey && d.termKey === ownKey)).forEach(d => d.pins.forEach(pin => { const lp = d.loc !== undefined && d.loc !== null && d.loc !== '' && (always || !sameLoc(d.loc, blockLoc)) ? locName(d.loc).replace(/^no location$/, '') : '';
    const t = `${lp ? lp + '-' : ''}${d.ref}${pin ? ':' + pin : ''}`; if (!seen.includes(t)) seen.push(t); }));
  const devs = seen.length > 3 ? `${seen.slice(0, 3).join(', ')} +${seen.length - 3}` : seen.join(', ');
  const cores = (ev.cores || []).join(', ');
  return cores && devs ? `${cores}: ${devs}` : (cores || devs);
}
export function destinationsOf(comp, sheet) {
  const out = { internal: [], external: [] };
  if (!TB.isTerminal(comp)) return out;
  const blockLoc = TB.terminalLocationId(comp, sheet);
  const setting = TB.terminalSideSetting(comp);
  const ownKey = TB.blockKey(comp.label, blockLoc);
  const { arms: touching, cut } = armsAt(sheet, comp.x, comp.y);
  const add = (side, text) => { if (text && !out[side].includes(text)) out[side].push(text); };
  // a jumper (terminal link) to a neighbouring terminal is an internal connection
  (sheet.terminalLinks || []).forEach(l => {
    const otherId = l.a === comp.id ? l.b : (l.b === comp.id ? l.a : null);
    const o = otherId === null ? null : (sheet.components || []).find(c => c.id === otherId);
    if (o) add('internal', `link ${TB.blockDisplayName(String(o.label || 'X').trim(), TB.terminalLocationId(o, sheet))}:${o.position}`);
  });
  if (touching.length < 2) {
    { const sd = TB.terminalSideOf(comp, sheet); add(sd, destText(farEvidence(comp, sheet), ownKey, blockLoc, sd === TB.SIDE_EXTERNAL)); }
    return out;
  }
  touching.forEach(w => {
    const ev = farEvidence(comp, sheet, w, cut);
    const sd = setting === TB.SIDE_AUTO ? decide(ev, blockLoc).side : setting;
    add(sd, destText(ev, ownKey, blockLoc, sd === TB.SIDE_EXTERNAL));   // the field side always names where the equipment is
  });
  return out;
}

export function autoSideOf(comp, sheet) { return analyseSide(comp, sheet).side; }

TB.setAutoSideResolver(autoSideOf);
TB.setAutoEndsResolver(endsOf);
TB.setDestinationResolver(destinationsOf);

// ---- packing ----

const netKeyOf = (ids) => Array.from(new Set(ids.map(v => String(v).trim()).filter(Boolean))).sort(TB.compareDesignators).join('|');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What packing a block would do, without doing it:
//   { ok, block, moves[], pairs, before, after, saved, nets[], start }
//   moves: one entry per symbol that changes place: { comp, sheet, from: {position, level}, to: {position, level}, paired }
//   before / after: how many physical terminals (positions) the block uses now / after packing.
//   nets: for the preview, one line per net that was paired: { net, internal, external, terminals }
export function planPack(key, { closeGaps = true } = {}) {
  const block = TB.findTerminalBlock(key);
  if (!block) return { ok: false, error: 'That block no longer exists.' };
  TB.refreshAllTerminalWireIds();

  // every slot (position and level) with its symbols
  const slots = new Map();
  const positionInfo = new Map();   // position -> { levels, modelKey }
  const placement = new Map();   // comp.id -> { position, level, paired }
  const maxPos = Math.max(0, ...block.terminals.map(t => Number(t.comp.position) || 0));
  let extraN = 0, splits = 0;
  const seenOnSide = new Map();  // `${slot}|${side}` -> how many symbols are already on that side of that slot
  const hostPos = new Map();
  block.terminals.slice().sort((a, b) => (a.comp.position - b.comp.position) || (TB.levelOf(a.comp) - TB.levelOf(b.comp))).forEach(({ comp, sheet, sheetIndex }) => {
    const level = TB.levelOf(comp);
    const through = !!TB.terminalEndsOf(comp, sheet);
    const side = through ? 'both' : TB.terminalSideOf(comp, sheet);
    let position = comp.position;
    // a screw has one connection on each side: a second symbol on the same side of the same position (two external cables
    // in one terminal, say) goes to a terminal of its own
    const sideKeys = side === 'both' ? [TB.SIDE_INTERNAL, TB.SIDE_EXTERNAL] : [side];
    const nSeen = Math.max(...sideKeys.map(k => seenOnSide.get(`${comp.position}.${level}|${k}`) || 0));
    sideKeys.forEach(k => seenOnSide.set(`${comp.position}.${level}|${k}`, nSeen + 1));
    if (nSeen > 0) {
      extraN++; splits++;
      position = closeGaps ? Number(comp.position) + 0.001 * extraN : maxPos + extraN;
      placement.set(comp.id, { position, level, paired: false });
    }
    const id = `${position}.${level}`;
    if (!slots.has(id)) slots.set(id, { id, position, level, symbols: [], wires: [] });
    const slot = slots.get(id);
    slot.symbols.push({ comp, sheet, sheetIndex, side });
    (comp.wireIds || []).forEach(w => slot.wires.push(w));
    if (!positionInfo.has(position)) positionInfo.set(position, { levels: 1, modelKey: '' });
    const info = positionInfo.get(position);
    info.levels = Math.max(info.levels, TB.levelsOf(comp));
    if (!info.modelKey && comp.modelId !== undefined && comp.modelId !== null && comp.modelId !== '') info.modelKey = String(comp.modelId);
  });

  // slots that hold a single side of a wired net can be paired with one on the opposite side
  const groups = new Map();
  slots.forEach(slot => {
    const sides = new Set(slot.symbols.map(s => s.side));
    slot.pe = slot.symbols.some(s => TB.isPETerminal(s.comp));
    slot.net = netKeyOf(slot.wires);
    if (sides.size !== 1 || sides.has('both') || slot.symbols.length !== 1 || !slot.net) return;   // paired already, odd, or no wire to go by
    slot.side = Array.from(sides)[0];
    const info = positionInfo.get(slot.position);
    const gk = [info.levels, slot.level, info.modelKey, slot.pe ? 'pe' : '', slot.net].join('~');
    if (!groups.has(gk)) groups.set(gk, { net: slot.net, internal: [], external: [] });
    groups.get(gk)[slot.side === TB.SIDE_EXTERNAL ? 'external' : 'internal'].push(slot);
  });

  const pairedNets = new Map();
  groups.forEach(g => {
    g.internal.sort((a, b) => a.position - b.position);
    g.external.sort((a, b) => a.position - b.position);
    const n = Math.min(g.internal.length, g.external.length);
    for (let i = 0; i < n; i++) {
      const host = g.internal[i], guest = g.external[i];
      placement.set(guest.symbols[0].comp.id, { position: host.position, level: host.level, paired: true });
      placement.set(host.symbols[0].comp.id, { position: host.position, level: host.level, paired: true });
    }
    if (n) {
      const e = pairedNets.get(g.net) || { net: g.net, internal: 0, external: 0, terminals: 0 };
      e.internal += g.internal.length; e.external += g.external.length; e.terminals += Math.max(g.internal.length, g.external.length);
      pairedNets.set(g.net, e);
    }
  });

  // where every symbol ends up before the strip is closed up
  const finalOf = (t) => placement.get(t.comp.id) || { position: t.comp.position, level: TB.levelOf(t.comp), paired: false };
  const occupied = new Set(block.terminals.map(t => finalOf(t).position));
  const originalPositions = Array.from(new Set(block.terminals.map(t => t.comp.position))).sort((a, b) => a - b);
  const start = originalPositions.length ? originalPositions[0] : 1;
  const renumber = new Map();
  Array.from(occupied).sort((a, b) => a - b).forEach((p, i) => renumber.set(p, closeGaps ? start + i : Math.round(p)));
  if (closeGaps && start + occupied.size - 1 > TB.MAX_TERMINAL_POSITION) return { ok: false, error: `That would need positions up to ${start + occupied.size - 1}, and the highest position is ${TB.MAX_TERMINAL_POSITION}.` };

  const moves = [];
  block.terminals.forEach(t => {
    const f = finalOf(t);
    const to = { position: renumber.get(f.position), level: f.level };
    const from = { position: t.comp.position, level: TB.levelOf(t.comp) };
    if (from.position !== to.position || from.level !== to.level || f.paired) moves.push({ comp: t.comp, sheet: t.sheet, sheetIndex: t.sheetIndex, from, to, paired: f.paired });
  });
  const pairs = Array.from(placement.values()).filter(p => p.paired).length / 2;
  return {
    ok: true, block, moves, pairs, start, splits,
    before: originalPositions.length, after: occupied.size, saved: originalPositions.length - occupied.size,
    nets: Array.from(pairedNets.values()).sort((a, b) => TB.compareDesignators(a.net, b.net)),
    changed: moves.filter(m => m.from.position !== m.to.position || m.from.level !== m.to.level).length
  };
}

// Does it: moves the symbols, fixes the sides of every paired symbol at what they are now (so a later change in the
// automatic rule cannot put two symbols on one side of a screw), and renumbers. Returns the plan.
export function applyPack(plan) {
  if (!plan || !plan.ok) return plan;
  plan.moves.forEach(m => {
    m.comp.position = m.to.position;
    if (m.to.level > 1) m.comp.level = m.to.level; else delete m.comp.level;
    if (m.paired) TB.setTerminalSide(m.comp, TB.terminalSideOf(m.comp, m.sheet));
  });
  return plan;
}

export function packBlock(key, options) { return applyPack(planPack(key, options)); }

// Every block at once. { ok, plans[], before, after, saved, changed }
export function planPackAll(options) {
  const plans = TB.listTerminalBlocks().map(b => planPack(b.key, options)).filter(p => p.ok);
  return {
    ok: true, plans,
    before: plans.reduce((n, p) => n + p.before, 0), after: plans.reduce((n, p) => n + p.after, 0),
    saved: plans.reduce((n, p) => n + p.saved, 0), pairs: plans.reduce((n, p) => n + p.pairs, 0),
    changed: plans.reduce((n, p) => n + p.changed, 0), splits: plans.reduce((n, p) => n + (p.splits || 0), 0)
  };
}
export function packAllBlocks(options) { const all = planPackAll(options); all.plans.forEach(applyPack); return all; }

// The lines shown before anything is changed.
export function describePlan(plan, limit = 8) {
  const lines = plan.nets.slice(0, limit).map(n => `${n.net}: ${n.internal} internal + ${n.external} external → ${plural(n.terminals, 'terminal')}`);
  if (plan.splits) lines.unshift(`${plural(plan.splits, 'extra connection')} on a side already used at the same position moved to ${plan.splits === 1 ? 'a terminal' : 'terminals'} of ${plan.splits === 1 ? 'its' : 'their'} own`);
  if (plan.nets.length > limit) lines.push(`… and ${plan.nets.length - limit} more net${plan.nets.length - limit === 1 ? '' : 's'}`);
  return lines;
}

window.packTerminalBlock = packBlock;
