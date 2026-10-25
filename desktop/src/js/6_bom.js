// ==========================================
// 6. BILL OF MATERIALS (BOM)
// ==========================================
import { state, saveTextFile, getSchematicSheetNumber, getGridLocation, getRefText, getRefShort, getDisplayDesignator } from './1_config_state.js';
import { isTerminalTableSymbol, isAssignedTerminal, terminalModelOf, levelsOf, blockKey, terminalLocationId } from './11_terminal_blocks.js';
import { findOpenWireEndpoints, plcDataForOpenEnd } from './3_schematic_engine.js';
import { placedKeys } from './21_panel_data.js';
import { ownsPartDetails } from './39_contact_sets.js';

function getTypeLabel(type) {
  if (type === 'resistor') return 'Resistor'; // no longer offered in the sidebar, kept for older saved projects
  if (type === 'capacitor') return 'Capacitor'; // ditto
  if (type === 'gnd') return 'Ground';
  if (type === 'supply_3n_pe') return '3+N+PE Supply';
  if (type === 'supply_1n_pe') return '1+N+PE Supply';
  if (type === 'supply_3_pe') return '3+PE Supply';
  if (window.customSymbolDefinitions?.[type]) return window.customSymbolDefinitions[type].name || type;
  return type;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Turns a Map of designator -> how many instances contributed to this row
// into the Designators column's actual text — e.g. a terminal strip where
// 33 separate terminal components all carry the SAME designator "X1"
// becomes "X1(33)" instead of listing "X1" 33 times over. A designator
// that only appears once in the row is shown plain, with no "(1)" — the
// bracket only earns its place when it's actually telling you something.
export function formatDesignatorCounts(counts) {
  return Array.from(counts.keys())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(d => { const n = counts.get(d); return n > 1 ? `${d}(${n})` : d; })
    .join(', ');
}

// Groups identical parts (same type + value + model + description) together across
// every sheet, with a combined designator list and quantity — the standard shape
// for a procurement/assembly BOM. Ground symbols are schematic reference points
// rather than a stocked part, so they're left out.
export function buildBOM() {
  const groups = new Map();
  // Auxiliary items (accessories fitted to a parent, e.g. an auxiliary contact
  // block) group separately: their quantity comes from each item's own Qty
  // field rather than "one designator = one unit", so they're merged by a Set
  // of contributing designators plus a running total instead.
  const auxGroups = new Map();
  // A terminal with several levels is drawn once per level but is ONE part, so a
  // physical terminal (block + position) is counted the first time it is met.
  const countedTerminals = new Set();
  // Parts placed on a Panel Layout sheet, so each line can say how many of its parts are on a panel.
  const placed = placedKeys(state.sheets);
  const hasPanels = state.sheets.some(s => s.pageType === 'panel');
  // Coils mechanically joined to another (a forward/reverse contactor: one device, two coils) are not parts of their own:
  // the main coil carries the line, and the others' designators are listed with it.
  const allComps = new Map();
  state.sheets.forEach(sheet => (sheet.components || []).forEach(c => allComps.set(String(c.id), c)));
  const isJoined = (c) => !!(c.jointToId && allComps.has(String(c.jointToId)));
  const joinedTo = new Map();   // main coil id -> [{ comp, sheet, sIdx }]
  state.sheets.forEach((sheet, sIdx) => (sheet.components || []).forEach(c => {
    if (!isJoined(c)) return;
    const k = String(c.jointToId);
    if (!joinedTo.has(k)) joinedTo.set(k, []);
    joinedTo.get(k).push({ comp: c, sheet, sIdx });
  }));

  const countAux = (item, comp, sheet, sIdx, label) => {
    const aKey = ['aux', item.type || '', item.make || '', item.modelNo || '', item.description || ''].join('|');
    if (!auxGroups.has(aKey)) {
      auxGroups.set(aKey, { type: item.type || '', make: item.make || '', modelNo: item.modelNo || '', description: item.description || '', qty: 0, designatorCounts: new Map(), sheets: new Set(), targets: [] });
    }
    const a = auxGroups.get(aKey);
    a.targets.push({ sheetIdx: sIdx, sel: { selectedComponentId: comp.id }, x: comp.x, y: comp.y });
    const thisQty = Math.max(1, item.qty || 1);
    a.qty += thisQty;
    a.designatorCounts.set(label, (a.designatorCounts.get(label) || 0) + thisQty);
    a.sheets.add(getSchematicSheetNumber(sIdx));
  };

  state.sheets.forEach((sheet, sIdx) => {
    (sheet.components || []).forEach(comp => {
      if (comp.type === 'gnd' || comp.type === 'supply_3n_pe' || comp.type === 'supply_1n_pe' || comp.type === 'supply_3_pe') return;
      // A Shield symbol marks a region of the drawing, not a stocked part in
      // its own right — same reasoning as Ground above — so it carries no
      // BOM line of its own either.
      if (String(comp.type).startsWith('custom_shield_')) return;
      if (isTerminalTableSymbol(comp.type)) return; // a generated terminal table is documentation, not a stocked part
      // A child (parentId set) has no independent BOM identity — it's the
      // SAME physical device as its parent (a built-in auxiliary contact,
      // typically), so the parent's own row already accounts for it. See
      // getEffectiveComponentDetails for the same rule applied on the sheet.
      if (comp.parentId && !ownsPartDetails(comp, allComps.get(String(comp.parentId)))) return;   // (the contacts and lamps of a push button are parts of their own)
      if (isJoined(comp)) {   // counted with its main coil; its own auxiliary items (contact blocks fitted to this coil) are still its own parts
        const jl = getDisplayDesignator(comp.label || '?', comp, sheet);
        (comp.auxItems || []).forEach(item => countAux(item, comp, sheet, sIdx, jl));
        return;
      }

      // What describes the part: for a terminal that has a model, the model's details
      // (so changing the model changes every line it appears on); otherwise its own.
      const isTerm = comp.type === 'terminal';
      const model = isTerm ? terminalModelOf(comp) : null;
      const make = model ? model.make : (comp.make || '');
      const modelNo = model ? (model.modelNo || model.name) : (comp.modelNo || '');
      const description = model ? model.description : (comp.description || '');
      const levels = isTerm ? levelsOf(comp) : 1;
      const isPE = isTerm && comp.terminalKind === 'pe';

      // A PE terminal is a different part from an ordinary one, and so is one with more levels
      const key = [comp.type, comp.terminalKind || '', levels > 1 ? levels : '', comp.value || '', make, modelNo, description].join('|');
      if (!groups.has(key)) {
        const baseLabel = isTerm ? (isPE ? 'PE terminal' : 'terminal') : getTypeLabel(comp.type);
        groups.set(key, {
          typeLabel: isTerm && levels > 1 ? `${levels}-level ${baseLabel}` : baseLabel,
          value: comp.value || '',
          make, modelNo, description,
          qty: 0,
          designatorCounts: new Map(), // designator -> how many instances in this group carry it
          sheets: new Set(),
          placedCount: 0,
          targets: []   // where each part is, for a double-click on the row: { sheetIdx, sel, x, y }
        });
      }
      const g = groups.get(key);
      const label = getDisplayDesignator(comp.label || '?', comp, sheet);
      let alreadyCounted = false;
      if (isTerm && isAssignedTerminal(comp)) {
        const physical = `${blockKey(comp.label, terminalLocationId(comp, sheet))}|${comp.position}`;
        alreadyCounted = countedTerminals.has(physical);
        countedTerminals.add(physical);
      }
      if (!alreadyCounted) {
        g.qty++;
        if (placed.has(`${sheet.id}:${comp.id}`)) g.placedCount++;
        g.designatorCounts.set(label, (g.designatorCounts.get(label) || 0) + 1);
      }
      g.sheets.add(getSchematicSheetNumber(sIdx));
      g.targets.push({ sheetIdx: sIdx, sel: { selectedComponentId: comp.id }, x: comp.x, y: comp.y });
      (joinedTo.get(String(comp.id)) || []).forEach(j => {
        g.designatorCounts.set(getDisplayDesignator(j.comp.label || '?', j.comp, j.sheet), 1);
        g.sheets.add(getSchematicSheetNumber(j.sIdx));
        g.targets.push({ sheetIdx: j.sIdx, sel: { selectedComponentId: j.comp.id }, x: j.comp.x, y: j.comp.y });
      });

      (comp.auxItems || []).forEach(item => countAux(item, comp, sheet, sIdx, label));
    });
  });

  const rows = Array.from(groups.values())
    .map(g => ({
      qty: g.qty,
      designators: formatDesignatorCounts(g.designatorCounts),
      typeLabel: g.typeLabel,
      value: g.value,
      make: g.make,
      modelNo: g.modelNo,
      description: g.description,
      sheets: Array.from(g.sheets).sort((a, b) => a - b).join(', '),
      panel: !hasPanels ? '' : (g.placedCount === 0 ? '\u2014' : (g.placedCount >= g.qty ? '\u2713 placed' : `${g.placedCount}/${g.qty}`)),
      targets: g.targets
    }));

  const auxRows = Array.from(auxGroups.values())
    .map(a => ({
      qty: a.qty,
      designators: formatDesignatorCounts(a.designatorCounts),
      typeLabel: a.type || 'Accessory', // e.g. "Auxiliary Contact Block" when given, a generic fallback otherwise
      value: '',
      make: a.make,
      modelNo: a.modelNo,
      description: a.description,
      sheets: Array.from(a.sheets).sort((x, y) => x - y).join(', '),
      panel: '',
      targets: a.targets
    }));

  // Connectors drawn with the Connector tool: one part each, grouped by part number and description.
  const connGroups = new Map();
  state.sheets.forEach((sheet, sIdx) => (sheet.cableMarkers || []).forEach(m => {
    if (m.kind !== 'connector') return;
    const key = [m.partNo || '', m.description || ''].join('|');
    if (!connGroups.has(key)) connGroups.set(key, { modelNo: m.partNo || '', description: m.description || '', names: new Set(), sheets: new Set(), targets: [] });
    const g = connGroups.get(key);
    g.targets.push({ sheetIdx: sIdx, sel: { selectedCableMarkerId: m.id }, x: m.x1, y: m.y1 });
    g.names.add(m.designator || '?');
    g.sheets.add(getSchematicSheetNumber(sIdx));
  }));
  const connRows = Array.from(connGroups.values()).map(g => ({
    qty: g.names.size,
    designators: Array.from(g.names).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', '),
    typeLabel: 'Connector', value: '', make: '', modelNo: g.modelNo, description: g.description,
    sheets: Array.from(g.sheets).sort((a, b) => a - b).join(', '),
    panel: !hasPanels ? '' : '\u2014',
    targets: g.targets
  }));

  // DXF footprints placed on a panel sheet without a schematic part (a fan, a label, a cut-out) are parts of the panel too: one
  // line per footprint, quantity = how many are placed.
  const freeGroups = new Map();
  state.sheets.forEach((sheet, sIdx) => {
    if (sheet.pageType !== 'panel' || !sheet.panel) return;
    (sheet.panel.items || []).forEach(it => {
      if (it.link) return;
      const fp = (state.panelFootprints || []).find(f => String(f.id) === String(it.footprintId));
      if (!fp || fp.kind === 'plate') return;
      const key = String(fp.id);
      if (!freeGroups.has(key)) freeGroups.set(key, { fp, qty: 0, targets: [] });
      const g = freeGroups.get(key); g.qty++;
      g.targets.push({ sheetIdx: sIdx, sel: {}, x: null, y: null });
    });
  });
  const freeRows = Array.from(freeGroups.values()).map(g => ({
    qty: g.qty, designators: g.qty > 1 ? `${g.fp.name}(${g.qty})` : g.fp.name,
    typeLabel: 'Panel component', value: '', make: g.fp.make || '', modelNo: g.fp.modelNo || '', description: g.fp.description || '',
    sheets: '', panel: '\u2713 placed', targets: g.targets
  }));

  return [...rows, ...auxRows, ...connRows, ...freeRows]
    .sort((a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.designators.localeCompare(b.designators));
}

let modalRows = [];
// Double-clicking a row of the BOM window closes it and goes to the part (see goToBomRow in 31_find.js).
export function goToBomModalRow(i) {
  const row = modalRows[i];
  if (!row || !row.targets || !row.targets.length) return;
  closeBOMModal();
  if (typeof window.goToBomRow === 'function') window.goToBomRow(row);
}

export function openBOMModal() {
  const rows = buildBOM();
  modalRows = rows;
  const tbody = document.getElementById('bomTableBody');
  if (tbody) {
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px; color:#64748b;">No components on any sheet yet.</td></tr>';
    } else {
      tbody.innerHTML = rows.map((r, i) => `
        <tr ondblclick="goToBomModalRow(${i})" title="Double-click to go to this part" style="cursor:pointer;">
          <td>${r.qty}</td>
          <td>${escapeHtml(r.designators)}</td>
          <td>${escapeHtml(r.typeLabel)}</td>
          <td>${escapeHtml(r.value)}</td>
          <td>${escapeHtml(r.make)}</td>
          <td>${escapeHtml(r.modelNo)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.sheets)}</td>
          <td>${escapeHtml(r.panel)}</td>
        </tr>
      `).join('');
    }
  }

  const modal = document.getElementById('bomModal');
  if (modal) modal.style.display = 'flex';
}

