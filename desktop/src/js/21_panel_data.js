// ==========================================
// 21. PANEL LAYOUT (rules)
// ==========================================
// Pure logic behind the Panel Layout sheet: the footprint library (drawings
// imported from DXF), the layout a panel sheet keeps, placing, the overlap and
// outside-the-plate checks, and the list of schematic parts waiting to be placed.
// No page access, so it is tested on its own; 22_panel_layout.js is the sheet
// and the dock.
//
// Everything on a panel sheet is stored in millimetres from the CENTRE of the
// backplate, y pointing down. The sheet scale only decides how big that looks
// on the paper, so changing the scale or the paper size never moves a part.
//
// A footprint: { id, name, kind: 'plate' | 'part', make, modelNo, description,
//                width, height (mm), lines: [[x1, y1, x2, y2, ...], ...] (mm from its centre) }
// A panel:     { plateId, scale (null = automatic), snap (mm), items: [
//                { id, footprintId, x, y, rotation, link: { sheetId, compId } | null } ] }

export const PANEL_FILE_FORMAT = 'schematicstudio-panel-footprints';
export const MAX_IMPORT_FOOTPRINTS = 200;
export const FOOTPRINT_NAME_MAX = 60;
export const PX_PER_MM = 96 / 25.4;              // a sheet unit is one pixel at 96 dpi (an A3 sheet is 1587 units wide)
export const PANEL_SCALES = [1, 2, 2.5, 4, 5, 10, 20];   // 1 : n
export const SNAP_OPTIONS = [0, 1, 2.5, 5, 10];

