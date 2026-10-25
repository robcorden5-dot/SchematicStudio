// ==========================================
// 30. CONNECTORS (plug and socket pairs on wires)
// ==========================================
// The Connector tool works like the Cable tool: drag a line across a group of wires. Where each wire crosses the line
// a mated plug-and-socket symbol is drawn on it (a male arrowhead nested in a female chevron); the wire itself carries
// straight on through. The connector gets a designator, and each wire is given a pin number, which can be reordered.
// A connector is stored with the sheet's cable markers (sheet.cableMarkers, kind: 'connector') so that it is selected,
// moved, rubber-banded, deleted and undone in exactly the same way; its coreAssignments hold one entry per wire:
//   { coreNumber: position 1..n, pin: the pin number shown, wireId, wireObjId, x, y: where the wire crosses the line }
// and maleDir is the unit vector, along the wires, from the crossing toward the male (plug) side.
import { state, pushHistory, scheduleAutosave, getActiveSheet } from './1_config_state.js';
import { computeTrunkExtent } from './7_cables.js';

// The two halves of the symbol at (cx, cy): the male arrowhead and the female chevron round it, as flat point lists.
// The arrow points from the male side toward the female side, so the chevron opens toward the plug.
export function connectorGlyph(cx, cy, maleDir) {
  const ux = -maleDir.x, uy = -maleDir.y;   // from the male side toward the female side
  const vx = -uy, vy = ux;                  // across the wire
  const P = (a, b) => [cx + ux * a + vx * b, cy + uy * a + vy * b];
  return {
    male: [...P(-6, 5), ...P(1, 0), ...P(-6, -5)],
    female: [...P(0, 5), ...P(7, 0), ...P(0, -5)]
  };
}

// Which way the male side lies for a drag from (x1,y1) to (x2,y2): the left-hand side of the direction of travel.
// Dragging left to right across upright wires puts the plug above the line; right to left puts it below.
export function maleDirectionForDrag(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: 0, y: dx >= 0 ? -1 : 1 };
  return { x: dy >= 0 ? 1 : -1, y: 0 };
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const sideWords = (d) => (d.y < 0 ? 'above' : d.y > 0 ? 'below' : d.x > 0 ? 'to the right of' : 'to the left of');

let session = null; // { markerId|null, x1,y1,x2,y2, maleDir, rows: [{ pin, wire: { x, y, wireObjId, wireId } }] }

function nextDesignator() {
  const used = new Set();
  state.sheets.forEach(s => (s.cableMarkers || []).forEach(m => { if (m.kind === 'connector' && m.designator) used.add(String(m.designator).toUpperCase()); }));
  let n = 1;
  while (used.has('CN' + n)) n++;
  return 'CN' + n;
}

// The wire ID a crossing point sits on right now (wires are renumbered, so it is looked up each time).
function liveWireId(sheet, wire) {
  const hit = (sheet.wires || []).find(w => {
    const p = w.points || [];
    for (let i = 0; i < p.length - 2; i += 2) {
      const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
      const lenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      let t = lenSq ? ((wire.x - x1) * (x2 - x1) + (wire.y - y1) * (y2 - y1)) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      if ((wire.x - (x1 + t * (x2 - x1))) ** 2 + (wire.y - (y1 + t * (y2 - y1))) ** 2 < 0.01) return true;
    }
    return false;
  });
  return hit ? (hit.wireId || '') : (wire.wireId || '');
}