export function closeBOMModal() {
  const modal = document.getElementById('bomModal');
  if (modal) modal.style.display = 'none';
}

// Every manually-named wire that has 2+ open ends anywhere in the portfolio —
// i.e. every group the on-sheet "→ Sh.X/YZ" rendering would actually draw —
// so a mismatch (missing or unexpected entry) is visible without hunting
// through sheets. Uses the exact same matching function the renderer does,
// so this report can never disagree with what's actually on the page.
export function buildWireReferenceReport() {
  const openEndpointsByWireId = findOpenWireEndpoints();
  const rows = [];

  openEndpointsByWireId.forEach((endpoints, wireId) => {
    if (endpoints.length < 2) return; // named + open, but nothing to cross-reference yet
    rows.push({
      wireId,
      locations: endpoints
        .map(e => ({ sheetNum: getSchematicSheetNumber(e.sheetIdx), grid: getRefShort(e.x, e.y, e.sheetIdx), text: getRefText(e.x, e.y, e.sheetIdx), plc: plcDataForOpenEnd(e) }))
        .sort((a, b) => (a.sheetNum ?? 0) - (b.sheetNum ?? 0) || a.grid.localeCompare(b.grid, undefined, { numeric: true }))
    });
  });

  return rows.sort((a, b) => a.wireId.localeCompare(b.wireId, undefined, { numeric: true }));
}