const cleanText = (v) => (v === undefined || v === null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const round2 = (v) => Math.round(v * 100) / 100;

// ---- footprints ----
export function cleanFootprint(item) {
  if (!item || typeof item !== 'object') return null;
  const name = cleanText(item.name);
  const width = Number(item.width), height = Number(item.height);
  if (!name || name.length > FOOTPRINT_NAME_MAX || !(width > 0) || !(height > 0) || width > 20000 || height > 20000) return null;
  if (!Array.isArray(item.lines) || !item.lines.length) return null;
  const lines = [];
  for (const l of item.lines) {
    if (!Array.isArray(l) || l.length < 4 || l.length % 2 !== 0 || l.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
    lines.push(l);
  }
  return {
    name, kind: item.kind === 'plate' ? 'plate' : 'part',
    make: cleanText(item.make), modelNo: cleanText(item.modelNo), description: cleanText(item.description),
    width: round2(width), height: round2(height), lines, source: cleanText(item.source),
    rail: cleanRail(item.rail, width, height, item.kind === 'plate' ? 'plate' : 'part')
  };
}

// Where a part clips onto a DIN rail: { axis: 'h' | 'v', pos } - the rail runs left-right ('h') or
// up-down ('v') as the part is drawn, and its centreline is `pos` mm from the part's top (h) or
// left edge (v). null for a part that does not mount on a rail (and always for a backplate).
export function cleanRail(rail, width, height, kind) {
  if (kind === 'plate' || !rail || typeof rail !== 'object' || (rail.axis !== 'h' && rail.axis !== 'v')) return null;
  const pos = Number(rail.pos), max = rail.axis === 'h' ? height : width;
  if (!Number.isFinite(pos)) return null;
  return { axis: rail.axis, pos: round2(Math.max(0, Math.min(max, pos))) };
}

const nextId = (list) => list.reduce((mx, m) => Math.max(mx, Number(m.id) || 0), Date.now()) + 1;

export function addFootprint(list, fields) {
  const fp = cleanFootprint(fields);
  if (!fp) return { ok: false, error: 'That footprint needs a name (60 characters at most) and a drawing.' };
  if (list.some(m => m.name.toLowerCase() === fp.name.toLowerCase())) return { ok: false, error: 'A footprint called "' + fp.name + '" is already in the library.' };
  const full = { id: nextId(list), ...fp };
  list.push(full);
  return { ok: true, footprint: full };
}

// Edits the details of a footprint (not its drawing).
export function updateFootprintDetails(list, id, fields) {
  const fp = list.find(m => String(m.id) === String(id));
  if (!fp) return { ok: false, error: 'That footprint is no longer in the library.' };
  const name = cleanText(fields.name);
  if (!name || name.length > FOOTPRINT_NAME_MAX) return { ok: false, error: 'Give the footprint a name (60 characters at most).' };
  if (list.some(m => m !== fp && m.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'A footprint called "' + name + '" is already in the library.' };
  fp.name = name;
  fp.kind = fields.kind === 'plate' ? 'plate' : 'part';
  fp.make = cleanText(fields.make); fp.modelNo = cleanText(fields.modelNo); fp.description = cleanText(fields.description);
  fp.rail = cleanRail(fields.rail, fp.width, fp.height, fp.kind);
  return { ok: true, footprint: fp };
}

export function footprintsInUse(sheets, id) {
  let n = 0;
  (sheets || []).forEach(s => {
    const p = s.panel; if (!p) return;
    if (String(p.plateId) === String(id)) n++;
    (p.items || []).forEach(it => { if (String(it.footprintId) === String(id)) n++; });
  });
  return n;
}

export function deleteFootprint(list, sheets, id) {
  const used = footprintsInUse(sheets, id);
  if (used) return { ok: false, error: `That footprint is used ${used} time${used === 1 ? '' : 's'} on panel sheets. Remove it from them first.` };
  const i = list.findIndex(m => String(m.id) === String(id));
  if (i < 0) return { ok: false, error: 'That footprint is no longer in the library.' };
  list.splice(i, 1);
  return { ok: true };
}

export function buildFootprintExport(list) {
  return {
    format: PANEL_FILE_FORMAT, version: 1,
    footprints: list.map(f => ({ name: f.name, kind: f.kind, make: f.make || '', modelNo: f.modelNo || '', description: f.description || '', width: f.width, height: f.height, lines: f.lines, source: f.source || '', rail: f.rail || null }))
  };
}

export function parseFootprintFile(data) {
  const list = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray(data.footprints) ? data.footprints : null);
  if (!list) return { ok: false, error: 'That file does not contain panel footprints.' };
  if (data && !Array.isArray(data) && data.format !== undefined && data.format !== PANEL_FILE_FORMAT) return { ok: false, error: 'That file is not a panel footprints file.' };
  if (list.length > MAX_IMPORT_FOOTPRINTS) return { ok: false, error: `That file has more than ${MAX_IMPORT_FOOTPRINTS} footprints, which is too many to import.` };
  const footprints = []; let skipped = 0; const seen = new Set();
  list.forEach(item => {
    const fp = cleanFootprint(item);
    if (!fp || seen.has(fp.name.toLowerCase())) { skipped++; return; }
    seen.add(fp.name.toLowerCase()); footprints.push(fp);
  });
  return { ok: true, footprints, skipped };
}

// Adds footprints without ever changing one already there: the same name and the same
// size is "already there"; the same name but a different drawing is added as "Name (2)".
export function mergeFootprints(list, footprints) {
  const result = { added: 0, renamed: 0, unchanged: 0 };
  footprints.forEach(fp => {
    const clash = list.find(x => x.name.toLowerCase() === fp.name.toLowerCase());
    if (clash && clash.width === fp.width && clash.height === fp.height && clash.lines.length === fp.lines.length) { result.unchanged++; return; }
    let name = fp.name;
    if (clash) {
      let n = 2;
      const taken = new Set(list.map(m => m.name.toLowerCase()));
      do { const suffix = ` (${n++})`; name = fp.name.slice(0, FOOTPRINT_NAME_MAX - suffix.length).trimEnd() + suffix; } while (taken.has(name.toLowerCase()));
    }
    if (addFootprint(list, { ...fp, name }).ok) { result.added++; if (clash) result.renamed++; }
  });
  return result;
}

// The footprint whose part number matches a component's (same make if both give one).
export function matchFootprint(footprints, modelNo, make) {
  const m = cleanText(modelNo).toLowerCase();
  if (!m) return null;
  const hits = footprints.filter(f => f.kind === 'part' && cleanText(f.modelNo).toLowerCase() === m);
  if (!hits.length) return null;
  const mk = cleanText(make).toLowerCase();
  return (mk && hits.find(f => cleanText(f.make).toLowerCase() === mk)) || hits[0];
}

// ---- panels ----
export function ensurePanel(sheet) {
  if (!sheet.panel || typeof sheet.panel !== 'object') sheet.panel = {};
  const p = sheet.panel;
  if (p.plateId === undefined) p.plateId = null;
  if (p.scale === undefined) p.scale = null;
  if (!Number.isFinite(p.snap)) p.snap = 1;
  if (!Array.isArray(p.items)) p.items = [];
  if (!Array.isArray(p.rails)) p.rails = [];
  if (!Array.isArray(p.ducts)) p.ducts = [];
  if (!Array.isArray(p.dims)) p.dims = [];
  return p;
}

export const normaliseRotation = (r) => ((Math.round((Number(r) || 0) / 90) * 90) % 360 + 360) % 360;

// The width and height an item takes up on the plate, whichever way round it is turned.
export function itemSize(item, fp) {
  const turned = normaliseRotation(item.rotation) % 180 === 90;
  return turned ? { w: fp.height, h: fp.width } : { w: fp.width, h: fp.height };
}

export function itemRect(item, fp) {
  const { w, h } = itemSize(item, fp);
  return { x0: item.x - w / 2, y0: item.y - h / 2, x1: item.x + w / 2, y1: item.y + h / 2 };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Parts that overlap each other (by their outlines' bounding boxes, ignoring a touch
// of under 0.5 mm so that parts butted together are not flagged) and parts that stick
// out past the edge of the plate.
export function findProblems(panel, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const plate = byId.get(String(panel.plateId));
  const rects = [];
  // A DXF placed without a schematic part (a free item: a fan, a label, a cut-out) may overlap anything, so it is never
  // reported as an overlap; only parts linked to the schematic are checked against each other.
  (panel.items || []).forEach(it => { const fp = byId.get(String(it.footprintId)); if (fp) rects.push({ id: it.id, r: itemRect(it, fp), free: !it.link }); });
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    if (rects[i].free || rects[j].free) continue;
    const a = rects[i].r, b = rects[j].r;
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > 0.5 && oy > 0.5) overlaps.push([rects[i].id, rects[j].id]);
  }
  const outside = [];
  if (plate) rects.forEach(({ id, r }) => { if (r.x0 < -plate.width / 2 - 0.01 || r.x1 > plate.width / 2 + 0.01 || r.y0 < -plate.height / 2 - 0.01 || r.y1 > plate.height / 2 + 0.01) outside.push(id); });
  return { overlaps, outside };
}

// The first spot on the plate (scanning left to right, top to bottom, in 5 mm steps) where
// a footprint of this size fits clear of everything already placed; the plate's centre if
// there is nowhere (or no plate).
export function findFreeSpot(panel, footprints, fp, rotation = 0) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const plate = byId.get(String(panel.plateId));
  const { w, h } = itemSize({ rotation }, fp);
  if (!plate) return { x: 0, y: 0 };
  const taken = [];
  (panel.items || []).forEach(it => { const f = byId.get(String(it.footprintId)); if (f && it.link) taken.push(itemRect(it, f)); });   // free items can be built over
  const margin = 5;
  for (let y = -plate.height / 2 + margin + h / 2; y <= plate.height / 2 - margin - h / 2 + 1e-6; y += 5) {
    for (let x = -plate.width / 2 + margin + w / 2; x <= plate.width / 2 - margin - w / 2 + 1e-6; x += 5) {
      const r = { x0: x - w / 2 - 1, y0: y - h / 2 - 1, x1: x + w / 2 + 1, y1: y + h / 2 + 1 };
      if (!taken.some(t => overlapArea(r, t) > 0)) return { x: round2(x), y: round2(y) };
    }
  }
  return { x: 0, y: 0 };
}

export function snapMm(v, step) { return step > 0 ? Math.round(v / step) * step : round2(v); }

// The sheet scale (1 : n) that fits the plate in the space available, as a drawing
// scale from PANEL_SCALES; the largest if nothing fits.
export function chooseScale(plateW, plateH, areaWidthUnits, areaHeightUnits) {
  const areaW = areaWidthUnits / PX_PER_MM, areaH = areaHeightUnits / PX_PER_MM;
  for (const n of PANEL_SCALES) if (plateW / n <= areaW && plateH / n <= areaH) return n;
  return PANEL_SCALES[PANEL_SCALES.length - 1];
}

export const unitsPerMm = (scale) => PX_PER_MM / scale;

// ---- the schematic parts that can be placed ----
// One entry per physical part. `h` supplies the schematic-side helpers (kept out of this
// file so it stays pure): { isTerminalTableSymbol, isAssignedTerminal, terminalModelOf,
// blockKey, terminalLocationId, getDisplayDesignator, getGridLocation, schematicNumber(idx) }
const SUPPLY_TYPES = ['gnd', 'supply_3n_pe', 'supply_1n_pe', 'supply_3_pe'];

export function listPlaceableParts(sheets, h) {
  const parts = [];
  const counted = new Set();
  // A coil joined to another (forward/reverse contactor) is the same device: it is listed once, under the main coil.
  const joinedMains = new Set();
  const everyComp = new Set();
  sheets.forEach(s => (s.components || []).forEach(c => everyComp.add(String(c.id))));
  sheets.forEach(s => (s.components || []).forEach(c => { if (c.jointToId && everyComp.has(String(c.jointToId))) joinedMains.add(String(c.jointToId)); }));
  const joinedLabels = (main) => {
    const out = [];
    sheets.forEach(s => (s.components || []).forEach(c => { if (c.jointToId && String(c.jointToId) === String(main.id)) out.push(h.getDisplayDesignator(c.label || '?', c, s)); }));
    return out;
  };
  sheets.forEach((sheet, idx) => {
    if ((sheet.pageType || 'schematic') !== 'schematic') return;
    (sheet.components || []).forEach(comp => {
      if (SUPPLY_TYPES.includes(comp.type) || String(comp.type).startsWith('custom_shield_') || h.isTerminalTableSymbol(comp.type) || comp.parentId || (comp.jointToId && joinedMains.has(String(comp.jointToId)))) return;
      const isTerm = comp.type === 'terminal';
      const assigned = isTerm && h.isAssignedTerminal(comp);
      let block = null, designator;
      if (assigned) {
        const physical = `${h.blockKey(comp.label, h.terminalLocationId(comp, sheet))}|${comp.position}`;
        if (counted.has(physical)) return;          // a multi-level terminal is drawn once per level but is one part
        counted.add(physical);
        block = h.blockKey(comp.label, h.terminalLocationId(comp, sheet));
        designator = `${h.getDisplayDesignator(comp.label, comp, sheet)}:${comp.position}`;
      } else {
        designator = h.getDisplayDesignator(comp.label || '?', comp, sheet);
        if (joinedMains.has(String(comp.id))) designator = [designator, ...joinedLabels(comp)].join(' + ');
      }
      const model = isTerm ? h.terminalModelOf(comp) : null;
      parts.push({
        key: `${sheet.id}:${comp.id}`, sheetId: sheet.id, compId: comp.id, sheetIdx: idx,
        designator, block, position: assigned ? comp.position : null,
        locationId: (isTerm ? h.terminalLocationId(comp, sheet) : (h.locationOf ? h.locationOf(comp, sheet) : null)) || '',
        make: model ? model.make : (comp.make || ''), modelNo: model ? (model.modelNo || model.name) : (comp.modelNo || ''),
        description: model ? model.description : (comp.description || ''),
        ref: h.refText ? h.refText(comp.x, comp.y, idx) : `Sh.${h.schematicNumber(idx)}/${h.getGridLocation(comp.x, comp.y, idx)}`
      });
    });
  });
  return parts.sort((a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true }));
}