function render() {
  if (!session) return;
  const sheet = getActiveSheet();
  const rows = document.getElementById('connRows');
  if (rows) {
    rows.innerHTML = session.rows.map((r, i) => `
      <tr>
        <td><input type="text" value="${esc(r.pin)}" maxlength="6" style="width:58px;" oninput="setConnectorPin(${i}, this.value)"></td>
        <td>${esc(liveWireId(sheet, r.wire) || '(unnamed wire)')}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn-icon" title="Move this wire to the pin above" ${i === 0 ? 'disabled' : ''} onclick="moveConnectorRow(${i}, -1)">&#9650;</button>
          <button type="button" class="btn-icon" title="Move this wire to the pin below" ${i === session.rows.length - 1 ? 'disabled' : ''} onclick="moveConnectorRow(${i}, 1)">&#9660;</button>
        </td>
      </tr>`).join('');
  }
  const text = document.getElementById('connMaleText');
  if (text) text.textContent = `Plug (male) ${sideWords(session.maleDir)} the line, socket (female) on the other side.`;
  const prev = document.getElementById('connPreview');
  if (prev) {
    const d = session.maleDir, g = connectorGlyph(60, 40, d);
    const along = d.x !== 0 ? 'M 6 40 L 114 40' : 'M 60 4 L 60 76';
    const poly = (pts) => `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]} L ${pts[4]} ${pts[5]}`;
    prev.innerHTML = `<svg width="120" height="80" viewBox="0 0 120 80" style="display:block;background:var(--bg-field,#0f1720);border-radius:6px;">
      <g stroke="#cbd5e1" fill="none" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="${along}"/><path d="${poly(g.male)}"/><path d="${poly(g.female)}"/></g>
      <g fill="#f59e0b" font-size="10" font-family="Arial" text-anchor="middle"><text x="${60 + d.x * 30}" y="${43 + d.y * 30}">M</text><text x="${60 - d.x * 30}" y="${43 - d.y * 30}">F</text></g></svg>`;
  }
}

function show(title, canDelete) {
  document.getElementById('connTitle').textContent = title;
  document.getElementById('connDeleteBtn').style.display = canDelete ? '' : 'none';
  document.getElementById('connDesignator').value = session.designator;
  document.getElementById('connDesc').value = session.description || '';
  document.getElementById('connPinPreset').value = '';
  document.getElementById('connPinCustom').style.display = 'none';
  document.getElementById('connPartNo').value = session.partNo || '';
  document.getElementById('connShowDesc').checked = !session.hideDescription;
  document.getElementById('connShowPart').checked = !session.hidePartNo;
  render();
  document.getElementById('connectorModal').style.display = 'flex';
}

// Called by the engine when a drag with the Connector tool has crossed wires. crossings: [{ wire, x, y }].
export function openConnectorModal(crossings, x1, y1, x2, y2) {
  const maleDir = maleDirectionForDrag(x1, y1, x2, y2);
  const dx = x2 - x1, dy = y2 - y1;
  const sorted = crossings.slice().sort((a, b) => ((a.x - x1) * dx + (a.y - y1) * dy) - ((b.x - x1) * dx + (b.y - y1) * dy));   // pin 1 is the first wire the drag met
  session = {
    markerId: null, x1, y1, x2, y2, maleDir, designator: nextDesignator(),
    rows: sorted.map((c, i) => ({ pin: String(i + 1), wire: { x: c.x, y: c.y, wireObjId: c.wire.id, wireId: c.wire.wireId || '' } }))
  };
  show('New connector', false);
}

// Double-click on a connector already on the sheet.
export function openConnectorEditor(markerId) {
  const marker = (getActiveSheet().cableMarkers || []).find(m => m.id === markerId && m.kind === 'connector');
  if (!marker) return;
  const rows = (marker.coreAssignments || []).slice().sort((a, b) => a.coreNumber - b.coreNumber)
    .map(ca => ({ pin: String(ca.pin ?? ca.coreNumber), wire: { x: ca.x, y: ca.y, wireObjId: ca.wireObjId, wireId: ca.wireId || '' } }));
  session = { markerId, x1: marker.x1, y1: marker.y1, x2: marker.x2, y2: marker.y2, maleDir: { ...marker.maleDir }, designator: marker.designator || '', description: marker.description || '', partNo: marker.partNo || '', hideDescription: !!marker.hideDescription, hidePartNo: !!marker.hidePartNo, rows };
  show('Connector ' + (marker.designator || ''), true);
}

export function closeConnectorModal() {
  const modal = document.getElementById('connectorModal');
  if (modal) modal.style.display = 'none';
  session = null;
}

export function swapConnectorSides() {
  if (!session) return;
  session.maleDir = { x: -session.maleDir.x || 0, y: -session.maleDir.y || 0 };
  render();
}

// The dropdown above the pin table: applies a preset straight away, or reveals the box for a typed list.
export function onConnectorPinPreset(sel) {
  const custom = document.getElementById('connPinCustom');
  if (custom) custom.style.display = sel.value === 'custom' ? '' : 'none';
  if (sel.value === 'custom') { if (custom) { custom.focus(); applyConnectorPinNames('custom', custom.value); } }
  else if (sel.value) applyConnectorPinNames(sel.value);
}