export function openWireReferenceModal() {
  const rows = buildWireReferenceReport();
  const tbody = document.getElementById('wireRefTableBody');
  if (tbody) {
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:16px; color:#64748b;">No cross-referenced wires yet — name a wire (double-click it) and give the same name to an open end elsewhere.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.wireId)}</td>
          <td>${r.locations.map(l => `${escapeHtml(l.text)}${l.plc ? ` (${escapeHtml(l.plc)})` : ''}`).join(', ')}</td>
        </tr>
      `).join('');
    }
  }

  const modal = document.getElementById('wireRefModal');
  if (modal) modal.style.display = 'flex';
}

export function closeWireReferenceModal() {
  const modal = document.getElementById('wireRefModal');
  if (modal) modal.style.display = 'none';
}

export async function exportBOMCsv() {
  const rows = buildBOM();
  const header = ['Qty', 'Designators', 'Type', 'Value', 'Make', 'Model No.', 'Description', 'Sheet(s)', 'Panel'];
  const csvRows = [header.join(',')];

  rows.forEach(r => {
    csvRows.push([r.qty, r.designators, r.typeLabel, r.value, r.make, r.modelNo, r.description, r.sheets, r.panel]
      .map(csvEscape).join(','));
  });

  const csvStr = csvRows.join('\r\n');
  const projectInput = document.getElementById('projectNameInput');
  const name = (projectInput?.value.trim() || 'schematic_project').replace(/[^a-z0-9_\-]/gi, '_');

  await saveTextFile(csvStr, `${name}_BOM.csv`, 'text/csv', 'Bill of Materials (CSV)');
}