export const linkKey = (link) => (link ? `${link.sheetId}:${link.compId}` : null);

// Every part that has been placed on any panel sheet: key -> { sheetId (panel sheet), item }
export function placedKeys(sheets) {
  const map = new Map();
  (sheets || []).forEach(s => {
    if (s.pageType !== 'panel' || !s.panel) return;
    (s.panel.items || []).forEach(it => { const k = linkKey(it.link); if (k) map.set(k, { panelSheetId: s.id, item: it }); });
  });
  return map;
}

// ---- DIN rails ----
// A rail on a panel sheet: { id, x, y (centre, mm), length (mm), axis: 'h' | 'v' (the way it runs), type }
export const RAIL_TYPES = [
  { id: '35x7.5', name: '35 \u00d7 7.5 DIN rail', width: 35 },
  { id: '35x15', name: '35 \u00d7 15 DIN rail', width: 35 },
  { id: '15x5.5', name: '15 \u00d7 5.5 miniature rail', width: 15 }
];
export const railType = (id) => RAIL_TYPES.find(t => t.id === id) || RAIL_TYPES[0];
export const RAIL_TOLERANCE = 1.5;   // mm: how far off a rail's centreline a part may sit and still count as mounted on it
export const RAIL_SNAP_DISTANCE = 15; // mm: how close a dragged part must get for the rail to take hold of it