// Ready-made pin names, applied to the rows in order. A pin beyond the end of the list keeps its place number.
export const PIN_PRESETS = {
  numbers: { label: '1, 2, 3 \u2026', names: [] },
  l123: { label: 'L1, L2, L3', names: ['L1', 'L2', 'L3'] },
  l123n: { label: 'L1, L2, L3, N', names: ['L1', 'L2', 'L3', 'N'] },
  l123npe: { label: 'L1, L2, L3, N, PE', names: ['L1', 'L2', 'L3', 'N', 'PE'] },
  l123pe: { label: 'L1, L2, L3, PE', names: ['L1', 'L2', 'L3', 'PE'] },
  lnpe: { label: 'L, N, PE', names: ['L', 'N', 'PE'] },
  uvw: { label: 'U, V, W', names: ['U', 'V', 'W'] },
  uvwpe: { label: 'U, V, W, PE', names: ['U', 'V', 'W', 'PE'] },
  pn: { label: '+, \u2212', names: ['+', '\u2212'] },
  abc: { label: 'A, B, C, \u2026', names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }
};

// Names every pin from a preset, or from a typed list ("L1, L2, L3, N, PE").
export function applyConnectorPinNames(key, custom) {
  if (!session) return;
  let names;
  if (key === 'custom') names = String(custom || '').split(/[,;\s]+/).map(n => n.trim()).filter(Boolean);
  else if (PIN_PRESETS[key]) names = PIN_PRESETS[key].names;
  else return;
  session.rows.forEach((r, i) => { r.pin = names[i] || String(i + 1); });
  render();
}

export function setConnectorPin(i, value) {
  if (session && session.rows[i]) session.rows[i].pin = String(value).trim();
}

// Moves the wire on a pin up or down a place; the wire it changes places with takes this pin's number.
export function moveConnectorRow(i, delta) {
  if (!session) return;
  const j = i + delta;
  if (j < 0 || j >= session.rows.length) return;
  const a = session.rows[i], b = session.rows[j];
  const wire = a.wire; a.wire = b.wire; b.wire = wire;
  render();
}

export function confirmConnectorModal() {
  if (!session) return;
  const designator = (document.getElementById('connDesignator').value || '').trim() || session.designator;
  const sheet = getActiveSheet();
  const details = {
    description: document.getElementById('connDesc').value.trim(), partNo: document.getElementById('connPartNo').value.trim(),
    hideDescription: !document.getElementById('connShowDesc').checked, hidePartNo: !document.getElementById('connShowPart').checked
  };
  pushHistory();
  const coreAssignments = session.rows.map((r, i) => ({
    coreNumber: i + 1, pin: r.pin || String(i + 1), wireId: liveWireId(sheet, r.wire), wireObjId: r.wire.wireObjId, x: r.wire.x, y: r.wire.y
  }));
  if (!sheet.cableMarkers) sheet.cableMarkers = [];
  if (session.markerId) {
    const marker = sheet.cableMarkers.find(m => m.id === session.markerId);
    if (marker) Object.assign(marker, { designator, maleDir: session.maleDir, coreAssignments, ...details });
  } else {
    const wasHorizontal = Math.abs(session.x2 - session.x1) >= Math.abs(session.y2 - session.y1);
    const labelDir = wasHorizontal ? (session.x2 >= session.x1 ? 1 : -1) : (session.y2 >= session.y1 ? 1 : -1);   // the end the line was dragged towards, as with the shield tool
    sheet.cableMarkers.push({
      id: Date.now(), kind: 'connector', designator, maleDir: session.maleDir, labelDir, ...details,
      ...computeTrunkExtent(coreAssignments, wasHorizontal), coreAssignments
    });
  }
  closeConnectorModal();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

export function deleteConnectorFromModal() {
  if (!session || !session.markerId) return;
  const sheet = getActiveSheet();
  pushHistory();
  sheet.cableMarkers = (sheet.cableMarkers || []).filter(m => m.id !== session.markerId);
  if (state.selectedCableMarkerId === session.markerId) state.selectedCableMarkerId = null;
  closeConnectorModal();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}
