// ==========================================
// 22. PANEL LAYOUT SHEET
// ==========================================
// A sheet type for laying parts out on a backplate to scale. Drawings (from DXF
// files) are imported once into a footprint library; a footprint is then placed on
// the plate for each schematic part, and that placed part stays linked to its
// schematic component - so it shows the designator and the schematic reference
// (Sh.4/C3), the BOM can say what has been placed, and a double-click jumps back to
// the schematic. The rules are in 20_dxf_import.js and 21_panel_data.js (both
// tested on their own); this file draws the sheet and runs the dock beside it.
import {
  state, getActiveSheet, pushHistory, scheduleAutosave, appAlert, appConfirm, isFreePlan, SHEET_CONFIGS, getPageType,
  getSchematicSheetNumber, getGridLocation, getRefText, getDisplayDesignator, saveTextFile, todayStr, getEffectiveLocationId, findLocationById
} from './1_config_state.js';
import { stage, borderLayer, imageLayer, shapeLayer, wireLayer, contentLayer, wireLabelLayer, wirePreviewLayer, shapeHandleLayer } from './2_main_stage.js';
import { loadActiveSheet } from './5_portfolio_sheets.js';
import { goToLocation } from './31_find.js';
import { showSimpleMenu } from './40_component_menu.js';
import { isTerminalTableSymbol, isAssignedTerminal, terminalModelOf, blockKey, terminalLocationId } from './11_terminal_blocks.js';
import { parseDxf, buildFootprintGeometry, UNIT_NAMES } from './20_dxf_import.js';
import * as PD from './21_panel_data.js';
import { revTableHeight } from './23_revision_data.js';
import { titleBlockSize } from './25_title_block.js';

const el = (id) => document.getElementById(id);
const FP = () => (state.panelFootprints || (state.panelFootprints = []));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let selected = new Set();        // ids of the selected items on the active panel sheet
let nodeById = new Map();        // item id -> its drawn group, for moving a selection together
let dockOpen = true;
let secOpen = { plate: true, parts: true, measure: false, trunk: false, rails: false, fps: false };   // which dock cards are expanded
let partsFilter = 'unplaced';
let locFilter = '';              // '' = every location, '__none' = parts with no location, otherwise a location id
let message = { text: '', kind: '' };
let measureMode = false;         // the Measure tool is on: clicks place the two ends of a dimension
let measureStart = null;         // first end, in mm, once placed
let ductDraft = { type: '40x60', length: null, axis: 'h' };   // what the "Add trunking" row will make
let railDraft = { type: '35x7.5', length: null, axis: 'h' };   // what the "Add rail" row will make
const rowChoice = new Map();     // part key (or "block:<key>") -> footprint id picked in the list

const helpers = {
  isTerminalTableSymbol, isAssignedTerminal, terminalModelOf, blockKey, terminalLocationId, getDisplayDesignator,
  locationOf: (comp, sheet) => getEffectiveLocationId(comp, sheet),
  getGridLocation: (x, y, idx) => getGridLocation(x, y, idx),
  refText: (x, y, idx) => getRefText(x, y, idx),
  schematicNumber: (idx) => getSchematicSheetNumber(idx)
};
const allParts = () => PD.listPlaceableParts(state.sheets, helpers);

// The other placed terminals of the same terminal block (X1, X2...) as this one, itself included; just [item] if it
// is not a terminal of a block, or the only one placed. Used to select a whole block so it moves as one.
function blockMates(panel, item) {
  const parts = allParts();
  const part = item && item.link ? parts.find(p => p.key === PD.linkKey(item.link)) : null;
  if (!part || !part.block) return item ? [item] : [];
  const keys = new Set(parts.filter(p => p.block === part.block).map(p => p.key));
  const mates = panel.items.filter(it => it.link && keys.has(PD.linkKey(it.link)));
  return mates.length ? mates : [item];
}

function say(text, kind = '') { message = { text, kind }; }

async function requirePro() {
  if (!isFreePlan()) return true;
  await appAlert('Panel Layout is a Pro feature.');
  return false;
}

// ---- the sheet ----
const MARGIN = 40;

export function layoutOf(sheet) {
  const cfg = SHEET_CONFIGS[sheet.size] || SHEET_CONFIGS.A3;
  const land = sheet.orientation === 'landscape';
  const width = land ? cfg.width : cfg.height, height = land ? cfg.height : cfg.width;
  const areaX = MARGIN + 10, areaY = MARGIN + 10, areaW = width - MARGIN * 2 - 20, areaH = height - MARGIN * 2 - titleBlockSize(sheet).height - 30 - revTableHeight(state.revisions, sheet);
  const panel = PD.ensurePanel(sheet);
  const plate = FP().find(f => String(f.id) === String(panel.plateId)) || null;
  const scale = panel.scale || (plate ? PD.chooseScale(plate.width, plate.height, areaW - 20, areaH - 20) : 5);
  const u = PD.unitsPerMm(scale);
  return { width, height, areaX, areaY, areaW, areaH, ox: areaX + areaW / 2, oy: areaY + areaH / 2, u, scale, plate, panel };
}

function clearLayers() {
  [contentLayer, wireLayer, wireLabelLayer, shapeLayer, imageLayer, wirePreviewLayer, shapeHandleLayer].forEach(l => l.destroyChildren());
}

function drawLines(ctx, shape, lines, u) {
  ctx.beginPath();
  for (const l of lines) {
    ctx.moveTo(l[0] * u, l[1] * u);
    for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i] * u, l[i + 1] * u);
  }
  ctx.strokeShape(shape);
}

function partInfoMap() {
  const map = new Map();
  allParts().forEach(p => map.set(p.key, p));
  return map;
}

export function renderPanelSheet(sheet, openEditModalCallback) {
  clearLayers();
  nodeById = new Map();
  if (state.currentTool !== 'select') state.currentTool = 'select';
  const L = layoutOf(sheet);
  const { panel, u } = L;
  const fps = FP();
  const byId = new Map(fps.map(f => [String(f.id), f]));
  const problems = PD.findProblems(panel, fps);
  const overlapIds = new Set(problems.overlaps.flat()), outsideIds = new Set(problems.outside);
  const infos = partInfoMap();

  // the backplate
  if (L.plate) {
    const pw = L.plate.width * u, ph = L.plate.height * u;
    shapeLayer.add(new Konva.Rect({ x: L.ox - pw / 2, y: L.oy - ph / 2, width: pw, height: ph, fill: '#f1f5f9', listening: false }));
    shapeLayer.add(new Konva.Shape({
      x: L.ox, y: L.oy, sceneFunc: (ctx, shape) => drawLines(ctx, shape, L.plate.lines, u), stroke: '#475569', strokeWidth: 1, listening: false
    }));
    shapeLayer.add(new Konva.Text({
      x: L.ox - 200, y: L.oy + ph / 2 + 6, width: 400, align: 'center', fontSize: 9, fontStyle: 'italic', fill: '#6b7280', listening: false,
      text: `${L.plate.name}  ${L.plate.width} × ${L.plate.height} mm   •   scale 1:${L.scale}`
    }));
  } else {
    shapeLayer.add(new Konva.Text({
      x: L.areaX, y: L.areaY + L.areaH / 2 - 20, width: L.areaW, align: 'center', fontSize: 14, fontStyle: 'italic', fill: '#94a3b8', listening: false,
      text: 'No backplate yet — import a backplate DXF (or pick one) in the Panel Layout box.'
    }));
  }

  // DIN rails, under the parts
  (panel.rails || []).forEach(rail => drawRail(sheet, L, rail, openEditModalCallback));

  // trunking, under the parts too
  panel.ducts.forEach(duct => drawDuct(sheet, L, duct, openEditModalCallback, PD.findDuctProblems(panel, fps)));

  // the placed parts
  panel.items.forEach(item => {
    const fp = byId.get(String(item.footprintId));
    if (!fp) return;
    const rot = PD.normaliseRotation(item.rotation);
    const w = fp.width * u, h = fp.height * u;
    const isSel = selected.has(item.id);
    const color = isSel ? '#2563eb' : overlapIds.has(item.id) ? '#dc2626' : outsideIds.has(item.id) ? '#ea580c' : '#0f172a';
    const info = item.link ? infos.get(PD.linkKey(item.link)) : null;

    const group = new Konva.Group({ x: L.ox + item.x * u, y: L.oy + item.y * u, draggable: !measureMode });
    const inner = new Konva.Group({ rotation: rot });
    inner.add(new Konva.Rect({ x: -w / 2, y: -h / 2, width: w, height: h, fill: '#ffffff', stroke: isSel ? '#2563eb' : 'transparent', strokeWidth: 1, dash: [4, 3] }));
    inner.add(new Konva.Shape({
      sceneFunc: (ctx, shape) => drawLines(ctx, shape, fp.lines, u), stroke: color, strokeWidth: isSel ? 1.1 : 0.7, lineJoin: 'round', listening: false
    }));
    group.add(inner);

    // label, upright whichever way the part is turned
    const dispW = rot % 180 === 90 ? h : w, dispH = rot % 180 === 90 ? w : h;
    const designator = info ? info.designator : (item.link ? '?' : fp.name);
    const labelColor = item.link && !info ? '#dc2626' : '#0f172a';
    if (!item.link && item.hideName) { /* a free item whose name has been hidden */ }
    else if (dispW >= 26) {
      const tw = Math.max(dispW, 70);
      group.add(new Konva.Text({ x: -tw / 2, y: dispH / 2 + 2, width: tw, align: 'center', text: designator, fontSize: 9, fontStyle: 'bold', fill: labelColor, listening: false }));
      if (info) group.add(new Konva.Text({ x: -tw / 2, y: dispH / 2 + 12, width: tw, align: 'center', text: info.ref, fontSize: 7, fontStyle: 'italic', fill: '#6b7280', listening: false }));
    } else {
      // a narrow part (a terminal): the label runs up along it instead
      group.add(new Konva.Text({ x: -4, y: -dispH / 2 - 3, rotation: -90, text: designator, fontSize: 7, fontStyle: 'bold', fill: labelColor, listening: false }));
    }

    group.on('mouseenter', () => { stage.container().style.cursor = 'move'; });
    group.on('mouseleave', () => { stage.container().style.cursor = ''; });
    group.on('click tap', (e) => {
      if (measureMode) return;
      e.cancelBubble = true;
      if (e.evt && e.evt.altKey) selected = new Set(blockMates(panel, item).map(m => m.id)); // Alt-click: the whole terminal block
      else if (e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)) { selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id); }
      else selected = new Set([item.id]);
      renderPanelSheet(sheet, openEditModalCallback); refreshDock();
    });
    group.on('dblclick dbltap', (e) => { if (measureMode) return; e.cancelBubble = true; goToLink(item); });
    group.on('contextmenu', (e) => {   // right-click a placed part: go to it on the schematic
      e.evt.preventDefault(); e.cancelBubble = true;
      if (measureMode) return;
      if (!selected.has(item.id)) { selected = new Set([item.id]); renderPanelSheet(sheet, openEditModalCallback); refreshDock(); }
      showSimpleMenu(e.evt.clientX, e.evt.clientY, [
        { text: 'Show in schematic', onClick: () => goToLink(item), disabled: !item.link, title: item.link ? 'Open the schematic sheet this part is on, with it selected and centred' : 'This item is not linked to a schematic part' }
      ]);
    });

    wireDrag(sheet, L, group, item, 'item', openEditModalCallback);

    nodeById.set(item.id, group);
    contentLayer.add(group);
  });

  PD.resolveDims(panel, fps);
  panel.dims.forEach(d => drawDim(L, d, '#0e7490', { live: measureMode, sheet, cb: openEditModalCallback }));
  if (measureMode) { stage.container().style.cursor = 'crosshair'; if (measureStart) drawMeasureHint(L); }

  [shapeLayer, contentLayer, wireLayer, wireLabelLayer, imageLayer, wirePreviewLayer, shapeHandleLayer].forEach(l => l.batchDraw());
}