export function cleanRailItem(r) {
  if (!r || typeof r !== 'object') return null;
  const length = Number(r.length);
  if (!(length > 0) || length > 5000 || !Number.isFinite(Number(r.x)) || !Number.isFinite(Number(r.y))) return null;
  return { id: r.id, x: Number(r.x), y: Number(r.y), length: round2(length), axis: r.axis === 'v' ? 'v' : 'h', type: railType(r.type).id };
}

export function railRect(rail) {
  const w = railType(rail.type).width;
  return rail.axis === 'v'
    ? { x0: rail.x - w / 2, x1: rail.x + w / 2, y0: rail.y - rail.length / 2, y1: rail.y + rail.length / 2 }
    : { x0: rail.x - rail.length / 2, x1: rail.x + rail.length / 2, y0: rail.y - w / 2, y1: rail.y + w / 2 };
}

// The rail's span along its own direction, and its centreline across it.
export function railSpan(rail) {
  return rail.axis === 'v' ? { a0: rail.y - rail.length / 2, a1: rail.y + rail.length / 2, c: rail.x } : { a0: rail.x - rail.length / 2, a1: rail.x + rail.length / 2, c: rail.y };
}

// Where the rail marker of a placed part falls on the plate: which way the rail would run, the
// centreline's position across it (c), and the marker's offset from the part's centre (rx, ry).
export function itemRailLine(item, fp) {
  if (!fp || !fp.rail) return null;
  const rot = normaliseRotation(item.rotation);
  const lx = fp.rail.axis === 'v' ? fp.rail.pos - fp.width / 2 : 0;
  const ly = fp.rail.axis === 'h' ? fp.rail.pos - fp.height / 2 : 0;
  const r = rot * Math.PI / 180, cs = Math.round(Math.cos(r)), sn = Math.round(Math.sin(r));
  const rx = lx * cs - ly * sn, ry = lx * sn + ly * cs;
  const axis = rot % 180 === 90 ? (fp.rail.axis === 'h' ? 'v' : 'h') : fp.rail.axis;
  return { axis, c: axis === 'h' ? item.y + ry : item.x + rx, rx, ry };
}

const alongRange = (item, fp, axis) => { const { w, h } = itemSize(item, fp); return axis === 'h' ? [item.x - w / 2, item.x + w / 2] : [item.y - h / 2, item.y + h / 2]; };

