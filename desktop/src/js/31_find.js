// ==========================================
// 31. FIND ACROSS THE PROJECT
// ==========================================
// One search box over every sheet: designators, values, makes, part numbers and descriptions of parts, wire IDs, terminals,
// connectors (designator, part number, description, pins), cables, text boxes and sheet names. Choosing a result goes to
// that sheet, selects the item and brings it to the middle of the view.
import { state, getPageType, getSchematicSheetNumber, isFreePlan, sheetReferenceOf, sheetGroupsOn } from './1_config_state.js';
import { switchSheet } from './5_portfolio_sheets.js';
import { stage } from './2_main_stage.js';

const KIND_LABEL = { part: 'Part', terminal: 'Terminal', wire: 'Wire', text: 'Text', connector: 'Connector', cable: 'Cable', sheet: 'Sheet' };
const MAX_RESULTS = 200;

function sheetName(sheet, idx) {
  const type = getPageType(sheet);
  if (type === 'schematic') return `Sheet ${getSchematicSheetNumber(idx)}${sheet.title ? ' — ' + sheet.title : ''}`;
  return sheet.title || (type === 'title' ? 'Title page' : type === 'contents' ? 'Contents' : type === 'bom' ? 'Bill of materials' : type === 'plcio' ? 'PLC I/O schedule' : type === 'locations' ? 'Locations' : type === 'cables' ? 'Cable diagram' : type === 'panel' ? 'Panel layout' : 'Page');
}

const clean = (...parts) => parts.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim());

// Everything searchable, as { kind, sheetIdx, title, detail, hay, x, y, sel }. Rebuilt each time the box is used, so it is
// never out of date.
export function buildFindIndex() {
  const items = [];
  state.sheets.forEach((sheet, sheetIdx) => {
    const where = sheetName(sheet, sheetIdx);
    const add = (it) => items.push({ sheetIdx, where, ...it, hay: it.hay.join(' ').toLowerCase() });

    add({ kind: 'sheet', title: sheet.title || where, detail: clean(sheet.description, sheet.customer, sheet.location).join(' · '), x: null, y: null, sel: {}, hay: clean(sheet.title, sheet.description, sheet.customer, sheet.location, sheet.group, sheetReferenceOf(sheet), sheetGroupsOn() ? sheet.note : '') });

    (sheet.components || []).forEach(c => {
      if (c.type === 'terminal') {
        const name = clean(c.label, c.position).join(':') || 'Terminal';
        add({ kind: 'terminal', title: name, detail: clean(c.terminalModel, c.description).join(' · '), x: c.x, y: c.y, sel: { selectedComponentId: c.id }, hay: clean(c.label, c.position, c.value, c.description, c.make, c.modelNo, 'terminal') });
        return;
      }
      const parent = c.parentId ? (sheet.components || []).concat(...state.sheets.map(s => s.components || [])).find(p => p.id === c.parentId) : null;
      const label = parent ? `${parent.label || ''}${c.contactNo ? '.' + c.contactNo : ''}` : (c.label || '');
      const model = parent || c;
      add({
        kind: 'part', title: label || String(c.type), detail: clean(model.value, model.make, model.modelNo, model.description).join(' · '), x: c.x, y: c.y,
        sel: { selectedComponentId: c.id }, hay: clean(label, c.label, model.value, model.make, model.modelNo, model.description, c.type)
      });
    });

    const seenWire = new Set();
    (sheet.wires || []).forEach((w, wi) => {
      const id = w.wireId;
      if (!id || seenWire.has(id)) return;
      seenWire.add(id);
      const p = w.points || [];
      const mid = p.length >= 4 ? { x: (p[0] + p[p.length - 2]) / 2, y: (p[1] + p[p.length - 1]) / 2 } : { x: p[0] || 0, y: p[1] || 0 };
      add({ kind: 'wire', title: String(id), detail: w.wireIdManual ? 'named wire' : '', x: mid.x, y: mid.y, sel: { selectedWireIndex: wi }, hay: [String(id), 'wire'] });
    });

    (sheet.texts || []).forEach(t => {
      if (!t.text) return;
      add({ kind: 'text', title: String(t.text).split('\n')[0].slice(0, 80), detail: '', x: t.x, y: t.y, sel: { selectedTextId: t.id }, hay: [t.text] });
    });

    (sheet.cableMarkers || []).forEach(m => {
      if (m.kind === 'connector') {
        const pins = (m.coreAssignments || []).map(ca => ca.pin).filter(Boolean).join(' ');
        add({ kind: 'connector', title: m.designator || 'Connector', detail: clean(m.description, m.partNo).join(' · '), x: m.x1, y: m.y1, sel: { selectedCableMarkerId: m.id }, hay: clean(m.designator, m.description, m.partNo, pins, 'connector') });
      } else {
        const cable = (state.cables || []).find(c => c.id === m.cableId);
        if (!cable) return;
        add({ kind: 'cable', title: cable.designator || 'Cable', detail: clean(cable.cableType, cable.csa ? cable.csa + ' mm²' : '', cable.coreCount ? cable.coreCount + ' core' : '').join(' · '), x: m.x1, y: m.y1, sel: { selectedCableMarkerId: m.id }, hay: clean(cable.designator, cable.cableType, cable.csa, 'cable') });
      }
    });
  });
  return items;
}