// ---- measuring ----
// A dimension: the measured points, extension lines out to the dimension line, a tick at each end and the
// length written beside it (mm, to 0.1). Horizontal/vertical ones slide square to their direction; others slide
// square to the line. `live` ones (being drawn, or following a part that is being dragged) cannot be grabbed.
function dimGeometry(d) {
  const off = d.off || 0, info = PD.dimInfo(d);
  if (info.axis === 'v') { const lx = d.x1 + off; return { a: [lx, d.y1], b: [lx, d.y2], e1: [d.x1, d.y1], e2: [d.x2, d.y2], f: [lx, d.y1], g: [lx, d.y2], tick: [1, 0], info }; }
  if (info.axis === 'h') { const ly = d.y1 + off; return { a: [d.x1, ly], b: [d.x2, ly], e1: [d.x1, d.y1], e2: [d.x2, d.y2], f: [d.x1, ly], g: [d.x2, ly], tick: [0, 1], info }; }
  const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1, nx = -(d.y2 - d.y1) / len, ny = (d.x2 - d.x1) / len;
  const a = [d.x1 + nx * off, d.y1 + ny * off], b = [d.x2 + nx * off, d.y2 + ny * off];
  return { a, b, e1: [d.x1, d.y1], e2: [d.x2, d.y2], f: a, g: b, tick: [nx, ny], info, normal: [nx, ny] };
}

function drawDim(L, d, color, { layer = wireLabelLayer, live = true, sheet = null, cb = null } = {}) {
  const u = L.u, G = dimGeometry(d), info = G.info;
  if (info.dist < 0.05) return;
  const px = (pt) => [L.ox + pt[0] * u, L.oy + pt[1] * u];
  const [ax, ay] = px(G.a), [bx, by] = px(G.b);
  // extension lines, only when the line has been moved away from the points
  const ext = new Konva.Group({ listening: false });
  [[G.e1, G.f], [G.e2, G.g]].forEach(([p, q]) => { if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) ext.add(new Konva.Line({ points: [...px(p), ...px(q)], stroke: color, strokeWidth: 0.5, dash: [3, 2], listening: false })); });
  layer.add(ext);

  const g = new Konva.Group({ draggable: !live });
  const hit = new Konva.Line({ points: [ax, ay, bx, by], stroke: color, strokeWidth: 0.9, hitStrokeWidth: 12 });
  g.add(hit);
  const tx = G.tick[0] * 4, ty = G.tick[1] * 4;
  [[ax, ay], [bx, by]].forEach(([x, y]) => g.add(new Konva.Line({ points: [x - tx, y - ty, x + tx, y + ty], stroke: color, strokeWidth: 0.9, listening: false })));
  // small arrow heads pointing in from the ends
  const text = info.axis === 'd' ? `${info.dist} mm  (${info.dx} × ${info.dy})` : `${info.dist} mm`;
  const mx = (ax + bx) / 2, my = (ay + by) / 2, vertical = info.axis === 'v';
  const tw = text.length * 4.6 + 6;
  if (vertical) {
    g.add(new Konva.Rect({ x: mx + 1, y: my - tw / 2, width: 11, height: tw, fill: '#ffffff', opacity: 0.85, listening: false }));
    g.add(new Konva.Text({ x: mx + 2, y: my + tw / 2 - 3, rotation: -90, text, fontSize: 8, fontStyle: 'bold', fill: color, listening: false }));
  } else {
    g.add(new Konva.Rect({ x: mx - tw / 2, y: my - 13, width: tw, height: 11, fill: '#ffffff', opacity: 0.85, listening: false }));
    g.add(new Konva.Text({ x: mx - tw / 2 + 3, y: my - 12, text, fontSize: 8, fontStyle: 'bold', fill: color, listening: false }));
  }
  layer.add(g);
  if (live || !sheet) return;

  // dragging slides the dimension line square to what it measures
  g.on('mouseenter', () => { stage.container().style.cursor = info.axis === 'v' ? 'ew-resize' : info.axis === 'h' ? 'ns-resize' : 'move'; });
  g.on('mouseleave', () => { stage.container().style.cursor = measureMode ? 'crosshair' : ''; });
  const along = (node) => info.axis === 'v' ? node.x() : info.axis === 'h' ? node.y() : node.x() * G.normal[0] + node.y() * G.normal[1];
  g.on('dragstart', () => pushHistory());
  g.on('dragmove', () => {
    const v = along(g);
    if (info.axis === 'v') g.position({ x: v, y: 0 });
    else if (info.axis === 'h') g.position({ x: 0, y: v });
    else g.position({ x: v * G.normal[0], y: v * G.normal[1] });
  });
  g.on('dragend', () => {
    d.off = Math.round(((d.off || 0) + along(g) / u) * 10) / 10;
    scheduleAutosave();
    renderPanelSheet(sheet, cb); refreshDock();
  });
  g.on('dblclick dbltap', (e) => { e.cancelBubble = true; d.off = 0; scheduleAutosave(); renderPanelSheet(sheet, cb); refreshDock(); });
}

// While parts are being dragged, redraw the dimensions as they would be with the parts where they now are.
function drawLiveDims(L, moved, dxMm, dyMm) {
  const panel = L.panel;
  const shift = (o) => moved.has(o.id) ? { ...o, x: o.x + dxMm, y: o.y + dyMm } : o;
  const tmp = { ...panel, items: panel.items.map(shift), rails: panel.rails.map(shift), ducts: panel.ducts.map(shift) };
  const dims = panel.dims.map(d => ({ ...d }));
  PD.resolveDims(tmp, FP(), dims);
  wireLabelLayer.destroyChildren();
  dims.forEach(d => drawDim(L, d, '#0e7490', { live: true }));
  wireLabelLayer.batchDraw();
}

// What the pointer is at, in mm from the plate centre, snapped to corners/edges/middles of what is there.
function pointerMm(L, free = false) {
  const pos = stage.getPointerPosition(); if (!pos) return null;
  const sc = stage.scaleX() || 1;
  const x = ((pos.x - stage.x()) / sc - L.ox) / L.u, y = ((pos.y - stage.y()) / sc - L.oy) / L.u;
  const tol = 8 / (L.u * sc);
  if (free) return { x, y, kind: null, tol };
  const sp = PD.snapPoint(L.panel, FP(), x, y, tol);
  return { ...sp, tol };
}

// Keeps a dimension square to the page when the second point is nearly in line with the first.
function orthoFix(a, b, tol) {
  const r = { x: b.x, y: b.y };
  if (Math.abs(b.x - a.x) < tol) r.x = a.x;
  else if (Math.abs(b.y - a.y) < tol) r.y = a.y;
  return r;
}

function drawMeasureHint(L) {
  wirePreviewLayer.destroyChildren();
  const cur = pointerMm(L); if (!cur || !measureStart) { wirePreviewLayer.batchDraw(); return; }
  const end = orthoFix(measureStart, cur, cur.tol);
  const u = L.u;
  wirePreviewLayer.add(new Konva.Circle({ x: L.ox + measureStart.x * u, y: L.oy + measureStart.y * u, radius: 3, fill: '#f97316', listening: false }));
  const d = { x1: measureStart.x, y1: measureStart.y, x2: end.x, y2: end.y };
  const dim = PD.cleanDim({ ...d, a1: null, a2: null });
  if (dim) drawDim(L, dim, '#f97316', { layer: wirePreviewLayer, live: true });
  wirePreviewLayer.batchDraw();
}

function showSnapMarker(L, pt) {
  wirePreviewLayer.destroyChildren();
  if (measureStart) { drawMeasureHint(L); return; }
  if (pt && pt.kind) wirePreviewLayer.add(new Konva.Circle({ x: L.ox + pt.x * L.u, y: L.oy + pt.y * L.u, radius: 3.5, stroke: '#f97316', strokeWidth: 1.2, listening: false }));
  wirePreviewLayer.batchDraw();
}

function measureClick(sheet) {
  const L = layoutOf(sheet), cur = pointerMm(L); if (!cur) return;
  if (!measureStart) { measureStart = { x: cur.x, y: cur.y, anchor: cur.id !== undefined ? { id: cur.id, fx: cur.fx, fy: cur.fy } : null }; say('Click the second point. Esc cancels.'); refreshDock(); drawMeasureHint(L); return; }
  const end = orthoFix(measureStart, cur, cur.tol);
  const a2 = cur.id !== undefined ? PD.anchorFor(L.panel, FP(), cur.id, end.x, end.y) : null;
  const dim = PD.cleanDim({ id: newItemId(), x1: measureStart.x, y1: measureStart.y, x2: end.x, y2: end.y, a1: measureStart.anchor, a2 });
  measureStart = null;
  if (dim) { pushHistory(); L.panel.dims.push(dim); scheduleAutosave(); say(`Measured ${PD.dimInfo(dim).dist} mm. Drag the line to move it clear; double-click it to put it back.`, 'ok'); }
  else say('The two points were in the same place.', 'error');
  renderPanelSheet(sheet); refreshDock();
}

function setMeasureMode(on) {
  measureMode = !!on; measureStart = null; say(on ? 'Click a corner, edge or middle of anything, then a second point.' : '');
  if (!on && stage && stage.container) stage.container().style.cursor = '';
  const sheet = activePanelSheet(); if (sheet) { renderPanelSheet(sheet); refreshDock(); }
}

// ---- DIN rails ----
function drawRail(sheet, L, rail, cb) {
  const u = L.u, t = PD.railType(rail.type), vert = rail.axis === 'v';
  const along = rail.length * u, cross = t.width * u;
  const w = vert ? cross : along, h = vert ? along : cross;
  const isSel = selected.has(rail.id);
  const group = new Konva.Group({ x: L.ox + rail.x * u, y: L.oy + rail.y * u, draggable: !measureMode });
  group.add(new Konva.Rect({ x: -w / 2, y: -h / 2, width: w, height: h, fill: '#e5e7eb', stroke: isSel ? '#2563eb' : '#94a3b8', strokeWidth: isSel ? 1.2 : 0.8 }));
  // the slotted middle of the rail
  const sw = vert ? cross * 0.4 : along - 4, sh = vert ? along - 4 : cross * 0.4;
  group.add(new Konva.Rect({ x: -sw / 2, y: -sh / 2, width: sw, height: sh, fill: '#f8fafc', stroke: '#cbd5e1', strokeWidth: 0.5, listening: false }));
  group.add(new Konva.Line({ points: vert ? [0, -h / 2, 0, h / 2] : [-w / 2, 0, w / 2, 0], stroke: '#94a3b8', strokeWidth: 0.5, dash: [6, 3], listening: false }));
  const label = `${t.name.replace(' DIN rail', '').replace(' miniature rail', ' mini')} DIN rail ${rail.length} mm`;
  group.add(vert
    ? new Konva.Text({ x: -w / 2 - 9, y: h / 2, rotation: -90, text: label, fontSize: 7, fontStyle: 'italic', fill: '#6b7280', listening: false })
    : new Konva.Text({ x: -w / 2, y: -h / 2 - 10, text: label, fontSize: 7, fontStyle: 'italic', fill: '#6b7280', listening: false }));
  group.on('mouseenter', () => { stage.container().style.cursor = 'move'; });
  group.on('mouseleave', () => { stage.container().style.cursor = ''; });
  group.on('click tap', (e) => {
    if (measureMode) return;      // let the click reach the stage, which places the measuring point
    e.cancelBubble = true;
    if (e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)) { selected.has(rail.id) ? selected.delete(rail.id) : selected.add(rail.id); }
    else selected = new Set([rail.id]);
    renderPanelSheet(sheet, cb); refreshDock();
  });
  wireDrag(sheet, L, group, rail, 'rail', cb);
  nodeById.set(rail.id, group);
  shapeLayer.add(group);
}