// If a part with a rail marker has been dropped near a rail running the same way, how far to
// move it so the marker sits exactly on the rail's centreline and the part lies within the
// rail's length. null if there is no such rail close enough.
export function snapItemToRail(item, fp, rails, ctx = null) {
  const line = itemRailLine(item, fp);
  if (!line) return null;
  let best = null;
  rails.forEach(rail => {
    if (rail.axis !== line.axis) return;
    const sp = railSpan(rail);
    const d = Math.abs(line.c - sp.c);
    // over the rail at all (any part of the part lying on the rail's body), or close to its centreline
    const rr = railRect(rail), ir = itemRect(item, fp);
    const over = Math.min(ir.x1, rr.x1) - Math.max(ir.x0, rr.x0) > 0 && Math.min(ir.y1, rr.y1) - Math.max(ir.y0, rr.y0) > 0;
    if (!over && d > RAIL_SNAP_DISTANCE) return;
    const [p0, p1] = alongRange(item, fp, line.axis);
    if (p1 < sp.a0 || p0 > sp.a1) return;             // not over the rail at all
    if (!best || d < best.d) best = { d, rail, sp };
  });
  if (!best) return null;
  const [p0, p1] = alongRange(item, fp, line.axis), len = p1 - p0;
  let shift = 0;
  if (len <= best.sp.a1 - best.sp.a0 + 1e-6) { if (p0 < best.sp.a0) shift = best.sp.a0 - p0; else if (p1 > best.sp.a1) shift = best.sp.a1 - p1; }
  const across = best.sp.c - line.c;
  // Dropped over a part already on this rail: butt up against it instead (on the side its middle is nearer), and carry on past
  // any further parts that are in the way. If it cannot fit on the rail that way it stays where it was put.
  if (ctx && Array.isArray(ctx.items)) {
    const byId = new Map((ctx.footprints || []).map(f => [String(f.id), f]));
    const ignore = ctx.ignore || new Set();
    const mates = [];
    ctx.items.forEach(it => {
      if (ignore.has(it.id) || it === item) return;
      const f = byId.get(String(it.footprintId)), l = f && itemRailLine(it, f);
      if (!l || l.axis !== line.axis || Math.abs(l.c - best.sp.c) > RAIL_TOLERANCE) return;
      const [m0, m1] = alongRange(it, f, line.axis);
      mates.push([m0, m1]);
    });
    const a0 = p0 + shift, hit = (pos) => mates.find(([m0, m1]) => Math.min(pos + len, m1) - Math.max(pos, m0) > 0.5);
    const first = hit(a0);
    if (first) {
      const pref = (a0 + len / 2) >= (first[0] + first[1]) / 2 ? 1 : -1;
      for (const dir of [pref, -pref]) {
        let pos = a0, guard = 0, h;
        while ((h = hit(pos)) && guard++ < 50) pos = dir > 0 ? h[1] : h[0] - len;
        if (!h && pos >= best.sp.a0 - 1e-6 && pos + len <= best.sp.a1 + 1e-6) { shift = pos - p0; break; }
      }
    }
  }
  const out = line.axis === 'h' ? { dx: shift, dy: across } : { dx: across, dy: shift };
  return { dx: round2(out.dx), dy: round2(out.dy), rail: best.rail };
}

// The parts mounted on a rail: marker on its centreline and part lying over it.
export function partsOnRail(panel, rail, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const sp = railSpan(rail);
  return (panel.items || []).filter(it => {
    const fp = byId.get(String(it.footprintId)); const line = itemRailLine(it, fp);
    if (!line || line.axis !== rail.axis || Math.abs(line.c - sp.c) > RAIL_TOLERANCE) return false;
    const [p0, p1] = alongRange(it, fp, line.axis);
    return p1 > sp.a0 && p0 < sp.a1;
  });
}

// Where a part (or a row of `count` identical parts end to end) goes on the first rail that has room:
// { x, y, rail } for the centre of the part/row, or null. Rails with parts already on them are filled from the start.
export function railPlacement(panel, footprints, fp, rotation = 0, count = 1) {
  const probe = { x: 0, y: 0, rotation };
  const line = itemRailLine(probe, fp);
  if (!line) return null;
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const { w, h } = itemSize(probe, fp);
  const along = (line.axis === 'h' ? w : h) * count, cross = line.axis === 'h' ? h : w;
  const taken = [];
  (panel.items || []).forEach(it => { const f = byId.get(String(it.footprintId)); if (f) taken.push(itemRect(it, f)); });
  for (const rail of (panel.rails || [])) {
    if (rail.axis !== line.axis) continue;
    const sp = railSpan(rail);
    for (let a = sp.a0 + along / 2; a <= sp.a1 - along / 2 + 1e-6; a += 1) {
      const r = line.axis === 'h'
        ? { x0: a - along / 2, x1: a + along / 2, y0: sp.c - line.ry - cross / 2, y1: sp.c - line.ry + cross / 2 }
        : { x0: sp.c - line.rx - cross / 2, x1: sp.c - line.rx + cross / 2, y0: a - along / 2, y1: a + along / 2 };
      if (!taken.some(t => Math.min(r.x1, t.x1) - Math.max(r.x0, t.x0) > 0.5 && Math.min(r.y1, t.y1) - Math.max(r.y0, t.y0) > 0.5)) {
        return line.axis === 'h' ? { x: round2(a), y: round2(sp.c - line.ry), rail } : { x: round2(sp.c - line.rx), y: round2(a), rail };
      }
    }
  }
  return null;
}