// Every word typed must appear somewhere in an item. Exact matches of the title rank first.
export function findItems(query, index = buildFindIndex()) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const q = words.join(' ');
  return index.filter(it => words.every(w => it.hay.includes(w)))
    .map(it => ({ it, rank: it.title.toLowerCase() === q ? 0 : it.title.toLowerCase().startsWith(q) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.it.sheetIdx - b.it.sheetIdx)
    .map(r => r.it);
}

let results = [];
let highlighted = 0;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderResults() {
  const list = document.getElementById('findResults');
  const count = document.getElementById('findCount');
  if (!list) return;
  const q = document.getElementById('findInput')?.value || '';
  if (!q.trim()) { list.innerHTML = ''; if (count) count.textContent = 'Type a designator, wire ID, terminal, part number or any word.'; return; }
  const shown = results.slice(0, MAX_RESULTS);
  list.innerHTML = shown.map((r, i) => `
    <div class="find-row${i === highlighted ? ' find-row-active' : ''}" onclick="goToFindResult(${i})">
      <span class="find-kind">${KIND_LABEL[r.kind]}</span>
      <span class="find-main"><b>${esc(r.title)}</b>${r.detail ? ` <span class="find-detail">${esc(r.detail)}</span>` : ''}</span>
      <span class="find-where">${esc(r.where)}</span>
    </div>`).join('');
  if (count) count.textContent = results.length === 0 ? 'Nothing found.' : `${results.length} found${results.length > MAX_RESULTS ? ` (showing the first ${MAX_RESULTS})` : ''}. Enter opens the highlighted one.`;
  const active = list.querySelector('.find-row-active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

export function openFindModal() {
  if (isFreePlan()) return;
  const modal = document.getElementById('findModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('findInput');
  if (input) { input.focus(); input.select(); }
  onFindInput();
}

export function closeFindModal() {
  const modal = document.getElementById('findModal');
  if (modal) modal.style.display = 'none';
}

export function onFindInput() {
  const q = document.getElementById('findInput')?.value || '';
  results = findItems(q);
  highlighted = 0;
  renderResults();
}

export function onFindKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); highlighted = Math.min(highlighted + 1, Math.min(results.length, MAX_RESULTS) - 1); renderResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); renderResults(); }
  else if (e.key === 'Enter') { e.preventDefault(); goToFindResult(highlighted); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFindModal(); }
}

// Goes to a place: its sheet, the item selected, and the view centred on it. { sheetIdx, sel, x, y }
export function goToLocation(r) {
  if (!r) return;
  switchSheet(r.sheetIdx);
  Object.assign(state, {
    selectedComponentId: null, selectedWireIndex: null, selectedTextId: null, selectedCableMarkerId: null,
    selectedShapeId: null, selectedImageId: null, selectedTerminalLinkId: null
  }, r.sel);
  if (r.x !== null && r.x !== undefined && stage) {
    const scale = Math.max(stage.scaleX(), 0.9);
    stage.scale({ x: scale, y: scale });
    stage.position({ x: stage.width() / 2 - r.x * scale, y: stage.height() / 2 - r.y * scale });
    stage.batchDraw();
  }
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
}

// Goes to the result.
export function goToFindResult(i) {
  const r = results[i];
  if (!r) return;
  closeFindModal();
  goToLocation(r);
}

// A double-click on a row of the BOM (the window or a BOM page): goes to the part on its sheet. A row with several parts
// takes you to the next one each time you double-click it.
const bomRowNext = new Map();
export function goToBomRow(row) {
  const targets = row && row.targets;
  if (!targets || !targets.length) return;
  const key = [row.typeLabel, row.designators, row.modelNo, row.make, row.description].join('|');
  const i = (bomRowNext.get(key) || 0) % targets.length;
  bomRowNext.set(key, i + 1);
  goToLocation(targets[i]);
}

// Ctrl+F / Cmd+F opens Find (instead of the browser's own find, which cannot see inside the drawing).
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.shiftKey || e.altKey) return;
    if (isFreePlan() || !document.getElementById('findModal')) return;
    e.preventDefault();
    openFindModal();
  });
}
