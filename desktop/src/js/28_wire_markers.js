// ==========================================
// 28. WIRE MARKERS (CSV for marker-printing software)
// ==========================================
// Builds the list of wire markers to print — one for every point where a wire
// meets a device — and saves it as a CSV that Weidmüller M-Print PRO (or any
// marker-printing software that imports a text/CSV list) can read.
//
// A wire has two ends and each end needs its own marker, so a wire between two
// devices produces two rows. A wire that is split by a terminal produces a row
// at the device, a row on each side of the terminal, and one at the far device.
// Ends that land on nothing (open ends, T-junctions) and on supply / ground
// symbols are not device connections, so they get no marker.
import { state, saveTextFile, getSchematicSheetNumber, getRefText, getDisplayDesignator, getPinsForType, getPageType, appAlert } from './1_config_state.js';
import { isTerminal, terminalDisplayText, collectTerminalTableData } from './11_terminal_blocks.js';

const TOL = 1.5;
const SKIP_TYPES = new Set(['gnd', 'supply_3n_pe', 'supply_1n_pe', 'supply_3_pe']);

function csvCell(val, delim) {
  const s = String(val ?? '');
  return (s.includes(delim) || /["\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pinWorld(comp, pin) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const fx = comp.flipX ? -1 : 1, fy = comp.flipY ? -1 : 1;
  return { x: comp.x + fx * pin.relX * c - fy * pin.relY * s, y: comp.y + fx * pin.relX * s + fy * pin.relY * c };
}

// The device pin sitting at a point on a sheet, or null.
export function pinAt(sheet, x, y) {
  for (const comp of sheet.components || []) {
    if (SKIP_TYPES.has(comp.type) || String(comp.type).startsWith('custom_shield_')) continue;
    const pins = getPinsForType(comp.type);
    for (let i = 0; i < pins.length; i++) {
      const w = pinWorld(comp, pins[i]);
      if (Math.abs(w.x - x) <= TOL && Math.abs(w.y - y) <= TOL) return { comp, pin: pins[i], index: i };
    }
  }
  return null;
}

// ---- what a pin is called ----
// A pin drawn in the Symbol Studio is only numbered in the order it was placed; the name an engineer uses (U, V, W, PE, A1,
// DI5) is a separate piece of text drawn beside it. So, unless the pin was given a name of its own, the name is the short text
// sitting beside it on the symbol. It is only used when it is clear: the text must be close to the pin and clearly closer to it
// than any other short text is, and the pin must be the nearest pin to the text. Anything less certain falls back to the pin's
// number rather than guessing, and a name typed on the pin in the Symbol Studio always wins.
const LABEL_REACH = 40;       // symbol units from the pin to the nearest edge of its label
const LABEL_MARGIN = 1.5;     // the runner-up must be at least this much further away
const LABEL_SHAPE = /^[A-Za-z0-9+\-][A-Za-z0-9.+\-/]{0,5}$/;
const labelCache = new WeakMap();

function textBox(t) {
  const size = (Number.isFinite(t.fontSize) && t.fontSize > 0 ? t.fontSize : 12) * 0.5;     // the sheet draws stored sizes halved
  const len = String(t.text).length * size * 0.6;
  const rad = ((t.rotation || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const xs = [], ys = [];
  [[0, 0], [len, 0], [len, size], [0, size]].forEach(([x, y]) => { xs.push(t.relX + x * c - y * s); ys.push(t.relY + x * s + y * c); });
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}
const gapTo = (box, x, y) => Math.hypot(Math.max(box.l - x, 0, x - box.r), Math.max(box.t - y, 0, y - box.b));

// One label (or '') per pin of a symbol type.
export function pinLabelsFor(type) {
  const def = window.customSymbolDefinitions && window.customSymbolDefinitions[type];
  if (!def || !Array.isArray(def.pins) || !def.pins.length) return [];
  const hit = labelCache.get(def.pins);
  if (hit && hit.texts === def.texts) return hit.labels;

  const pins = def.pins;
  const cands = (Array.isArray(def.texts) ? def.texts : [])
    .filter(t => t && typeof t.text === 'string' && Number.isFinite(t.relX) && Number.isFinite(t.relY) && LABEL_SHAPE.test(t.text.trim()))
    .map(t => ({ text: t.text.trim(), box: textBox({ ...t, text: t.text.trim() }) }));
  const labels = pins.map(() => '');
  pins.forEach((p, i) => {
    if (p.name || !Number.isFinite(p.relX) || !Number.isFinite(p.relY)) return;
    const near = cands.map(c => ({ c, d: gapTo(c.box, p.relX, p.relY) })).filter(o => o.d <= LABEL_REACH).sort((a, b) => a.d - b.d);
    if (!near.length) return;
    if (near.length > 1 && near[1].d < Math.max(near[0].d, 1) * LABEL_MARGIN) return;           // two candidates: not sure
    const best = near[0].c;
    // the pin must be the one closest to this text
    let nearest = -1, nd = Infinity;
    pins.forEach((q, j) => { if (!Number.isFinite(q.relX) || !Number.isFinite(q.relY)) return; const d = gapTo(best.box, q.relX, q.relY); if (d < nd - 1e-6) { nd = d; nearest = j; } });
    if (nearest === i) labels[i] = best.text;
  });
  labelCache.set(def.pins, { texts: def.texts, labels });
  return labels;
}

export function pinNameOf(comp, pin, index) {
  return pin.name || pinLabelsFor(comp.type)[index] || pin.id || String(index + 1);
}

export function deviceName(hit, sheet) {
  const comp = hit.comp;
  if (isTerminal(comp)) {
    const t = terminalDisplayText(comp, sheet);
    if (t) return { device: t, pin: '' };
  }
  let label = comp.label || '?';
  if (comp.parentId && typeof window.findComponentById === 'function') {
    const parent = window.findComponentById(comp.parentId);
    if (parent) label = `${parent.label}${comp.contactNo ? '.' + comp.contactNo : ''}`;
  }
  const pin = pinNameOf(comp, hit.pin, hit.index);
  return { device: getDisplayDesignator(label, comp, sheet), pin: String(pin) };
}

export function endText(hit, sheet) {
  if (!hit) return '';
  const n = deviceName(hit, sheet);
  return n.pin ? `${n.device}:${n.pin}` : n.device;
}

function cableFor(wireId) {
  for (const cable of state.cables || []) {
    const core = Object.keys(cable.coreWireIds || {}).find(k => cable.coreWireIds[k] === wireId);
    if (core) return { cable: cable.designator || '', core, colour: (cable.coreColours || {})[core] || '' };
  }
  return { cable: '', core: '', colour: '' };
}

export function buildWireMarkers(opts = {}) {
  const includeTerminals = opts.includeTerminals !== false;
  const rows = [];
  const seen = new Set();
  let unlabelled = 0;

  (state.sheets || []).forEach((sheet, sIdx) => {
    if (getPageType(sheet) !== 'schematic') return;
    (sheet.wires || []).forEach(wire => {
      const p = wire.points;
      if (!p || p.length < 4) return;
      const ends = [
        { x: p[0], y: p[1], ox: p[p.length - 2], oy: p[p.length - 1] },
        { x: p[p.length - 2], y: p[p.length - 1], ox: p[0], oy: p[1] }
      ];
      const wireId = wire.wireId === undefined || wire.wireId === null ? '' : String(wire.wireId).trim();
      ends.forEach(e => {
        const hit = pinAt(sheet, e.x, e.y);
        if (!hit) return;
        if (!includeTerminals && isTerminal(hit.comp)) return;
        if (!wireId) { unlabelled++; return; }
        const key = `${sheet.id}|${hit.comp.id}|${hit.index}|${wire.id}|${wireId}`;
        if (seen.has(key)) return;
        seen.add(key);
        const n = deviceName(hit, sheet);
        const far = pinAt(sheet, e.ox, e.oy);
        const cab = cableFor(wireId);
        rows.push({
          wireId,
          sheet: getSchematicSheetNumber(sIdx),
          device: n.device,
          pin: n.pin,
          connection: n.pin ? `${n.device}:${n.pin}` : n.device,
          to: far ? endText(far, sheet) : '',
          cable: cab.cable, core: cab.core, colour: cab.colour,
          ref: getRefText(e.x, e.y, sIdx)
        });
      });
    });
  });

  rows.sort((a, b) => a.wireId.localeCompare(b.wireId, undefined, { numeric: true })
    || a.connection.localeCompare(b.connection, undefined, { numeric: true }));
  return { rows, unlabelled };
}

// rows -> CSV text. mode 'simple' = one marker text per line; 'detailed' = all columns.
// perWire collapses to one line per wire ID with a Qty column.
export function wireMarkersToCsv(rows, { mode = 'detailed', delimiter = ',', perWire = false } = {}) {
  const d = delimiter;
  const lines = [];
  if (perWire) {
    const groups = new Map();
    rows.forEach(r => {
      if (!groups.has(r.wireId)) groups.set(r.wireId, { wireId: r.wireId, qty: 0, ends: [] });
      const g = groups.get(r.wireId); g.qty++; g.ends.push(r.connection);
    });
    if (mode === 'simple') lines.push(['Marker', 'Qty'].join(d));
    else lines.push(['Marker', 'Qty', 'Connections'].join(d));
    groups.forEach(g => {
      lines.push((mode === 'simple' ? [g.wireId, g.qty] : [g.wireId, g.qty, g.ends.join(' | ')]).map(v => csvCell(v, d)).join(d));
    });
    return lines.join('\r\n') + '\r\n';
  }
  if (mode === 'simple') {
    lines.push('Marker');
    rows.forEach(r => lines.push(csvCell(r.wireId, d)));
  } else {
    lines.push(['Marker', 'Sheet', 'Device', 'Pin', 'Connection', 'To', 'Cable', 'Core', 'Core colour', 'Reference'].join(d));
    rows.forEach(r => lines.push([r.wireId, r.sheet ?? '', r.device, r.pin, r.connection, r.to, r.cable, r.core, r.colour, r.ref].map(v => csvCell(v, d)).join(d)));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---- modal ----

function ensureModal() {
  let m = document.getElementById('wireMarkerModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'wireMarkerModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card" style="width: 600px; max-width: 92vw;">
    <div class="modal-header"><h3>Wire Markers (CSV)</h3><button type="button" class="btn-icon" id="wmClose">&#10005;</button></div>
    <p class="modal-hint">One marker for every point where a wire meets a device or terminal, so a wire between two devices gives two markers. Save the CSV and import it into your marker-printing software (e.g. Weidm&uuml;ller M-Print PRO).</p>
    <div class="modal-row"><label>Markers</label>
      <select id="wmPer"><option value="conn">One per connection point</option><option value="wire">One per wire ID (with quantity)</option></select></div>
    <div class="modal-row"><label>Columns</label>
      <select id="wmMode"><option value="detailed">Detailed (marker, device, pin, to, cable&hellip;)</option><option value="simple">Marker text only</option></select></div>
    <div class="modal-row"><label>Separator</label>
      <select id="wmDelim"><option value=",">Comma ( , )</option><option value=";">Semicolon ( ; )</option><option value="&#9;">Tab</option></select></div>
    <div class="modal-row"><label><input type="checkbox" id="wmTerm" checked> Include terminal connections</label></div>
    <div class="modal-row"><label><input type="checkbox" id="wmBom" checked> UTF-8 with BOM (keeps accents and &Omega; correct)</label></div>
    <p class="modal-hint" id="wmSummary"></p>
    <div style="max-height: 30vh; overflow:auto; border:1px solid var(--border-light); border-radius:var(--radius-md);">
      <table class="bom-table"><thead><tr><th>Marker</th><th>Connection</th><th>To</th></tr></thead><tbody id="wmBody"></tbody></table>
    </div>
    <div class="modal-actions"><button type="button" class="btn-ghost" id="wmCancel">Close</button><button type="button" class="btn-primary" id="wmSave">Save CSV</button></div>
  </div>`;
  document.body.appendChild(m);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = () => ({
    perWire: m.querySelector('#wmPer').value === 'wire',
    mode: m.querySelector('#wmMode').value,
    delimiter: m.querySelector('#wmDelim').value,
    includeTerminals: m.querySelector('#wmTerm').checked
  });
  const refresh = () => {
    const o = opts();
    const { rows, unlabelled } = buildWireMarkers(o);
    m._rows = rows;
    const ids = new Set(rows.map(r => r.wireId)).size;
    m.querySelector('#wmSummary').textContent = rows.length
      ? `${rows.length} marker${rows.length === 1 ? '' : 's'} across ${ids} wire ID${ids === 1 ? '' : 's'}.` + (unlabelled ? ` ${unlabelled} connection${unlabelled === 1 ? '' : 's'} on wires with no wire ID were left out.` : '')
      : 'No labelled wires found on device connections yet.' + (unlabelled ? ` (${unlabelled} unlabelled connection${unlabelled === 1 ? '' : 's'}.)` : '');
    m.querySelector('#wmBody').innerHTML = rows.slice(0, 200).map(r => `<tr><td>${esc(r.wireId)}</td><td>${esc(r.connection)}</td><td>${esc(r.to)}</td></tr>`).join('');
  };
  ['wmPer', 'wmMode', 'wmDelim', 'wmTerm', 'wmBom'].forEach(id => m.querySelector('#' + id).addEventListener('change', refresh));
  const close = () => { m.style.display = 'none'; };
  m.querySelector('#wmClose').addEventListener('click', close);
  m.querySelector('#wmCancel').addEventListener('click', close);
  m.querySelector('#wmSave').addEventListener('click', async () => {
    if (!m._rows || !m._rows.length) { appAlert('There are no wire markers to save yet. Give your wires wire IDs first.'); return; }
    const o = opts();
    let csv = wireMarkersToCsv(m._rows, o);
    if (m.querySelector('#wmBom').checked) csv = '﻿' + csv;
    const name = (document.getElementById('projectNameInput')?.value || 'schematic').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'schematic';
    await saveTextFile(csv, `${name}_wire_markers.csv`, 'text/csv', 'Wire markers (CSV)');
  });
  m._refresh = refresh;
  return m;
}

export function openWireMarkerModal() {
  const m = ensureModal();
  m.style.display = 'flex';
  m._refresh();
}
export function closeWireMarkerModal() { const m = document.getElementById('wireMarkerModal'); if (m) m.style.display = 'none'; }


// ==========================================
// TERMINAL MARKERS
// ==========================================
// One marker for each terminal on every block: the number that goes on the
// terminal itself. Taken from the same data as the terminal table, so a block's
// positions and levels match what is on the sheets.
//   text      'position' -> 3        'full' -> X1:3
//   perLevel  false: one per position (a 2-level terminal has one number)
//             true:  one per level, written 5.1, 5.2 (or X1:5.1)
export function buildTerminalMarkers({ blockKey = '', text = 'position', perLevel = false } = {}) {
  const { blocks } = collectTerminalTableData(blockKey);
  const rows = [];
  blocks.forEach(b => {
    b.rows.forEach(r => {
      if (!perLevel && r.level > 1) return;
      const pos = perLevel && r.levels > 1 ? `${r.position}.${r.level}` : String(r.position);
      const wires = !perLevel && r.levels > 1
        ? b.rows.filter(x => x.position === r.position).flatMap(x => x.wireIds).filter((v, i, a) => a.indexOf(v) === i)
        : r.wireIds;
      rows.push({
        marker: text === 'full' ? `${b.displayName}:${pos}` : pos,
        block: b.displayName, position: r.position, level: perLevel && r.levels > 1 ? r.level : '',
        wireIds: wires.join(' / '), model: b.model, description: b.description
      });
    });
  });
  return rows;
}

export function terminalMarkersToCsv(rows, { mode = 'detailed', delimiter = ',' } = {}) {
  const d = delimiter, lines = [];
  if (mode === 'simple') {
    lines.push('Marker');
    rows.forEach(r => lines.push(csvCell(r.marker, d)));
  } else {
    lines.push(['Marker', 'Block', 'Position', 'Level', 'Wire IDs', 'Terminal model', 'Block description'].join(d));
    rows.forEach(r => lines.push([r.marker, r.block, r.position, r.level, r.wireIds, r.model, r.description].map(v => csvCell(v, d)).join(d)));
  }
  return lines.join('\r\n') + '\r\n';
}

function ensureTermModal() {
  let m = document.getElementById('terminalMarkerModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'terminalMarkerModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card" style="width: 600px; max-width: 92vw;">
    <div class="modal-header"><h3>Terminal Markers (CSV)</h3><button type="button" class="btn-icon" id="tmClose">&#10005;</button></div>
    <p class="modal-hint">One marker for each terminal on your terminal blocks &mdash; the number that goes on the terminal itself. Save the CSV and import it into your marker-printing software (e.g. Weidm&uuml;ller M-Print PRO).</p>
    <div class="modal-row"><label>Block</label><select id="tmBlock"></select></div>
    <div class="modal-row"><label>Marker text</label>
      <select id="tmText"><option value="position">Position only (3)</option><option value="full">Block and position (X1:3)</option></select></div>
    <div class="modal-row"><label>Levels</label>
      <select id="tmLevel"><option value="pos">One per position (multi-level terminals share a number)</option><option value="lvl">One per level (5.1, 5.2)</option></select></div>
    <div class="modal-row"><label>Columns</label>
      <select id="tmMode"><option value="detailed">Detailed (marker, block, position, wire IDs&hellip;)</option><option value="simple">Marker text only</option></select></div>
    <div class="modal-row"><label>Separator</label>
      <select id="tmDelim"><option value=",">Comma ( , )</option><option value=";">Semicolon ( ; )</option><option value="&#9;">Tab</option></select></div>
    <div class="modal-row"><label><input type="checkbox" id="tmBom" checked> UTF-8 with BOM (keeps accents and &Omega; correct)</label></div>
    <p class="modal-hint" id="tmSummary"></p>
    <div style="max-height: 30vh; overflow:auto; border:1px solid var(--border-light); border-radius:var(--radius-md);">
      <table class="bom-table"><thead><tr><th>Marker</th><th>Block</th><th>Wire IDs</th></tr></thead><tbody id="tmBody"></tbody></table>
    </div>
    <div class="modal-actions"><button type="button" class="btn-ghost" id="tmCancel">Close</button><button type="button" class="btn-primary" id="tmSave">Save CSV</button></div>
  </div>`;
  document.body.appendChild(m);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = () => ({ blockKey: m.querySelector('#tmBlock').value, text: m.querySelector('#tmText').value, perLevel: m.querySelector('#tmLevel').value === 'lvl' });
  const refresh = () => {
    const rows = buildTerminalMarkers(opts());
    m._rows = rows;
    const blocks = new Set(rows.map(r => r.block)).size;
    m.querySelector('#tmSummary').textContent = rows.length
      ? `${rows.length} marker${rows.length === 1 ? '' : 's'} across ${blocks} block${blocks === 1 ? '' : 's'}.`
      : 'No terminal blocks yet. Assign terminals to a block and position first.';
    m.querySelector('#tmBody').innerHTML = rows.slice(0, 300).map(r => `<tr><td>${esc(r.marker)}</td><td>${esc(r.block)}</td><td>${esc(r.wireIds)}</td></tr>`).join('');
  };
  m._fillBlocks = () => {
    const sel = m.querySelector('#tmBlock'), keep = sel.value;
    const { blocks } = collectTerminalTableData('');
    sel.innerHTML = '<option value="">All blocks</option>' + blocks.map(b => `<option value="${esc(b.key)}">${esc(b.displayName)}</option>`).join('');
    if (blocks.some(b => b.key === keep)) sel.value = keep;
  };
  ['tmBlock', 'tmText', 'tmLevel', 'tmMode', 'tmDelim', 'tmBom'].forEach(id => m.querySelector('#' + id).addEventListener('change', refresh));
  const close = () => { m.style.display = 'none'; };
  m.querySelector('#tmClose').addEventListener('click', close);
  m.querySelector('#tmCancel').addEventListener('click', close);
  m.querySelector('#tmSave').addEventListener('click', async () => {
    if (!m._rows || !m._rows.length) { appAlert('There are no terminal markers to save yet. Assign terminals to a block and position first.'); return; }
    let csv = terminalMarkersToCsv(m._rows, { mode: m.querySelector('#tmMode').value, delimiter: m.querySelector('#tmDelim').value });
    if (m.querySelector('#tmBom').checked) csv = '\uFEFF' + csv;
    const name = (document.getElementById('projectNameInput')?.value || 'schematic').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'schematic';
    await saveTextFile(csv, `${name}_terminal_markers.csv`, 'text/csv', 'Terminal markers (CSV)');
  });
  m._refresh = refresh;
  return m;
}

export function openTerminalMarkerModal() {
  const m = ensureTermModal();
  m._fillBlocks();
  m.style.display = 'flex';
  m._refresh();
}
export function closeTerminalMarkerModal() { const m = document.getElementById('terminalMarkerModal'); if (m) m.style.display = 'none'; }