// Where a new part (or a row of `count`) goes right beside a part that is already placed: butted against it, to its right first,
// then its left (and below, then above, when it is not on a rail). Turned the same way as that part, and on the same rail when
// both have a rail marker. { x, y, rotation, onRail, axis } or null when there is no clear room beside it.
export function placementBeside(panel, footprints, sel, fp, count = 1) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const sfp = byId.get(String(sel.footprintId));
  if (!sfp) return null;
  const rot = count > 1 ? 0 : normaliseRotation(sel.rotation);
  const vfp = count > 1 ? { ...fp, width: fp.width * count } : fp;
  const { w, h } = itemSize({ rotation: rot }, vfp);
  const sr = itemRect(sel, sfp);
  const plate = byId.get(String(panel.plateId));
  const taken = [];
  (panel.items || []).forEach(it => { if (it === sel || !it.link) return; const f = byId.get(String(it.footprintId)); if (f) taken.push(itemRect(it, f)); });
  const selRect = sr;
  const cands = [];
  const lineSel = itemRailLine(sel, sfp), lineNew = itemRailLine({ x: 0, y: 0, rotation: rot }, vfp);
  let rails = [];
  if (lineSel && lineNew && lineSel.axis === lineNew.axis) {
    rails = (panel.rails || []).filter(r => r.axis === lineSel.axis && Math.abs(railSpan(r).c - lineSel.c) <= RAIL_TOLERANCE + 0.5);
    if (rails.length) {
      if (lineSel.axis === 'h') { const y = round2(lineSel.c - lineNew.ry); cands.push({ x: selRect.x1 + w / 2, y }, { x: selRect.x0 - w / 2, y }); }
      else { const x = round2(lineSel.c - lineNew.rx); cands.push({ x, y: selRect.y1 + h / 2 }, { x, y: selRect.y0 - h / 2 }); }
    }
  }
  const onRail = cands.length > 0;
  if (!onRail) cands.push({ x: selRect.x1 + w / 2, y: sel.y }, { x: selRect.x0 - w / 2, y: sel.y }, { x: sel.x, y: selRect.y1 + h / 2 }, { x: sel.x, y: selRect.y0 - h / 2 });
  for (const c of cands) {
    const r = { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
    if (plate && (r.x0 < -plate.width / 2 - 0.01 || r.x1 > plate.width / 2 + 0.01 || r.y0 < -plate.height / 2 - 0.01 || r.y1 > plate.height / 2 + 0.01)) continue;
    if (taken.some(t => Math.min(r.x1, t.x1) - Math.max(r.x0, t.x0) > 0.5 && Math.min(r.y1, t.y1) - Math.max(r.y0, t.y0) > 0.5)) continue;
    if (onRail) {
      const a0 = lineSel.axis === 'h' ? r.x0 : r.y0, a1 = lineSel.axis === 'h' ? r.x1 : r.y1;
      if (!rails.some(rl => { const sp = railSpan(rl); return a0 >= sp.a0 - 1e-6 && a1 <= sp.a1 + 1e-6; })) continue;
    }
    return { x: round2(c.x), y: round2(c.y), rotation: rot, onRail, axis: onRail ? lineSel.axis : 'h' };
  }
  return null;
}

// The rail lengths to cut, grouped: [{ type, name, length, count }]
export function railCutList(panel) {
  const map = new Map();
  (panel.rails || []).forEach(r => {
    const k = `${r.type}|${r.length}`;
    if (!map.has(k)) map.set(k, { type: r.type, name: railType(r.type).name, length: r.length, count: 0 });
    map.get(k).count++;
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name) || b.length - a.length);
}

// Rails that stick out past the plate, and mounted parts that overhang the end of their rail.
export function findRailProblems(panel, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const plate = byId.get(String(panel.plateId));
  const railsOutside = [];
  if (plate) (panel.rails || []).forEach(r => { const q = railRect(r); if (q.x0 < -plate.width / 2 - 0.01 || q.x1 > plate.width / 2 + 0.01 || q.y0 < -plate.height / 2 - 0.01 || q.y1 > plate.height / 2 + 0.01) railsOutside.push(r.id); });
  const overhang = [];
  (panel.rails || []).forEach(rail => {
    const sp = railSpan(rail);
    partsOnRail(panel, rail, footprints).forEach(it => {
      const fp = byId.get(String(it.footprintId)); const [p0, p1] = alongRange(it, fp, rail.axis);
      if (p0 < sp.a0 - 0.5 || p1 > sp.a1 + 0.5) overhang.push(it.id);
    });
  });
  return { railsOutside, overhang };
}

// ---- trunking (wiring duct) ----
// A duct run on a panel sheet: { id, x, y (centre, mm), length (mm), axis: 'h' | 'v' (the way it runs), type }
// width = the visible width across the run; depth is for the cut list only.
export const DUCT_TYPES = [
  { id: '25x25', name: '25 \u00d7 25 trunking', width: 25, depth: 25 },
  { id: '25x40', name: '25 \u00d7 40 trunking', width: 25, depth: 40 },
  { id: '25x60', name: '25 \u00d7 60 trunking', width: 25, depth: 60 },
  { id: '40x40', name: '40 \u00d7 40 trunking', width: 40, depth: 40 },
  { id: '40x60', name: '40 \u00d7 60 trunking', width: 40, depth: 60 },
  { id: '60x60', name: '60 \u00d7 60 trunking', width: 60, depth: 60 },
  { id: '60x80', name: '60 \u00d7 80 trunking', width: 60, depth: 80 },
  { id: '80x80', name: '80 \u00d7 80 trunking', width: 80, depth: 80 },
  { id: '100x80', name: '100 \u00d7 80 trunking', width: 100, depth: 80 }
];
export const ductType = (id) => DUCT_TYPES.find(t => t.id === id) || DUCT_TYPES[0];

export function cleanDuct(d) {
  if (!d || typeof d !== 'object') return null;
  const length = Number(d.length);
  if (!(length > 0) || length > 5000 || !Number.isFinite(Number(d.x)) || !Number.isFinite(Number(d.y))) return null;
  return { id: d.id, x: Number(d.x), y: Number(d.y), length: round2(length), axis: d.axis === 'v' ? 'v' : 'h', type: ductType(d.type).id };
}