function drawDuct(sheet, L, duct, cb, probs) {
  const u = L.u, t = PD.ductType(duct.type), vert = duct.axis === 'v';
  const along = duct.length * u, cross = t.width * u;
  const w = vert ? cross : along, h = vert ? along : cross;
  const isSel = selected.has(duct.id);
  const bad = probs.outside.includes(duct.id) || probs.onParts.some(p => p[0] === duct.id) || probs.onRails.some(p => p[0] === duct.id);
  const edge = isSel ? '#2563eb' : bad ? '#dc2626' : '#64748b';
  const group = new Konva.Group({ x: L.ox + duct.x * u, y: L.oy + duct.y * u, draggable: !measureMode });
  group.add(new Konva.Rect({ x: -w / 2, y: -h / 2, width: w, height: h, fill: '#e2e8f0', stroke: edge, strokeWidth: isSel ? 1.3 : 0.9, opacity: 0.95 }));
  // the slotted sides: short teeth every 10 mm along both edges
  const tooth = Math.min(cross * 0.28, 7), pitch = 10 * u;
  group.add(new Konva.Shape({
    sceneFunc: (ctx, shape) => {
      ctx.beginPath();
      for (let a = pitch; a < along - 0.5; a += pitch) {
        const o = a - along / 2;
        if (vert) { ctx.moveTo(-w / 2, o); ctx.lineTo(-w / 2 + tooth, o); ctx.moveTo(w / 2, o); ctx.lineTo(w / 2 - tooth, o); }
        else { ctx.moveTo(o, -h / 2); ctx.lineTo(o, -h / 2 + tooth); ctx.moveTo(o, h / 2); ctx.lineTo(o, h / 2 - tooth); }
      }
      ctx.strokeShape(shape);
    }, stroke: '#94a3b8', strokeWidth: 0.5, listening: false
  }));
  const label = `${t.name} ${duct.length} mm`;
  group.add(new Konva.Text(vert
    ? { x: -4, y: h / 2 - 3, rotation: -90, text: label, fontSize: 7, fontStyle: 'italic', fill: '#6b7280', listening: false }
    : { x: -w / 2 + 3, y: -4, text: label, fontSize: 7, fontStyle: 'italic', fill: '#6b7280', listening: false }));
  group.on('mouseenter', () => { stage.container().style.cursor = 'move'; });
  group.on('mouseleave', () => { stage.container().style.cursor = ''; });
  group.on('click tap', (e) => {
    if (measureMode) return;      // let the click reach the stage, which places the measuring point
    e.cancelBubble = true;
    if (e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)) { selected.has(duct.id) ? selected.delete(duct.id) : selected.add(duct.id); }
    else selected = new Set([duct.id]);
    renderPanelSheet(sheet, cb); refreshDock();
  });
  wireDrag(sheet, L, group, duct, 'duct', cb);
  nodeById.set(duct.id, group);
  shapeLayer.add(group);
}