export function ductRect(d) {
  const w = ductType(d.type).width;
  return d.axis === 'v'
    ? { x0: d.x - w / 2, x1: d.x + w / 2, y0: d.y - d.length / 2, y1: d.y + d.length / 2 }
    : { x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - w / 2, y1: d.y + w / 2 };
}

// Ducts that stick out past the plate, parts lying across a duct, and ducts lying across a DIN rail.
// (A duct is meant to sit beside parts, not under them; ducts that merely touch are fine.)
export function findDuctProblems(panel, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const plate = byId.get(String(panel.plateId));
  const outside = [], onParts = [], onRails = [];
  const hit = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
  (panel.ducts || []).forEach(d => {
    const q = ductRect(d);
    if (plate && (q.x0 < -plate.width / 2 - 0.01 || q.x1 > plate.width / 2 + 0.01 || q.y0 < -plate.height / 2 - 0.01 || q.y1 > plate.height / 2 + 0.01)) outside.push(d.id);
    (panel.items || []).forEach(it => { const f = byId.get(String(it.footprintId)); if (f && hit(q, itemRect(it, f))) onParts.push([d.id, it.id]); });
    (panel.rails || []).forEach(r => { if (hit(q, railRect(r))) onRails.push([d.id, r.id]); });
  });
  return { outside, onParts, onRails };
}

// The duct lengths to cut, grouped: [{ type, name, length, count }]
export function ductCutList(panel) {
  const map = new Map();
  (panel.ducts || []).forEach(d => {
    const k = `${d.type}|${d.length}`;
    if (!map.has(k)) map.set(k, { type: d.type, name: ductType(d.type).name, length: d.length, count: 0 });
    map.get(k).count++;
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name) || b.length - a.length);
}

// ---- measuring ----
// A saved dimension: { id, x1, y1, x2, y2 (mm from the plate centre), axis, off, a1, a2, gap }
//   axis  'h' measures the horizontal distance, 'v' the vertical one, 'd' the straight-line distance
//   off   how far the dimension line has been dragged away from the measured points (mm) - sideways for
//         'v', up/down for 'h', square to the line for 'd'
//   a1,a2 { id, fx, fy }: the point sits at that fraction across the rectangle of that object ('plate' for the
//         plate), so it follows the object when it is moved; without one the point stays where it is
//   gap   [idA, idB]: the clear space between those two objects, re-measured whenever either moves
const axisOf = (x1, y1, x2, y2) => Math.abs(x2 - x1) < 0.05 ? 'v' : Math.abs(y2 - y1) < 0.05 ? 'h' : 'd';
const cleanAnchor = (a) => (a && typeof a === 'object' && a.id !== undefined && Number.isFinite(Number(a.fx)) && Number.isFinite(Number(a.fy))) ? { id: a.id, fx: Math.round(Number(a.fx) * 1000) / 1000, fy: Math.round(Number(a.fy) * 1000) / 1000 } : null;
export function cleanDim(d) {
  if (!d || typeof d !== 'object') return null;
  const v = [d.x1, d.y1, d.x2, d.y2].map(Number);
  if (v.some(n => !Number.isFinite(n))) return null;
  if (Math.hypot(v[2] - v[0], v[3] - v[1]) < 0.05) return null;
  const gap = Array.isArray(d.gap) && d.gap.length === 2 ? [d.gap[0], d.gap[1]] : null;
  return {
    id: d.id, x1: round2(v[0]), y1: round2(v[1]), x2: round2(v[2]), y2: round2(v[3]),
    axis: d.axis === 'h' || d.axis === 'v' || d.axis === 'd' ? d.axis : axisOf(v[0], v[1], v[2], v[3]),
    off: Number.isFinite(Number(d.off)) ? round2(Number(d.off)) : 0,
    a1: cleanAnchor(d.a1), a2: cleanAnchor(d.a2), gap
  };
}

export function dimInfo(d) {
  const dx = Math.abs(d.x2 - d.x1), dy = Math.abs(d.y2 - d.y1);
  const r1 = (n) => Math.round(n * 10) / 10;
  const axis = d.axis === 'h' || d.axis === 'v' || d.axis === 'd' ? d.axis : axisOf(d.x1, d.y1, d.x2, d.y2);
  const dist = axis === 'h' ? dx : axis === 'v' ? dy : Math.hypot(dx, dy);
  return { dx: r1(dx), dy: r1(dy), dist: r1(dist), axis, straight: axis !== 'd' };
}

// The anchor for a point lying on (or very near) an object, so the point can follow it later.
export function anchorFor(panel, footprints, id, x, y) {
  const o = rectsWithPlate(panel, footprints).find(r => String(r.id) === String(id));
  if (!o) return null;
  const w = o.rect.x1 - o.rect.x0, h = o.rect.y1 - o.rect.y0;
  return { id: o.id, fx: w > 0 ? (x - o.rect.x0) / w : 0.5, fy: h > 0 ? (y - o.rect.y0) / h : 0.5 };
}

// Brings dimensions up to date with where things are now (changes the dimensions given): gap dimensions are
// measured afresh, anchored points move with their objects, and a point whose object has gone stays put.
export function resolveDims(panel, footprints, dims = panel.dims || []) {
  const rects = new Map(rectsWithPlate(panel, footprints).map(o => [String(o.id), o.rect]));
  dims.forEach(d => {
    if (d.gap) {
      const A = rects.get(String(d.gap[0])), B = rects.get(String(d.gap[1]));
      if (A && B) {
        const g = gapBetween(A, B);
        d.x1 = g.x1; d.y1 = g.y1; d.x2 = g.x2; d.y2 = g.y2;
        d.axis = g.dx === 0 && g.dy > 0 ? 'v' : g.dy === 0 && g.dx > 0 ? 'h' : 'd';
      }
      return;
    }
    [['a1', 'x1', 'y1'], ['a2', 'x2', 'y2']].forEach(([k, kx, ky]) => {
      const a = d[k], r = a && rects.get(String(a.id));
      if (r) { d[kx] = round2(r.x0 + a.fx * (r.x1 - r.x0)); d[ky] = round2(r.y0 + a.fy * (r.y1 - r.y0)); }
    });
  });
  return dims;
}

function rectsWithPlate(panel, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const plate = byId.get(String(panel.plateId));
  const out = objectRects(panel, footprints);
  if (plate) out.push({ id: 'plate', kind: 'plate', rect: { x0: -plate.width / 2, y0: -plate.height / 2, x1: plate.width / 2, y1: plate.height / 2 } });
  return out;
}

// Everything on the panel that has a size, as { id, kind, rect }.
export function objectRects(panel, footprints) {
  const byId = new Map(footprints.map(f => [String(f.id), f]));
  const out = [];
  (panel.items || []).forEach(it => { const f = byId.get(String(it.footprintId)); if (f) out.push({ id: it.id, kind: 'item', rect: itemRect(it, f) }); });
  (panel.rails || []).forEach(r => out.push({ id: r.id, kind: 'rail', rect: railRect(r) }));
  (panel.ducts || []).forEach(d => out.push({ id: d.id, kind: 'duct', rect: ductRect(d) }));
  return out;
}

// The clear space between two rectangles: horizontal gap, vertical gap, straight-line distance,
// and the line that shows it (x1,y1 on the first, x2,y2 on the second). Overlapping ranges give a
// zero gap on that axis and the line runs through the middle of the overlap.
export function gapBetween(a, b) {
  const axis = (a0, a1, b0, b1) => {
    if (a1 <= b0) return { gap: b0 - a1, p: a1, q: b0 };
    if (b1 <= a0) return { gap: a0 - b1, p: a0, q: b1 };
    const m = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    return { gap: 0, p: m, q: m };
  };
  const X = axis(a.x0, a.x1, b.x0, b.x1), Y = axis(a.y0, a.y1, b.y0, b.y1);
  const r1 = (n) => Math.round(n * 10) / 10;
  return { dx: r1(X.gap), dy: r1(Y.gap), dist: r1(Math.hypot(X.gap, Y.gap)), overlapping: X.gap === 0 && Y.gap === 0, x1: round2(X.p), y1: round2(Y.p), x2: round2(X.q), y2: round2(Y.q) };
}

// Snaps a point to the nearest corner, edge midpoint or centre of any object (and of the plate), else to the
// nearest point on an edge, else leaves it where it is. tol is in mm.
export function snapPoint(panel, footprints, x, y, tol) {
  const objs = rectsWithPlate(panel, footprints);
  let best = null;
  objs.forEach(o => {
    const r = o.rect;
    const consider = (px, py, kind, rank) => {
      const d = Math.hypot(px - x, py - y);
      if (d > tol) return;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { x: px, y: py, kind, d, rank, o };
    };
    const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].forEach(c => consider(c[0], c[1], 'corner', 0));
    [[mx, r.y0], [mx, r.y1], [r.x0, my], [r.x1, my]].forEach(c => consider(c[0], c[1], 'middle', 1));
    consider(mx, my, 'centre', 1);
    // A DIN rail's centreline, along its whole length: a point on it is anchored to the rail, so the dimension
    // follows the rail when it (or the parts on it) is moved.
    if (o.kind === 'rail') {
      const horizontal = (r.x1 - r.x0) >= (r.y1 - r.y0);
      if (horizontal && x >= r.x0 - tol && x <= r.x1 + tol) consider(Math.max(r.x0, Math.min(r.x1, x)), my, 'centreline', 1.5);
      if (!horizontal && y >= r.y0 - tol && y <= r.y1 + tol) consider(mx, Math.max(r.y0, Math.min(r.y1, y)), 'centreline', 1.5);
    }
    // along an edge
    const cx = Math.max(r.x0, Math.min(r.x1, x)), cy = Math.max(r.y0, Math.min(r.y1, y));
    if (y >= r.y0 - tol && y <= r.y1 + tol) { consider(r.x0, cy, 'edge', 2); consider(r.x1, cy, 'edge', 2); }
    if (x >= r.x0 - tol && x <= r.x1 + tol) { consider(cx, r.y0, 'edge', 2); consider(cx, r.y1, 'edge', 2); }
  });
  if (!best) return { x, y, kind: null };
  const r = best.o.rect, w = r.x1 - r.x0, h = r.y1 - r.y0;
  return { x: round2(best.x), y: round2(best.y), kind: best.kind, id: best.o.id, fx: w > 0 ? (best.x - r.x0) / w : 0.5, fy: h > 0 ? (best.y - r.y0) / h : 0.5 };
}