// Dragging a part or a rail moves everything selected; a rail takes the parts mounted on it along,
// and a part with a rail marker that is let go near a rail clicks onto it.
function wireDrag(sheet, L, group, obj, kind, cb) {
  const panel = L.panel, u = L.u;
  let start = null;
  const moveIds = () => {
    const ids = new Set(selected);
    panel.rails.forEach(r => { if (selected.has(r.id)) PD.partsOnRail(panel, r, FP()).forEach(it => ids.add(it.id)); });
    return ids;
  };
  group.on('dragstart', () => {
    pushHistory();
    if (!selected.has(obj.id)) selected = new Set([obj.id]);
    const ids = moveIds();
    start = { x: group.x(), y: group.y(), others: [], ids };
    ids.forEach(id => { if (id !== obj.id && nodeById.has(id)) { const n = nodeById.get(id); start.others.push({ n, x: n.x(), y: n.y() }); } });
  });
  group.on('dragmove', () => {
    if (!start) return;
    const dx = group.x() - start.x, dy = group.y() - start.y;
    start.others.forEach(o => o.n.position({ x: o.x + dx, y: o.y + dy }));
    if (panel.dims.length) drawLiveDims(L, start.ids, dx / u, dy / u);
  });
  group.on('dragend', () => {
    if (!start) return;
    const step = panel.snap;
    let dxMm = PD.snapMm((group.x() - L.ox) / u, step) - obj.x, dyMm = PD.snapMm((group.y() - L.oy) / u, step) - obj.y;
    if (kind === 'item' && !panel.rails.some(r => start.ids.has(r.id))) {
      const fp = FP().find(f => String(f.id) === String(obj.footprintId));
      const snap = PD.snapItemToRail({ ...obj, x: obj.x + dxMm, y: obj.y + dyMm }, fp, panel.rails, { items: panel.items, footprints: FP(), ignore: start.ids });
      if (snap) { dxMm += snap.dx; dyMm += snap.dy; }
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    panel.items.forEach(it => { if (start.ids.has(it.id)) { it.x = r2(it.x + dxMm); it.y = r2(it.y + dyMm); } });
    panel.rails.forEach(r => { if (start.ids.has(r.id)) { r.x = r2(r.x + dxMm); r.y = r2(r.y + dyMm); } });
    panel.ducts.forEach(d => { if (start.ids.has(d.id)) { d.x = r2(d.x + dxMm); d.y = r2(d.y + dyMm); } });
    start = null;
    scheduleAutosave();
    renderPanelSheet(sheet, cb); refreshDock();
  });
}

// Clicking empty paper clears the selection.
let stageWired = false;
function wireStageOnce() {
  if (stageWired) return;
  stageWired = true;
  stage.on('mousemove', () => {
    const sheet = getActiveSheet();
    if (!measureMode || !sheet || getPageType(sheet) !== 'panel') return;
    const L = layoutOf(sheet); showSnapMarker(L, pointerMm(L));
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (!activePanelSheet()) return;
    const k = String(e.key).toLowerCase();
    if (k === 'c') { if (copyPanelSelected({ quiet: false })) e.preventDefault(); }
    else if (k === 'v') { e.preventDefault(); pastePanelClip(); }
    else if (k === 'd') { e.preventDefault(); duplicatePanelSelected(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !measureMode) return;
    const sheet = getActiveSheet(); if (!sheet || getPageType(sheet) !== 'panel') return;
    if (measureStart) { measureStart = null; say(''); renderPanelSheet(sheet); refreshDock(); } else setMeasureMode(false);
  });
  stage.on('click tap', (e) => {
    const sheet = getActiveSheet();
    if (measureMode && sheet && getPageType(sheet) === 'panel') { measureClick(sheet); return; }
    if (!sheet || getPageType(sheet) !== 'panel' || !selected.size) return;
    const t = e.target;
    if (t === stage || (t.getLayer && t.getLayer() === borderLayer) || (t.getLayer && t.getLayer() === shapeLayer)) {
      selected = new Set();
      renderPanelSheet(sheet); refreshDock();
    }
  });
}

// ---- actions ----
function activePanelSheet() { const s = getActiveSheet(); return s && getPageType(s) === 'panel' ? s : null; }

function afterChange(sheet, { full = false } = {}) {
  scheduleAutosave();
  if (full) loadActiveSheet(); else { renderPanelSheet(sheet); refreshDock(); }
}

export async function addPanelSheet() {
  if (!(await requirePro())) return;
  pushHistory();
  const n = state.sheets.filter(s => getPageType(s) === 'panel').length + 1;
  let insertIdx = state.sheets.findIndex(s => getPageType(s) === 'bom');
  if (insertIdx < 0) insertIdx = state.sheets.length;
  state.sheets.splice(insertIdx, 0, {
    id: Date.now(), pageType: 'panel', size: 'A3', orientation: 'portrait',
    title: n > 1 ? `Panel Layout ${n}` : 'Panel Layout', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: [],
    panel: { plateId: null, scale: null, snap: 1, items: [], rails: [], ducts: [] }
  });
  state.activeSheetIndex = insertIdx;
  selected = new Set();
  loadActiveSheet();
  scheduleAutosave();
}

function goToLink(item) {
  if (!item.link) return;
  const idx = state.sheets.findIndex(s => s.id === item.link.sheetId);
  if (idx < 0 || !(state.sheets[idx].components || []).some(c => c.id === item.link.compId)) { say('That part is no longer on the schematic.', 'error'); refreshDock(); return; }
  const comp = state.sheets[idx].components.find(c => c.id === item.link.compId);
  goToLocation({ sheetIdx: idx, sel: { selectedComponentId: item.link.compId }, x: comp ? comp.x : null, y: comp ? comp.y : null });   // opens its sheet, selects it and centres the view on it
}

// From the schematic's right-click menu: open the panel sheet a part was placed on, with it selected.
export function goToPanelItem(panelSheetId, itemId) {
  const idx = state.sheets.findIndex(sh => sh.id === panelSheetId);
  if (idx < 0) return;
  selected = new Set([itemId]);
  state.selectedComponentId = null;
  state.activeSheetIndex = idx;
  loadActiveSheet();
  // centre the view on it, zoomed so the part is easy to see
  try {
    const sheet = state.sheets[idx], L = layoutOf(sheet);
    const it = (sheet.panel && sheet.panel.items || []).find(q => q.id === itemId);
    const fp = it && FP().find(f => String(f.id) === String(it.footprintId));
    if (it && fp && stage) {
      const { w, h } = PD.itemSize(it, fp);
      const big = Math.max(w, h) * L.u;
      const scale = Math.max(0.5, Math.min(4, (Math.min(stage.width(), stage.height()) * 0.3) / Math.max(big, 1)));
      stage.scale({ x: scale, y: scale });
      stage.position({ x: stage.width() / 2 - (L.ox + it.x * L.u) * scale, y: stage.height() / 2 - (L.oy + it.y * L.u) * scale });
      stage.batchDraw();
    }
  } catch (e) { /* the view stays as it was */ }
}

export function panelRotateSelected() {
  const sheet = activePanelSheet();
  if (!sheet || !selected.size) return;
  pushHistory();
  const panel = PD.ensurePanel(sheet);
  const r2 = (v) => Math.round(v * 100) / 100;
  const turned = new Set();
  // A rail turns about its own centre and takes the parts mounted on it round with it.
  panel.rails.filter(r => selected.has(r.id)).forEach(rail => {
    const mounted = PD.partsOnRail(panel, rail, FP()).filter(it => !turned.has(it.id));
    mounted.forEach(it => {
      const dx = it.x - rail.x, dy = it.y - rail.y;
      it.rotation = (PD.normaliseRotation(it.rotation) + 90) % 360;
      it.x = r2(rail.x - dy); it.y = r2(rail.y + dx); turned.add(it.id);
    });
    rail.axis = rail.axis === 'h' ? 'v' : 'h';
  });
  panel.ducts.filter(d => selected.has(d.id)).forEach(d => { d.axis = d.axis === 'h' ? 'v' : 'h'; });
  const items = panel.items.filter(it => selected.has(it.id) && !turned.has(it.id));
  // Several parts turn together about the middle of the group (so a terminal strip stays a strip);
  // one part turns about its own centre.
  if (items.length) {
    const cx = items.reduce((n, it) => n + it.x, 0) / items.length, cy = items.reduce((n, it) => n + it.y, 0) / items.length;
    items.forEach(it => {
      it.rotation = (PD.normaliseRotation(it.rotation) + 90) % 360;
      if (items.length > 1) { const dx = it.x - cx, dy = it.y - cy; it.x = r2(cx - dy); it.y = r2(cy + dx); }
    });
  }
  afterChange(sheet);
}

// ---- copy and paste of trunking and DIN rail ----
// Ctrl+C copies the selected trunking and rails, Ctrl+V pastes them (a little down and to the right each time, and into any
// panel sheet), Ctrl+D copies and pastes in one go. Parts placed on a rail are not copied; they belong to the schematic.
let panelClip = null, pasteStep = 0;

function copyPanelSelected({ quiet = false } = {}) {
  const sheet = activePanelSheet(); if (!sheet) return false;
  const panel = PD.ensurePanel(sheet);
  const rails = panel.rails.filter(r => selected.has(r.id)).map(r => JSON.parse(JSON.stringify(r)));
  const ducts = panel.ducts.filter(d => selected.has(d.id)).map(d => JSON.parse(JSON.stringify(d)));
  if (!rails.length && !ducts.length) { if (!quiet) { say('Select some trunking or a DIN rail first.', 'error'); refreshDock(); } return false; }
  panelClip = { rails, ducts }; pasteStep = 0;
  if (!quiet) { say(`Copied ${rails.length + ducts.length} item${rails.length + ducts.length === 1 ? '' : 's'}. Ctrl+V pastes.`, 'ok'); refreshDock(); }
  return true;
}

function pastePanelClip() {
  const sheet = activePanelSheet(); if (!sheet) return;
  if (!panelClip) { say('Nothing copied yet. Select trunking or a DIN rail and press Ctrl+C.', 'error'); refreshDock(); return; }
  pushHistory();
  const panel = PD.ensurePanel(sheet);
  pasteStep += 1;
  const off = 20 * pasteStep, ids = [];
  const make = (o) => { const c = JSON.parse(JSON.stringify(o)); c.id = newItemId(); c.x = Math.round((o.x + off) * 100) / 100; c.y = Math.round((o.y + off) * 100) / 100; ids.push(c.id); return c; };
  panelClip.rails.forEach(r => panel.rails.push(make(r)));
  panelClip.ducts.forEach(d => panel.ducts.push(make(d)));
  selected = new Set(ids);
  say(`Pasted ${ids.length} item${ids.length === 1 ? '' : 's'}.`, 'ok');
  afterChange(sheet);
}

function duplicatePanelSelected() { if (copyPanelSelected({ quiet: true })) pastePanelClip(); else say('Select some trunking or a DIN rail first.', 'error'), refreshDock(); }

export function panelDeleteSelected() {
  const sheet = activePanelSheet();
  if (!sheet || !selected.size) return;
  pushHistory();
  const panel = PD.ensurePanel(sheet);
  panel.items = panel.items.filter(it => !selected.has(it.id));
  panel.rails = panel.rails.filter(r => !selected.has(r.id));
  panel.ducts = panel.ducts.filter(d => !selected.has(d.id));
  selected = new Set();
  afterChange(sheet);
}

let idSeq = 0;
const newItemId = () => Date.now() * 1000 + (idSeq++ % 1000);

async function placePart(partKey, fpId) {
  const sheet = activePanelSheet(); if (!sheet || !(await requirePro())) return;
  const fp = FP().find(f => String(f.id) === String(fpId));
  const part = allParts().find(p => p.key === partKey);
  if (!fp || !part) return;
  const placed = PD.placedKeys(state.sheets).get(partKey);
  if (placed) { say(`${part.designator} is already placed.`, 'error'); refreshDock(); return; }
  const panel = PD.ensurePanel(sheet);
  pushHistory();
  const spot = spotFor(panel, fp, 1);
  const item = { id: newItemId(), footprintId: fp.id, x: spot.x, y: spot.y, rotation: spot.rotation, link: { sheetId: part.sheetId, compId: part.compId } };
  panel.items.push(item);
  selected = new Set([item.id]);
  rememberPartNumber(fp, part);
  afterChange(sheet);
}

// Where a new part (or a row of `count`) goes: on a DIN rail if the footprint has a rail marker and a rail
// with room runs the right way (the part is turned 90 degrees if only the other way has room), else the
// first free spot on the plate. `axis` is the direction a row runs.
function spotFor(panel, fp, count) {
  // A placed part is selected: the new one goes right beside it (see PD.placementBeside)
  const only = selected.size === 1 ? panel.items.find(it => selected.has(it.id)) : null;
  if (only) { const b = PD.placementBeside(panel, FP(), only, fp, count); if (b) return b; }
  if (fp.rail && panel.rails.length) {
    for (const rotation of [0, 90]) {
      const r = PD.railPlacement(panel, FP(), fp, rotation, count);
      if (r) return { x: r.x, y: r.y, rotation, onRail: true, axis: r.rail.axis };
    }
  }
  const spot = PD.findFreeSpot(panel, FP(), count > 1 ? { ...fp, width: fp.width * count } : fp, 0);
  return { x: spot.x, y: spot.y, rotation: 0, onRail: false, axis: 'h' };
}

// A footprint with no part number yet takes the one of the first part it is placed for,
// so the next part with that number finds it by itself.
function rememberPartNumber(fp, part) {
  if (fp.kind === 'part' && part.modelNo && !fp.modelNo) {
    fp.modelNo = part.modelNo; if (!fp.make) fp.make = part.make || '';
    say(`"${fp.name}" is now linked to part number ${part.modelNo}, so it will be picked for that part automatically.`, 'ok');
  }
}

async function placeBlock(blockKeyStr, fpId) {
  const sheet = activePanelSheet(); if (!sheet || !(await requirePro())) return;
  const fp = FP().find(f => String(f.id) === String(fpId)); if (!fp) return;
  const placedMap = PD.placedKeys(state.sheets);
  const parts = allParts().filter(p => p.block === blockKeyStr && !placedMap.has(p.key)).sort((a, b) => a.position - b.position);
  if (!parts.length) return;
  const panel = PD.ensurePanel(sheet);
  pushHistory();
  const spot = spotFor(panel, fp, parts.length);
  const sz = PD.itemSize({ rotation: spot.rotation }, fp), vertical = spot.axis === 'v';
  const step = vertical ? sz.h : sz.w;
  const a0 = -step * parts.length / 2 + step / 2;
  const ids = [];
  parts.forEach((p, i) => {
    const off = a0 + i * step;
    const item = { id: newItemId(), footprintId: fp.id, x: Math.round((spot.x + (vertical ? 0 : off)) * 100) / 100, y: Math.round((spot.y + (vertical ? off : 0)) * 100) / 100, rotation: spot.rotation, link: { sheetId: p.sheetId, compId: p.compId } };
    panel.items.push(item); ids.push(item.id);
  });
  if (spot.onRail) say(`Placed ${parts.length} terminals along the DIN rail.`, 'ok');
  else if (fp.rail && panel.rails.length) say(`${parts.length} terminals (${Math.round(step * parts.length)} mm in a row) do not fit on any rail, so they were placed free. Lengthen a rail or add another.`, 'error');
  selected = new Set(ids);
  rememberPartNumber(fp, parts[0]);
  if (!message.text) say(`Placed ${parts.length} terminals in a row. Drag one to move the whole strip.`, 'ok');
  afterChange(sheet);
}

async function placeFree(fpId) {
  const sheet = activePanelSheet(); if (!sheet || !(await requirePro())) return;
  const fp = FP().find(f => String(f.id) === String(fpId)); if (!fp) return;
  const panel = PD.ensurePanel(sheet);
  pushHistory();
  const spot = spotFor(panel, fp, 1);
  const item = { id: newItemId(), footprintId: fp.id, x: spot.x, y: spot.y, rotation: spot.rotation, link: null };
  panel.items.push(item);
  selected = new Set([item.id]);
  afterChange(sheet);
}

async function setPlate(fpId) {
  const sheet = activePanelSheet(); if (!sheet || !(await requirePro())) return;
  const panel = PD.ensurePanel(sheet);
  pushHistory();
  panel.plateId = fpId ? Number(fpId) : null;
  const fp = FP().find(f => String(f.id) === String(fpId));
  if (fp && !panel.items.length) sheet.orientation = fp.height >= fp.width ? 'portrait' : 'landscape';   // fits the plate's shape, while nothing is placed yet
  afterChange(sheet, { full: true });
}

// ---- footprint import ----
let importQueue = [];
let importCurrent = null;   // { fileName, text, parsed, unitScale, editId }

export async function startPanelImport(fileList) {
  if (!(await requirePro())) return;
  importQueue = Array.from(fileList || []);
  nextImport();
}

async function nextImport() {
  while (importQueue.length) {
    const file = importQueue.shift();
    if (/\.dwg$/i.test(file.name)) { await appAlert(`"${file.name}" is a DWG file. Save it as a DXF from your CAD package (Save As → DXF) and import that.`); continue; }
    if (file.size > 20 * 1024 * 1024) { await appAlert(`"${file.name}" is too large to import (20 MB at most).`); continue; }
    let text;
    try { text = await file.text(); } catch (err) { await appAlert(`"${file.name}" could not be read.`); continue; }
    const parsed = parseDxf(text);
    if (!parsed.ok) { await appAlert(`"${file.name}": ${parsed.error}`); continue; }
    importCurrent = { fileName: file.name, text, parsed, unitScale: null, editId: null };
    showImportModal();
    return;
  }
}

function guessKind(parsed) {
  const w = parsed.bounds.maxX - parsed.bounds.minX, h = parsed.bounds.maxY - parsed.bounds.minY;
  return w >= 300 && h >= 300 ? 'plate' : 'part';
}

function showImportModal() {
  const c = importCurrent; if (!c) return;
  const p = c.parsed;
  const w = p.bounds.maxX - p.bounds.minX, h = p.bounds.maxY - p.bounds.minY;
  const base = c.fileName.replace(/\.dxf$/i, '').replace(/[_]+/g, ' ').trim();
  el('piTitle').textContent = c.editId ? 'Footprint details' : 'Import footprint';
  el('piName').value = c.name ?? base.slice(0, PD.FOOTPRINT_NAME_MAX);
  el('piKind').value = c.kind ?? guessKind(p);
  el('piMake').value = c.make ?? ''; el('piModel').value = c.modelNo ?? ''; el('piDesc').value = c.description ?? '';
  el('piUnits').value = c.unitScale ? String(c.unitScale) : '';
  el('piUnitsRow').style.display = c.editId ? 'none' : '';
  const skipped = Object.entries(p.skipped || {}).map(([k, v]) => `${v} ${k}`).join(', ');
  el('piInfo').innerHTML = c.editId
    ? `${esc(c.fpInfo || '')}`
    : `Drawing is <b>${Math.round(w * 10) / 10} × ${Math.round(h * 10) / 10} mm</b> (units read as ${esc(p.unitName)}). ${p.polylines.length} outline pieces from ${p.entities} drawing items.` + (skipped ? ` Not imported: ${esc(skipped)}.` : '') + (importQueue.length ? ` ${importQueue.length} more file${importQueue.length === 1 ? '' : 's'} after this one.` : '');
  if (!c.editId && !c.geo) c.geo = buildFootprintGeometry(p);
  const fpEdit = c.editId ? FP().find(f => f.id === c.editId) : null;
  const dims = c.editId ? { w: fpEdit ? fpEdit.width : w, h: fpEdit ? fpEdit.height : h } : { w: c.geo.width, h: c.geo.height };
  c.dims = dims;
  if (c.railAxis === undefined) c.railAxis = fpEdit && fpEdit.rail ? fpEdit.rail.axis : '';
  if (c.railPos === undefined) c.railPos = fpEdit && fpEdit.rail ? fpEdit.rail.pos : null;
  if (c.railAxis && c.railPos == null) c.railPos = (c.railAxis === 'h' ? dims.h : dims.w) / 2;
  const isPlate = el('piKind').value === 'plate';
  el('piRailRow').style.display = isPlate ? 'none' : '';
  el('piRailAxis').value = c.railAxis || '';
  el('piRailCentre').disabled = !c.railAxis;
  const marker = c.railAxis && !isPlate ? { axis: c.railAxis, pos: c.railPos } : null;
  const lines = c.editId ? (fpEdit ? fpEdit.lines : []) : c.geo.lines;
  el('piPreview').innerHTML = thumbSvgFromLines(lines, dims.w, dims.h, 160, marker);
  el('piPreview').style.cursor = c.railAxis && !isPlate ? 'crosshair' : '';
  el('piPreview').onclick = c.railAxis && !isPlate ? onPreviewClick : null;
  el('panelImportModal').style.display = 'flex';
  const n = el('piName'); if (n && n.focus) n.focus();
}

function captureImportFields() {
  const c = importCurrent; if (!c) return;
  c.name = el('piName').value; c.kind = el('piKind').value; c.make = el('piMake').value; c.modelNo = el('piModel').value; c.description = el('piDesc').value;
}

// The DIN-rail marker: which way the rail runs through this part and where its centreline is.
export function onPanelImportRail() {
  const c = importCurrent; if (!c) return;
  captureImportFields();
  const axis = el('piRailAxis').value;
  if (axis !== c.railAxis) { c.railAxis = axis; c.railPos = null; }
  showImportModal();
}
export function centrePanelImportRail() {
  const c = importCurrent; if (!c || !c.railAxis) return;
  captureImportFields(); c.railPos = null; showImportModal();
}
function onPreviewClick(e) {
  const c = importCurrent; const svg = el('piPreview').querySelector('svg'); if (!c || !svg || !c.railAxis) return;
  const r = svg.getBoundingClientRect(); if (!r.width || !r.height) return;
  const pos = c.railAxis === 'h' ? (e.clientY - r.top) / r.height * c.dims.h : (e.clientX - r.left) / r.width * c.dims.w;
  captureImportFields();
  c.railPos = Math.round(Math.max(0, Math.min(c.railAxis === 'h' ? c.dims.h : c.dims.w, pos)) * 2) / 2;
  showImportModal();
}

export function onPanelImportUnits() {
  const c = importCurrent; if (!c || c.editId) return;
  captureImportFields();
  const v = parseFloat(el('piUnits').value);
  c.unitScale = v > 0 ? v : null;
  const parsed = parseDxf(c.text, { unitScale: c.unitScale });
  if (parsed.ok) { c.parsed = parsed; c.geo = null; c.railPos = null; showImportModal(); }
}

export function cancelPanelImport() {
  importCurrent = null; importQueue = [];
  const m = el('panelImportModal'); if (m) m.style.display = 'none';
}

export async function confirmPanelImport() {
  const c = importCurrent; if (!c) return;
  const fields = { name: el('piName').value, kind: el('piKind').value, make: el('piMake').value, modelNo: el('piModel').value, description: el('piDesc').value,
    rail: c.railAxis ? { axis: c.railAxis, pos: c.railPos } : null };
  if (c.editId) {
    const r = PD.updateFootprintDetails(FP(), c.editId, fields);
    if (!r.ok) { el('piInfo').innerHTML = `<span style="color:var(--err);">${esc(r.error)}</span>`; return; }
    importCurrent = null; el('panelImportModal').style.display = 'none';
    scheduleAutosave(); const s = activePanelSheet(); if (s) { renderPanelSheet(s); refreshDock(); }
    return;
  }
  const geo = c.geo || buildFootprintGeometry(c.parsed);
  const r = PD.addFootprint(FP(), { ...fields, width: geo.width, height: geo.height, lines: geo.lines, source: c.fileName });
  if (!r.ok) { el('piInfo').innerHTML = `<span style="color:var(--err);">${esc(r.error)}</span>`; return; }
  importCurrent = null; el('panelImportModal').style.display = 'none';
  const sheet = activePanelSheet();
  say(`Imported "${r.footprint.name}" (${r.footprint.width} × ${r.footprint.height} mm).`, 'ok');
  scheduleAutosave();
  if (sheet && r.footprint.kind === 'plate' && !PD.ensurePanel(sheet).plateId) { await setPlate(r.footprint.id); }
  else if (sheet) { renderPanelSheet(sheet); refreshDock(); }
  nextImport();
}

function editFootprint(id) {
  const fp = FP().find(f => f.id === id); if (!fp) return;
  importCurrent = { fileName: fp.source || fp.name, parsed: { bounds: { minX: 0, minY: 0, maxX: fp.width, maxY: fp.height }, polylines: [], skipped: {}, entities: 0, unitName: '' }, editId: id,
    name: fp.name, kind: fp.kind, make: fp.make, modelNo: fp.modelNo, description: fp.description, fpInfo: `${fp.width} × ${fp.height} mm${fp.source ? ' • from ' + fp.source : ''}` };
  // (the rail marker is read from the footprint when the dialog first opens)
  showImportModal();
}

async function deleteFootprintRow(id) {
  const fp = FP().find(f => f.id === id); if (!fp) return;
  if (!(await requirePro())) return;
  const proceed = await appConfirm(`Delete the footprint "${fp.name}" from the library?`);
  if (!proceed) return;
  const r = PD.deleteFootprint(FP(), state.sheets, id);
  say(r.ok ? 'Deleted.' : r.error, r.ok ? 'ok' : 'error');
  if (r.ok) scheduleAutosave();
  refreshDock();
}

async function saveLibraryFile() {
  if (!FP().length) { await appAlert('There are no footprints in this project to save yet.'); return; }
  const saved = await saveTextFile(JSON.stringify(PD.buildFootprintExport(FP())), 'panel-footprints.json', 'application/json', 'Panel Footprints (JSON)');
  if (saved) { say(`Saved ${FP().length} footprint${FP().length === 1 ? '' : 's'} to a file.`, 'ok'); refreshDock(); }
}

async function loadLibraryFile(file) {
  if (!file || !(await requirePro())) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { say('That file could not be read as a panel footprints file.', 'error'); refreshDock(); return; }
  const parsed = PD.parseFootprintFile(data);
  if (!parsed.ok) { say(parsed.error, 'error'); refreshDock(); return; }
  if (!parsed.footprints.length) { say(parsed.skipped ? 'None of the footprints in that file were valid.' : 'That file has no footprints in it.', 'error'); refreshDock(); return; }
  const result = PD.mergeFootprints(FP(), parsed.footprints);
  say('Imported: ' + (result.added ? `${result.added} added` : 'nothing new') + (result.unchanged ? `, ${result.unchanged} already there` : '') + (parsed.skipped ? `, ${parsed.skipped} skipped` : '') + '.', result.added ? 'ok' : '');
  scheduleAutosave(); refreshDock();
}

// ---- thumbnails ----
const thumbCache = new Map();
function pathD(lines, scaleVal) { return lines.map(l => { let d = `M${(l[0] * scaleVal).toFixed(2)} ${(l[1] * scaleVal).toFixed(2)}`; for (let i = 2; i < l.length; i += 2) d += `L${(l[i] * scaleVal).toFixed(2)} ${(l[i + 1] * scaleVal).toFixed(2)}`; return d; }).join(''); }
function thumbSvgFromLines(lines, w, h, size, rail) {
  const s = size / Math.max(w, h, 1), vw = w * s, vh = h * s;
  let mark = '';
  if (rail) {
    const o = rail.axis === 'h' ? (rail.pos - h / 2) * s : (rail.pos - w / 2) * s;
    mark = rail.axis === 'h'
      ? `<line x1="${(-vw / 2).toFixed(1)}" x2="${(vw / 2).toFixed(1)}" y1="${o.toFixed(1)}" y2="${o.toFixed(1)}" stroke="#f97316" stroke-width="1.2" stroke-dasharray="4 2"/>`
      : `<line y1="${(-vh / 2).toFixed(1)}" y2="${(vh / 2).toFixed(1)}" x1="${o.toFixed(1)}" x2="${o.toFixed(1)}" stroke="#f97316" stroke-width="1.2" stroke-dasharray="4 2"/>`;
  }
  return `<svg width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" viewBox="${(-vw / 2).toFixed(1)} ${(-vh / 2).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}"><path d="${pathD(lines, s)}" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>${mark}</svg>`;
}
function thumbSvg(fp, size) {
  if (!fp) return '';
  const key = `${fp.id}:${size}:${fp.lines.length}:${fp.rail ? fp.rail.axis + fp.rail.pos : ''}`;
  if (!thumbCache.has(key)) thumbCache.set(key, thumbSvgFromLines(fp.lines, fp.width, fp.height, size, fp.rail));
  return thumbCache.get(key);
}

// ---- the dock ----
function getDock() {
  let dock = el('panelDock');
  if (dock) return dock;
  const host = el('canvas-container'); if (!host) return null;
  dock = document.createElement('div');
  dock.id = 'panelDock';
  host.appendChild(dock);
  dock.addEventListener('click', onDockClick);
  dock.addEventListener('change', onDockChange);
  dock.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.pd-float-head'); if (!head || e.target.closest('button')) return;
    const card = head.parentElement, r = card.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    card.style.bottom = 'auto'; e.preventDefault();
    const move = (ev) => {
      floatPos = { x: Math.min(window.innerWidth - 60, Math.max(0, ev.clientX - ox)), y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - oy)) };
      card.style.left = floatPos.x + 'px'; card.style.top = floatPos.y + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  return dock;
}

export function syncPanelDock(sheet) {
  const dock = getDock(); if (!dock) return;
  wireStageOnce();
  if (!sheet || getPageType(sheet) !== 'panel') { dock.style.display = 'none'; measureMode = false; measureStart = null; return; }
  dock.style.display = 'flex';
  refreshDock();
}

function refreshDock() {
  const sheet = activePanelSheet(); const dock = getDock();
  if (!dock || !sheet) return;
  const keepScroll = dock.querySelector('.pd-body')?.scrollTop || 0;
  dock.innerHTML = dockHtml(sheet);
  const body = dock.querySelector('.pd-body'); if (body) body.scrollTop = keepScroll;
}

function fpOptions(list, selectedId, blank) {
  return (blank ? `<option value="">${esc(blank)}</option>` : '') + list.map(f => `<option value="${f.id}"${String(f.id) === String(selectedId) ? ' selected' : ''}>${esc(f.name)} (${f.width}×${f.height})</option>`).join('');
}

const plateDimOf = (L, axis) => L.plate ? (axis === 'h' ? L.plate.width : L.plate.height) : 400;

// ---- filtering the parts list by location ----
const inLocation = (p) => !locFilter || (locFilter === '__none' ? !p.locationId : String(p.locationId) === String(locFilter));
const locLabel = (id) => { const l = findLocationById(id); return l ? [l.abbreviation ? '+' + l.abbreviation : '', l.name].filter(Boolean).join(' ') || String(id) : String(id); };
function locOptions(parts) {
  const ids = Array.from(new Set(parts.map(p => p.locationId).filter(Boolean)));
  if (locFilter && locFilter !== '__none' && !ids.includes(locFilter)) locFilter = '';   // that location has no parts any more
  const opt = (v, t) => `<option value="${esc(v)}"${String(locFilter) === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
  let h = opt('', 'All locations');
  ids.sort((a, b) => locLabel(a).localeCompare(locLabel(b), undefined, { numeric: true })).forEach(id => { h += opt(id, locLabel(id)); });
  if (parts.some(p => !p.locationId) && ids.length) h += opt('__none', 'No location');
  return h;
}

function dockHtml(sheet) {
  const panel = PD.ensurePanel(sheet), fps = FP();
  const plates = fps.filter(f => f.kind === 'plate'), partFps = fps.filter(f => f.kind === 'part');
  const L = layoutOf(sheet);
  const parts = allParts(), placedMap = PD.placedKeys(state.sheets);
  const problems = PD.findProblems(panel, fps);
  const orphans = panel.items.filter(it => it.link && !parts.some(p => p.key === PD.linkKey(it.link)));
  const placedCount = parts.filter(p => placedMap.has(p.key)).length;

  let h = `<div class="pd-head"><b>Panel layout</b><span class="pd-spacer"></span><button data-act="toggle-dock" title="${dockOpen ? 'Collapse' : 'Expand'}">${dockOpen ? '▾' : '▸'}</button></div>`;
  const headHtml = h;   // the selected item's details float over the sheet, whether or not the dock is open
  const collapsed = !dockOpen;
  h += '<div class="pd-body">';
  if (message.text) h += `<div class="pd-msg ${message.kind}">${esc(message.text)}</div>`;
  const S = {}; const mark = h.length;
  const cut = (k) => { S[k] = h.slice(mark); h = h.slice(0, mark); };

  // backplate and scale
  h += `<div class="pd-sec"><div class="pd-row"><select data-act="plate">${fpOptions(plates, panel.plateId, plates.length ? '— none —' : '— import a backplate DXF —')}</select><button class="pd-btn" data-act="import" title="Import a backplate or component from a DXF drawing">Import DXF…</button></div>
    <div class="pd-row"><label>Scale</label><select data-act="scale"><option value="">Auto (1:${L.scale})</option>${PD.PANEL_SCALES.map(n => `<option value="${n}"${panel.scale === n ? ' selected' : ''}>1:${n}</option>`).join('')}</select>
    <label>Snap</label><select data-act="snap">${PD.SNAP_OPTIONS.map(n => `<option value="${n}"${panel.snap === n ? ' selected' : ''}>${n ? n + ' mm' : 'Off'}</option>`).join('')}</select></div></div>`;

  cut('plate');

  // measuring
  PD.resolveDims(panel, fps);
  const selObjs = PD.objectRects(panel, fps).filter(o => selected.has(o.id));
  h += `<div class="pd-sec"><div class="pd-row"><button class="pd-btn" data-act="measure-toggle" style="${measureMode ? 'background:#0e7490;color:#fff;' : ''}">${measureMode ? 'Measuring… (Esc)' : '📏 Measure'}</button></div>`;
  if (selObjs.length === 2) {
    const g = PD.gapBetween(selObjs[0].rect, selObjs[1].rect);
    h += g.overlapping ? '<div class="pd-hint">The two selected objects overlap.</div>'
      : `<div class="pd-hint">Gap between the two selected: <b>${g.dist} mm</b>${g.dx && g.dy ? ` (${g.dx} across, ${g.dy} down)` : ''}</div><div class="pd-row"><button class="pd-btn" data-act="dim-pin">Pin this dimension</button></div>`;
  } else if (!measureMode && !panel.dims.length) h += '<div class="pd-hint">Press Measure, then click two points (corners, edges and middles snap). Or select two objects to see the gap between them.</div>';
  panel.dims.forEach((d, i) => { const n = PD.dimInfo(d); h += `<div class="pd-row"><span class="pd-hint" style="flex:1;">${i + 1}. <b>${n.dist} mm</b>${n.straight ? '' : ` (${n.dx} × ${n.dy})`}</span><button data-act="dim-del" data-id="${d.id}" title="Delete">✕</button></div>`; });
  if (panel.dims.length > 1) h += '<div class="pd-row"><button class="pd-btn" data-act="dim-clear">Clear all</button></div>';
  h += '</div>';

  cut('measure');

  // footprint library
  h += `<div class="pd-sec"><div class="pd-row"><button class="pd-btn" data-act="import">Import DXF…</button></div>`;
  {
    if (!fps.length) h += '<div class="pd-hint">Import a DXF drawing of a backplate or a component to start your library.</div>';
    fps.forEach(f => {
      h += `<div class="pd-fp"><div class="pd-thumb">${thumbSvg(f, 38)}</div><div class="pd-fp-main"><div class="pd-fp-name">${esc(f.name)}</div><div class="pd-hint">${f.kind === 'plate' ? 'Backplate' : 'Part'} • ${f.width}×${f.height} mm${f.modelNo ? ' • ' + esc(f.modelNo) : ''}</div></div>
        <div class="pd-fp-btns">${f.kind === 'part' ? `<button data-act="place-free" data-id="${f.id}" title="Place on the plate without linking it to a schematic part">＋</button>` : ''}<button data-act="edit-fp" data-id="${f.id}" title="Edit details">✎</button><button data-act="del-fp" data-id="${f.id}" title="Delete">🗑</button></div></div>`;
    });
    h += `<div class="pd-row"><button class="pd-btn" data-act="save-lib">Save to file</button><button class="pd-btn" data-act="load-lib">Load from file</button></div>`;
  }
  h += '</div>';

  cut('fps');

  // trunking
  const ductCuts = PD.ductCutList(panel);
  const dDraftLen = ductDraft.length ?? Math.max(10, Math.floor((plateDimOf(L, ductDraft.axis) - 40) / 10) * 10);
  h += `<div class="pd-sec">    <div class="pd-row"><select data-act="duct-type">${PD.DUCT_TYPES.map(t => `<option value="${t.id}"${ductDraft.type === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="pd-row"><input type="number" min="10" max="5000" step="10" data-act="duct-len" value="${dDraftLen}" title="Length in mm"><label>mm</label>
    <select data-act="duct-axis"><option value="h"${ductDraft.axis === 'h' ? ' selected' : ''}>Left–right</option><option value="v"${ductDraft.axis === 'v' ? ' selected' : ''}>Up–down</option></select>
    <button class="pd-btn" data-act="duct-add" ${L.plate ? '' : 'disabled'}>Add trunking</button></div>`;
  if (ductCuts.length) h += `<div class="pd-hint"><b>Cut list:</b> ${ductCuts.map(c => `${c.count} × ${esc(c.name)}, ${c.length} mm`).join('; ')}</div>`;
  h += '</div>';

  cut('trunk');

  // DIN rails
  const plateDim = (axis) => L.plate ? (axis === 'h' ? L.plate.width : L.plate.height) : 400;
  const draftLen = railDraft.length ?? Math.max(10, Math.floor((plateDim(railDraft.axis) - 40) / 10) * 10);
  const cuts = PD.railCutList(panel);
  h += `<div class="pd-sec">    <div class="pd-row"><select data-act="rail-type">${PD.RAIL_TYPES.map(t => `<option value="${t.id}"${railDraft.type === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="pd-row"><input type="number" min="10" max="5000" step="10" data-act="rail-len" value="${draftLen}" title="Length in mm"><label>mm</label>
    <select data-act="rail-axis"><option value="h"${railDraft.axis === 'h' ? ' selected' : ''}>Left–right</option><option value="v"${railDraft.axis === 'v' ? ' selected' : ''}>Up–down</option></select>
    <button class="pd-btn" data-act="rail-add" ${L.plate ? '' : 'disabled'}>Add rail</button></div>`;
  if (cuts.length) h += `<div class="pd-hint"><b>Cut list:</b> ${cuts.map(c => `${c.count} × ${esc(c.name)}, ${c.length} mm`).join('; ')}</div>`;
  else h += '<div class="pd-hint">Parts with a rail marker click onto a rail when you drop them near it, and are placed along it automatically.</div>';
  h += '</div>';

  cut('rails');

  // parts from the schematic
  h += `<div class="pd-sec"><div class="pd-row"><span class="pd-hint">Show</span>
    <select data-act="filter" style="width:auto;"><option value="unplaced"${partsFilter === 'unplaced' ? ' selected' : ''}>Unplaced</option><option value="all"${partsFilter === 'all' ? ' selected' : ''}>All</option></select>
    <span class="pd-hint">in</span>
    <select data-act="loc-filter" style="width:auto;" title="Show only the parts in one location">${locOptions(parts)}</select></div>`;
  if (!parts.length) h += '<div class="pd-hint">No parts on the schematic sheets yet.</div>';
  const shown = parts.filter(p => (partsFilter === 'all' || !placedMap.has(p.key)) && inLocation(p));
  if (parts.length && !shown.length) h += `<div class="pd-hint">${locFilter ? 'Nothing to show in this location.' : 'Everything is placed.'}</div>`;
  const doneBlocks = new Set();
  shown.forEach(p => {
    if (p.block) {
      if (doneBlocks.has(p.block)) return;
      doneBlocks.add(p.block);
      const members = parts.filter(q => q.block === p.block && inLocation(q));
      const unplaced = members.filter(q => !placedMap.has(q.key));
      const name = p.designator.split(':')[0];
      const guess = PD.matchFootprint(partFps, p.modelNo, p.make);
      const choice = rowChoice.get('block:' + p.block) ?? (guess ? guess.id : '');
      h += `<div class="pd-part"><div class="pd-part-top"><b>${esc(name)}</b><span class="pd-hint">${members.length} terminal${members.length === 1 ? '' : 's'}${p.modelNo ? ' • ' + esc(p.modelNo) : ''} • ${unplaced.length} unplaced</span></div>
        <div class="pd-row"><select data-act="row-fp" data-key="block:${esc(p.block)}">${fpOptions(partFps, choice, '— footprint —')}</select>
        <button class="pd-btn" data-act="place-block" data-key="${esc(p.block)}" ${choice && unplaced.length ? '' : 'disabled'} title="Place every unplaced terminal of this block side by side">Place ${unplaced.length || ''}</button></div></div>`;
      return;
    }
    const placed = placedMap.get(p.key);
    const guess = PD.matchFootprint(partFps, p.modelNo, p.make);
    const choice = rowChoice.get(p.key) ?? (guess ? guess.id : '');
    h += `<div class="pd-part"><div class="pd-part-top"><b>${esc(p.designator)}</b><span class="pd-hint">${esc([p.make, p.modelNo].filter(Boolean).join(' ') || p.description || 'no part number')}</span><span class="pd-ref">${esc(p.ref)}</span></div>`;
    if (placed) h += `<div class="pd-row"><span class="pd-ok">✓ placed${placed.panelSheetId !== sheet.id ? ' on another panel sheet' : ''}</span>${placed.panelSheetId === sheet.id ? `<button class="pd-btn" data-act="select-item" data-id="${placed.item.id}">Select</button>` : ''}</div>`;
    else h += `<div class="pd-row"><select data-act="row-fp" data-key="${esc(p.key)}">${fpOptions(partFps, choice, '— footprint —')}</select><button class="pd-btn" data-act="place" data-key="${esc(p.key)}" ${choice ? '' : 'disabled'}>Place</button></div>`;
    h += '</div>';
  });
  h += '</div>';

  cut('parts');

  // selection
  const sel = panel.items.filter(it => selected.has(it.id));
  const selRails = panel.rails.filter(r => selected.has(r.id));
  const selDucts = panel.ducts.filter(d => selected.has(d.id));
  if (selDucts.length === 1 && !sel.length && !selRails.length) {
    const d = selDucts[0], plate = L.plate;
    h += `<div class="pd-sec"><b class="pd-sel-title">${esc(PD.ductType(d.type).name)}</b>
      <div class="pd-row"><label>X</label><input type="number" step="0.5" data-act="duct-x" value="${plate ? Math.round((d.x + plate.width / 2) * 100) / 100 : d.x}"><label>Y</label><input type="number" step="0.5" data-act="duct-y" value="${plate ? Math.round((d.y + plate.height / 2) * 100) / 100 : d.y}"></div>
      <div class="pd-hint">Centre of the trunking, mm from the plate's top-left corner.</div>
      <div class="pd-row"><label>Length</label><input type="number" min="10" max="5000" step="10" data-act="duct-length" value="${d.length}"><label>mm</label><button class="pd-btn" data-act="duct-fit" ${plate ? '' : 'disabled'} title="Make it run the full width (or height) of the plate">Fit plate</button></div>
      <div class="pd-row"><select data-act="duct-settype">${PD.DUCT_TYPES.map(t => `<option value="${t.id}"${d.type === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="pd-row"><button class="pd-btn" data-act="rail-turn">Turn 90°</button><button class="pd-btn" data-act="dup-run" title="Copy this and paste it beside the original (Ctrl+D)">Duplicate</button><span class="pd-spacer"></span><button class="pd-btn" data-act="remove">Remove</button></div></div>`;
  } else if (selRails.length === 1 && !sel.length && !selDucts.length) {
    const r = selRails[0], plate = L.plate, mounted = PD.partsOnRail(panel, r, fps).length;
    h += `<div class="pd-sec"><b class="pd-sel-title">${esc(PD.railType(r.type).name)}</b><div class="pd-hint">${mounted} part${mounted === 1 ? '' : 's'} mounted on it. Drag it to move them with it.</div>
      <div class="pd-row"><label>X</label><input type="number" step="0.5" data-act="rail-x" value="${plate ? Math.round((r.x + plate.width / 2) * 100) / 100 : r.x}"><label>Y</label><input type="number" step="0.5" data-act="rail-y" value="${plate ? Math.round((r.y + plate.height / 2) * 100) / 100 : r.y}"></div>
      <div class="pd-hint">Centre of the rail, mm from the plate's top-left corner.</div>
      <div class="pd-row"><label>Length</label><input type="number" min="10" max="5000" step="10" data-act="rail-length" value="${r.length}"><label>mm</label><button class="pd-btn" data-act="rail-fit" ${plate ? '' : 'disabled'} title="Make it run the full width of the plate">Fit plate</button></div>
      <div class="pd-row"><button class="pd-btn" data-act="rail-turn">Turn 90°</button><button class="pd-btn" data-act="dup-run" title="Copy this and paste it beside the original (Ctrl+D)">Duplicate</button><span class="pd-spacer"></span><button class="pd-btn" data-act="remove">Remove</button></div></div>`;
  } else if (sel.length + selRails.length + selDucts.length > 1) {
    h += `<div class="pd-sec"><b class="pd-sel-title">${sel.length + selRails.length + selDucts.length} selected</b><div class="pd-hint">Drag one to move them all. Shift-click to add or remove parts; Alt-click a terminal to pick its whole block.</div><div class="pd-row"><button class="pd-btn" data-act="dup-run" title="Duplicate the selected trunking and rails (Ctrl+D)">Duplicate runs</button><span class="pd-spacer"></span><button class="pd-btn" data-act="remove">Remove selected</button></div></div>`;
  } else if (sel.length === 1) {
    const it = sel[0], fp = fps.find(f => String(f.id) === String(it.footprintId));
    const part = it.link ? parts.find(p => p.key === PD.linkKey(it.link)) : null;
    const plate = L.plate;
    h += `<div class="pd-sec"><b class="pd-sel-title">${esc(part ? part.designator : (it.link ? 'Missing part' : (fp ? fp.name : 'Item')))}</b>`;
    if (part) h += `<div class="pd-hint">${esc([part.make, part.modelNo].filter(Boolean).join(' '))}</div><div class="pd-row"><span class="pd-ref">${esc(part.ref)}</span><button class="pd-btn" data-act="goto" data-id="${it.id}">Go to schematic</button></div>`;
    else if (it.link) h += '<div class="pd-hint" style="color:var(--err);">Its schematic part has been deleted.</div>';
    const mates = blockMates(panel, it);
    if (mates.length > 1) h += `<div class="pd-row"><button class="pd-btn" data-act="select-block" title="Select every placed terminal of this block, so dragging moves the whole block (or Alt-click a terminal)">Select whole block (${mates.length} terminals)</button></div>`;
    if (!it.link) h += `<div class="pd-row"><label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" data-act="hide-name" style="flex:none;width:auto;"${it.hideName ? ' checked' : ''}> Hide the name on the drawing</label></div>`;
    h += `<div class="pd-row"><label>X</label><input type="number" step="0.5" data-act="pos-x" value="${plate ? Math.round((it.x + plate.width / 2) * 100) / 100 : it.x}"><label>Y</label><input type="number" step="0.5" data-act="pos-y" value="${plate ? Math.round((it.y + plate.height / 2) * 100) / 100 : it.y}"></div>
      <div class="pd-hint">Centre of the part, mm from the plate's top-left corner.</div>
      <div class="pd-row"><label>Turn</label><select data-act="rot">${[0, 90, 180, 270].map(r => `<option value="${r}"${PD.normaliseRotation(it.rotation) === r ? ' selected' : ''}>${r}°</option>`).join('')}</select><span class="pd-spacer"></span><button class="pd-btn" data-act="remove">Remove</button></div></div>`;
  }

  cut('sel');

  // checks
  const issues = [];
  if (problems.overlaps.length) issues.push(`<span style="color:var(--err);">${problems.overlaps.length} overlap${problems.overlaps.length === 1 ? '' : 's'} (red)</span>`);
  if (problems.outside.length) issues.push(`<span style="color:var(--warn);">${problems.outside.length} off the plate (orange)</span>`);
  const rp = PD.findRailProblems(panel, fps);
  if (rp.railsOutside.length) issues.push(`<span style="color:var(--warn);">${rp.railsOutside.length} rail${rp.railsOutside.length === 1 ? '' : 's'} stick out past the plate</span>`);
  if (rp.overhang.length) issues.push(`<span style="color:var(--warn);">${rp.overhang.length} part${rp.overhang.length === 1 ? '' : 's'} overhang the end of their rail</span>`);
  const dp = PD.findDuctProblems(panel, fps);
  if (dp.outside.length) issues.push(`<span style="color:var(--warn);">${dp.outside.length} trunking run${dp.outside.length === 1 ? '' : 's'} stick out past the plate</span>`);
  if (dp.onParts.length) issues.push(`<span style="color:var(--err);">${dp.onParts.length} part${dp.onParts.length === 1 ? '' : 's'} lie across trunking (red)</span>`);
  if (dp.onRails.length) issues.push(`<span style="color:var(--err);">${dp.onRails.length} trunking run${dp.onRails.length === 1 ? '' : 's'} cross a DIN rail</span>`);
  if (orphans.length) issues.push(`<span style="color:var(--err);">${orphans.length} with a deleted schematic part</span> <button class="pd-btn" data-act="remove-orphans">Remove</button>`);
  h += `<div class="pd-sec"><div class="pd-hint">${issues.length ? issues.join('<br>') : (panel.items.length || panel.ducts.length ? '✓ No overlaps, nothing off the plate.' : 'Nothing placed yet.')}</div></div>`;
  cut('checks');

  const card = (key, title, pill, body) => {
    const open = secOpen[key] || (key === 'measure' && measureMode);
    return `<div class="pd-card${open ? ' open' : ''}"><button class="pd-card-head" data-act="toggle-sec" data-sec="${key}"><span class="pd-chev">${open ? '▾' : '▸'}</span><span class="pd-card-title">${title}</span><span class="pd-pill">${pill}</span></button>${open ? `<div class="pd-card-body">${body}</div>` : ''}</div>`;
  };
  h += card('plate', 'Backplate', plates.length ? (L.plate ? 'set' : 'none') : 'none', S.plate);
  h += card('parts', 'Schematic parts', `${placedCount}/${parts.length} placed`, S.parts);
  h += `<div class="pd-card pd-checks ${issues.length ? 'pd-bad' : 'pd-good'}"><div class="pd-card-head static"><span class="pd-card-title">Checks</span><span class="pd-pill">${issues.length ? issues.length + ' issue' + (issues.length === 1 ? '' : 's') : '✓ OK'}</span></div><div class="pd-card-body">${S.checks}</div></div>`;
  h += '<div class="pd-group">Tools</div>';
  h += card('measure', '📏 Measure', panel.dims.length, S.measure);
  h += card('trunk', 'Trunking', panel.ducts.length, S.trunk);
  h += card('rails', 'DIN rails', panel.rails.length, S.rails);
  h += card('fps', 'Footprint library', fps.length, S.fps);
  h += '<input type="file" id="panelLibInput" accept=".json,application/json" style="display:none;"><input type="file" id="panelDxfInput" accept=".dxf,.DXF" multiple style="display:none;"></div>';
  const floatHtml = S.sel ? floatCard(S.sel) : '';
  return collapsed ? headHtml + floatHtml : h + floatHtml;
}

// The selected item's details: a card floating over the sheet (bottom-left by default, draggable by its
// title bar) that is there while something is selected and gone when nothing is.
let floatPos = null;
function floatCard(inner) {
  const host = el('canvas-container'); const r = host ? host.getBoundingClientRect() : null;
  const pos = floatPos
    ? `left:${Math.round(floatPos.x)}px;top:${Math.round(floatPos.y)}px;`
    : (r ? `left:${Math.round(r.left + 14)}px;bottom:${Math.round(window.innerHeight - r.bottom + 14)}px;` : 'left:14px;bottom:14px;');
  return `<div class="pd-float" style="${pos}"><div class="pd-float-head"><b>Selected</b><span class="pd-spacer"></span><button data-act="sel-close" title="Deselect">✕</button></div><div class="pd-float-body">${inner}</div></div>`;
}

function addDuct(sheet) {
  const L = layoutOf(sheet), panel = L.panel; if (!L.plate) return;
  const t = PD.ductType(ductDraft.type), axis = ductDraft.axis;
  const length = ductDraft.length ?? Math.max(10, Math.floor((plateDimOf(L, axis) - 40) / 10) * 10);
  pushHistory();
  // find clear space, treating existing rails and trunking as parts of the same size
  const pseudo = [], items = panel.items.map(it => ({ ...it }));
  const addBox = (o, wid) => { const id = 'b' + o.id; pseudo.push({ id, width: o.axis === 'h' ? o.length : wid, height: o.axis === 'h' ? wid : o.length, lines: [] }); items.push({ id: o.id, footprintId: id, x: o.x, y: o.y, rotation: 0 }); };
  panel.rails.forEach(r => addBox(r, PD.railType(r.type).width));
  panel.ducts.forEach(d => addBox(d, PD.ductType(d.type).width));
  const me = { id: 'new', width: axis === 'h' ? length : t.width, height: axis === 'h' ? t.width : length, lines: [] };
  const spot = PD.findFreeSpot({ plateId: panel.plateId, items }, [...FP(), ...pseudo], me, 0);
  const duct = { id: newItemId(), x: spot.x, y: spot.y, length, axis, type: t.id };
  panel.ducts.push(duct);
  selected = new Set([duct.id]);
  if (length > plateDimOf(L, axis)) say('That run is longer than the plate.', 'error'); else say('');
  afterChange(sheet);
}

function addRail(sheet) {
  const L = layoutOf(sheet), panel = L.panel; if (!L.plate) return;
  const t = PD.railType(railDraft.type), axis = railDraft.axis;
  const length = railDraft.length ?? Math.max(10, Math.floor(((axis === 'h' ? L.plate.width : L.plate.height) - 40) / 10) * 10);
  pushHistory();
  // find clear space, treating the existing rails as parts of the same size
  const pseudo = [], items = panel.items.map(it => ({ ...it }));
  panel.rails.forEach(r => { const id = 'r' + r.id; pseudo.push({ id, width: r.axis === 'h' ? r.length : PD.railType(r.type).width, height: r.axis === 'h' ? PD.railType(r.type).width : r.length, lines: [] }); items.push({ id: r.id, footprintId: id, x: r.x, y: r.y, rotation: 0 }); });
  const me = { id: 'new', width: axis === 'h' ? length : t.width, height: axis === 'h' ? t.width : length, lines: [] };
  const spot = PD.findFreeSpot({ plateId: panel.plateId, items }, [...FP(), ...pseudo], me, 0);
  const rail = { id: newItemId(), x: spot.x, y: spot.y, length, axis, type: t.id };
  panel.rails.push(rail);
  selected = new Set([rail.id]);
  if (length > (axis === 'h' ? L.plate.width : L.plate.height)) say('That rail is longer than the plate.', 'error'); else say('');
  afterChange(sheet);
}

function onDockClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act; const sheet = activePanelSheet(); if (!sheet) return;
  const panel = PD.ensurePanel(sheet);
  const sel = panel.items.filter(it => selected.has(it.id));
  switch (act) {
    case 'toggle-dock': dockOpen = !dockOpen; refreshDock(); break;
    case 'sel-close': selected = new Set(); renderPanelSheet(sheet); refreshDock(); break;
    case 'toggle-sec': secOpen[t.dataset.sec] = !secOpen[t.dataset.sec]; refreshDock(); break;
    case 'import': { say(''); const i = el('panelDxfInput'); if (i) { i.onchange = () => { const f = Array.from(i.files); i.value = ''; startPanelImport(f); }; i.click(); } break; }
    case 'save-lib': saveLibraryFile(); break;
    case 'load-lib': { const i = el('panelLibInput'); if (i) { i.onchange = () => { loadLibraryFile(i.files[0]); i.value = ''; }; i.click(); } break; }
    case 'edit-fp': editFootprint(Number(t.dataset.id)); break;
    case 'del-fp': deleteFootprintRow(Number(t.dataset.id)); break;
    case 'place-free': say(''); placeFree(t.dataset.id); break;
    case 'place': say(''); placePart(t.dataset.key, rowChoice.get(t.dataset.key) ?? PD.matchFootprint(FP().filter(f => f.kind === 'part'), (allParts().find(p => p.key === t.dataset.key) || {}).modelNo, (allParts().find(p => p.key === t.dataset.key) || {}).make)?.id); break;
    case 'place-block': { say(''); const k = 'block:' + t.dataset.key; const p = allParts().find(q => q.block === t.dataset.key); placeBlock(t.dataset.key, rowChoice.get(k) ?? PD.matchFootprint(FP().filter(f => f.kind === 'part'), p?.modelNo, p?.make)?.id); break; }
    case 'select-block': { const it = sel[0]; if (it) { selected = new Set(blockMates(panel, it).map(m => m.id)); renderPanelSheet(sheet); refreshDock(); } break; }
    case 'select-item': selected = new Set([Number(t.dataset.id)]); renderPanelSheet(sheet); refreshDock(); break;
    case 'goto': { const it = sel[0]; if (it) goToLink(it); break; }
    case 'remove': panelDeleteSelected(); break;
    case 'measure-toggle': setMeasureMode(!measureMode); if (measureMode) secOpen.measure = true; break;
    case 'dim-del': { pushHistory(); panel.dims = panel.dims.filter(d => String(d.id) !== t.dataset.id); afterChange(sheet); break; }
    case 'dim-clear': { pushHistory(); panel.dims = []; afterChange(sheet); break; }
    case 'dim-pin': {
      const objs = PD.objectRects(panel, FP()).filter(o => selected.has(o.id)); if (objs.length !== 2) break;
      const g = PD.gapBetween(objs[0].rect, objs[1].rect);
      const dim = PD.cleanDim({ id: newItemId(), x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, gap: [objs[0].id, objs[1].id] });
      if (dim) { pushHistory(); panel.dims.push(dim); } else say('Those objects are touching, so there is no gap to pin.', 'error');
      afterChange(sheet); break;
    }
    case 'rail-add': addRail(sheet); break;
    case 'duct-add': addDuct(sheet); break;
    case 'duct-fit': {
      const d = panel.ducts.find(q => selected.has(q.id)); const plate = layoutOf(sheet).plate; if (!d || !plate) break;
      pushHistory();
      d.length = Math.round((d.axis === 'h' ? plate.width : plate.height) * 100) / 100;
      if (d.axis === 'h') d.x = 0; else d.y = 0;
      afterChange(sheet); break;
    }
    case 'rail-turn': panelRotateSelected(); break;
    case 'dup-run': duplicatePanelSelected(); break;
    case 'rail-fit': {
      const r = panel.rails.find(q => selected.has(q.id)); const plate = layoutOf(sheet).plate; if (!r || !plate) break;
      pushHistory();
      const mounted = PD.partsOnRail(panel, r, FP());
      const len = r.axis === 'h' ? plate.width : plate.height;
      const shift = r.axis === 'h' ? -r.x : -r.y;           // centre it along its own direction
      r.length = Math.round(len * 100) / 100;
      mounted.forEach(it => { if (r.axis === 'h') it.x = Math.round((it.x + shift) * 100) / 100; else it.y = Math.round((it.y + shift) * 100) / 100; });
      if (r.axis === 'h') r.x = 0; else r.y = 0;
      afterChange(sheet); break;
    }
    case 'remove-orphans': {
      const parts = allParts(); pushHistory();
      panel.items = panel.items.filter(it => !it.link || parts.some(p => p.key === PD.linkKey(it.link)));
      selected = new Set(); afterChange(sheet); break;
    }
    default: break;
  }
}

function onDockChange(e) {
  const t = e.target; const act = t.dataset && t.dataset.act; if (!act) return;
  const sheet = activePanelSheet(); if (!sheet) return;
  const panel = PD.ensurePanel(sheet);
  switch (act) {
    case 'plate': setPlate(t.value); break;
    case 'scale': pushHistory(); panel.scale = t.value ? Number(t.value) : null; afterChange(sheet); break;
    case 'snap': panel.snap = Number(t.value); scheduleAutosave(); refreshDock(); break;
    case 'filter': partsFilter = t.value; refreshDock(); break;
    case 'loc-filter': locFilter = t.value; refreshDock(); break;
    case 'hide-name': {   // a free item's name drawn under it, or not
      const it = panel.items.find(q => selected.has(q.id) && !q.link); if (!it) break;
      pushHistory();
      if (t.checked) it.hideName = true; else delete it.hideName;
      afterChange(sheet); break;
    }
    case 'duct-type': ductDraft.type = t.value; refreshDock(); break;
    case 'duct-axis': ductDraft.axis = t.value === 'v' ? 'v' : 'h'; ductDraft.length = null; refreshDock(); break;
    case 'duct-len': { const v = parseFloat(t.value); ductDraft.length = v > 0 ? Math.min(5000, v) : null; refreshDock(); break; }
    case 'duct-settype': case 'duct-x': case 'duct-y': case 'duct-length': {
      const d = panel.ducts.find(q => selected.has(q.id)); if (!d) return;
      const plate = layoutOf(sheet).plate;
      pushHistory();
      if (act === 'duct-settype') d.type = PD.ductType(t.value).id;
      else {
        const v = parseFloat(t.value); if (!Number.isFinite(v)) { refreshDock(); return; }
        if (act === 'duct-length') { if (v < 10 || v > 5000) { refreshDock(); return; } d.length = Math.round(v * 100) / 100; }
        else if (act === 'duct-x') d.x = Math.round((v - (plate ? plate.width / 2 : 0)) * 100) / 100;
        else d.y = Math.round((v - (plate ? plate.height / 2 : 0)) * 100) / 100;
      }
      afterChange(sheet); break;
    }
    case 'rail-type': railDraft.type = t.value; refreshDock(); break;
    case 'rail-axis': railDraft.axis = t.value === 'v' ? 'v' : 'h'; railDraft.length = null; refreshDock(); break;
    case 'rail-len': { const v = parseFloat(t.value); railDraft.length = v > 0 ? Math.min(5000, v) : null; refreshDock(); break; }
    case 'rail-x': case 'rail-y': case 'rail-length': {
      const r = panel.rails.find(q => selected.has(q.id)); if (!r) return;
      const v = parseFloat(t.value); if (!Number.isFinite(v)) { refreshDock(); return; }
      const plate = layoutOf(sheet).plate;
      pushHistory();
      if (act === 'rail-length') { if (v < 10 || v > 5000) { refreshDock(); return; } r.length = Math.round(v * 100) / 100; }
      else {
        const mounted = PD.partsOnRail(panel, r, FP());
        const nx = act === 'rail-x' ? Math.round((v - (plate ? plate.width / 2 : 0)) * 100) / 100 : r.x;
        const ny = act === 'rail-y' ? Math.round((v - (plate ? plate.height / 2 : 0)) * 100) / 100 : r.y;
        const dx = nx - r.x, dy = ny - r.y;
        mounted.forEach(it => { it.x = Math.round((it.x + dx) * 100) / 100; it.y = Math.round((it.y + dy) * 100) / 100; });
        r.x = nx; r.y = ny;
      }
      afterChange(sheet); break;
    }
    case 'row-fp': { const v = t.value ? Number(t.value) : ''; rowChoice.set(t.dataset.key, v); refreshDock(); break; }
    case 'pos-x': case 'pos-y': case 'rot': {
      const it = panel.items.find(i => selected.has(i.id)); if (!it) return;
      const plate = layoutOf(sheet).plate;
      pushHistory();
      if (act === 'rot') it.rotation = Number(t.value);
      else {
        const v = parseFloat(t.value); if (!Number.isFinite(v)) { refreshDock(); return; }
        if (act === 'pos-x') it.x = Math.round((v - (plate ? plate.width / 2 : 0)) * 100) / 100;
        else it.y = Math.round((v - (plate ? plate.height / 2 : 0)) * 100) / 100;
      }
      afterChange(sheet); break;
    }
    default: break;
  }
}

// ---- for the BOM ----
// How many of a part's instances have been placed on a panel sheet (see 6_bom.js).
export function panelPlacedKeys() { return PD.placedKeys(state.sheets); }
export function panelSheetsExist() { return state.sheets.some(s => getPageType(s) === 'panel'); }
