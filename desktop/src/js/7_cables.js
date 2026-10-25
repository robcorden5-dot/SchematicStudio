// ==========================================
// 7. CABLE MANAGEMENT
// ==========================================
// A cable is a portfolio-wide entity (state.cables) representing a physical
// multi-core cable — a designator, type, core count, and CSA, plus a stable
// mapping of core number -> wireId. A "cable marker" is the visual crossing
// mark drawn on a specific sheet where a group of wires is bundled into that
// cable (sheet.cableMarkers) — the same cable can have markers on several
// sheets, e.g. one where it starts and one where it terminates.
import { state, saveTextFile, pushHistory, scheduleAutosave, nextCableDesignator, getActiveSheet, appAlert, appConfirm, snapToGrid, isFreePlan } from './1_config_state.js';
import { traceCableCores } from './33_cable_routes.js';
import { findOpenWireEndpoints } from './3_schematic_engine.js';
import { colourSwatchHtml, colourOptionsHtml, coreColourOf, coloursToMap, fitColours, standardCoreColours, addCableEntry, cableColourList } from './18_cable_library.js';

let pendingCrossing = null; // { x1, y1, x2, y2, crossings: [{ wire, x, y }] } — x,y is where that wire actually crosses the drag line

// Computes a marker's trunk-line endpoints from the actual positions of its
// CURRENT core assignments (not the raw drag gesture) — so the line only
// ever spans what it's really carrying, with a little padding beyond the
// outermost core. wasHorizontal preserves the original drag's orientation.
// The ends are snapped to the grid (the padding therefore comes out between 5
// and 25 units, never less than 5 clear of the outermost core); the line's
// position across the sheet is whatever the crossings sit on, which is a grid
// line for anything created since the drag line started snapping.
export function computeTrunkExtent(coreAssignments, wasHorizontal, padding = 15) {
  const xs = coreAssignments.map(c => c.x), ys = coreAssignments.map(c => c.y);
  if (wasHorizontal) {
    const y = ys[0]; // all crossing points sit on the same straight drag line
    return { x1: snapToGrid(Math.min(...xs) - padding), y1: y, x2: snapToGrid(Math.max(...xs) + padding), y2: y };
  }
  const x = xs[0];
  return { x1: x, y1: snapToGrid(Math.min(...ys) - padding), x2: x, y2: snapToGrid(Math.max(...ys) + padding) };
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function getCableById(cableId) {
  return (state.cables || []).find(c => c.id === cableId);
}

function freeCoreCount(cable) {
  const used = Object.values(cable.coreWireIds || {}).filter(Boolean).length;
  return cable.coreCount - used;
}

// Called by the engine once a drag-line completes and crosses 2+ wires.
// crossings is [{ wire, x, y }] — x,y is where that specific wire crosses the line.
export function openCableAssignmentModal(crossings, x1, y1, x2, y2) {
  pendingCrossing = { x1, y1, x2, y2, crossings };

  const listEl = document.getElementById('cableCrossedWiresList');
  if (listEl) listEl.textContent = crossings.map(c => c.wire.wireId || '(unnamed wire)').join(', ');

  const coreCountNeeded = crossings.length;
  const existingSelect = document.getElementById('cableExistingSelect');
  if (existingSelect) {
    existingSelect.innerHTML = '<option value="">— Create new cable —</option>';
    (state.cables || []).forEach(cable => {
      const free = freeCoreCount(cable);
      if (free >= coreCountNeeded) {
        const opt = document.createElement('option');
        opt.value = cable.id;
        opt.textContent = `${cable.designator} — ${cable.cableType || 'cable'}, ${cable.coreCount} core, ${free} free`;
        existingSelect.appendChild(opt);
      }
    });
  }

  const typeInput = document.getElementById('cableTypeInput');
  if (typeInput) typeInput.value = '';
  const coreCountInput = document.getElementById('cableCoreCountInput');
  if (coreCountInput) coreCountInput.value = Math.max(crossings.length, 2);
  const csaInput = document.getElementById('cableCsaInput');
  if (csaInput) csaInput.value = '';
  const libSelect = document.getElementById('cableLibrarySelect');
  if (libSelect) {
    libSelect.innerHTML = '<option value="">— None (type it in) —</option>' + (state.cableLibrary || []).map(e =>
      `<option value="${e.id}">${escapeHtml(e.name)} — ${e.coreCount} core${e.csa ? ', ' + escapeHtml(e.csa) + ' mm\u00B2' : ''}</option>`).join('');
  }
  const stdBox = document.getElementById('cableStdColoursCheck');
  if (stdBox) stdBox.checked = false;

  toggleCableNewFields();

  const modal = document.getElementById('cableAssignModal');
  if (modal) modal.style.display = 'flex';
}

// Choosing a cable from the library fills in its type, cores and CSA (and its
// core colours are applied when the cable is created).
export function onCableLibraryPick() {
  const sel = document.getElementById('cableLibrarySelect');
  const entry = sel && sel.value ? (state.cableLibrary || []).find(e => String(e.id) === String(sel.value)) : null;
  if (!entry) return;
  const needed = pendingCrossing ? pendingCrossing.crossings.length : 1;
  document.getElementById('cableTypeInput').value = entry.cableType || '';
  document.getElementById('cableCoreCountInput').value = Math.max(entry.coreCount, needed);
  document.getElementById('cableCsaInput').value = entry.csa || '';
  const stdBox = document.getElementById('cableStdColoursCheck');
  if (stdBox) stdBox.checked = false;
}

// Shows the "new cable" fields only when "Create new cable" is selected.
export function toggleCableNewFields() {
  const existingSelect = document.getElementById('cableExistingSelect');
  const newFields = document.getElementById('cableNewFields');
  if (!existingSelect || !newFields) return;
  newFields.style.display = existingSelect.value ? 'none' : 'block';
}

export function closeCableAssignmentModal() {
  const modal = document.getElementById('cableAssignModal');
  if (modal) modal.style.display = 'none';
  pendingCrossing = null;
}

export function confirmCableAssignment() {
  if (!pendingCrossing) return;
  const { x1, y1, x2, y2, crossings } = pendingCrossing;
  if (crossings.length === 0) { closeCableAssignmentModal(); return; }

  const existingSelect = document.getElementById('cableExistingSelect');
  const selectedCableId = existingSelect ? existingSelect.value : '';

  pushHistory();

  let cable;
  if (selectedCableId) {
    cable = state.cables.find(c => String(c.id) === String(selectedCableId));
    if (!cable) { closeCableAssignmentModal(); return; }
  } else {
    const cableType = (document.getElementById('cableTypeInput')?.value || '').trim() || 'Cable';
    const coreCount = Math.max(parseInt(document.getElementById('cableCoreCountInput')?.value, 10) || crossings.length, crossings.length);
    const csa = (document.getElementById('cableCsaInput')?.value || '').trim();

    // Core colours: from the library cable that was picked, else the standard
    // sequence if asked for, else none.
    const libId = document.getElementById('cableLibrarySelect')?.value;
    const libEntry = libId ? (state.cableLibrary || []).find(e => String(e.id) === String(libId)) : null;
    let coreColours = {};
    if (libEntry) coreColours = coloursToMap(fitColours(libEntry.coreColours, coreCount));
    else if (document.getElementById('cableStdColoursCheck')?.checked) coreColours = coloursToMap(standardCoreColours(coreCount));

    cable = { id: Date.now(), designator: nextCableDesignator(), cableType, coreCount, csa, coreWireIds: {}, coreColours };
    if (!state.cables) state.cables = [];
    state.cables.push(cable);
  }

  // Each crossed wire takes a core: reuse a core already carrying the same
  // wireId (this cable continuing from an earlier crossing elsewhere),
  // otherwise the next free core number. Each assignment keeps the exact
  // point that wire crosses the line, so its tick draws in the right place.
  const coreAssignments = [];
  crossings.forEach(({ wire, x, y }) => {
    const wireId = wire.wireId || '';
    let coreNum = Object.keys(cable.coreWireIds).find(k => wireId && cable.coreWireIds[k] === wireId);
    if (!coreNum) {
      let candidate = 1;
      while (cable.coreWireIds[candidate]) candidate++;
      coreNum = String(candidate);
      cable.coreWireIds[coreNum] = wireId;
    }
    // wireObjId is this SPECIFIC wire segment's own internal id — distinct
    // from wireId, which is just the net's shared label and can be carried
    // by multiple separate wire objects (e.g. the two sides of a terminal
    // split). The dash styling needs to target only the segment actually
    // crossed here, not everything sharing its net label.
    coreAssignments.push({ coreNumber: parseInt(coreNum, 10), wireId, wireObjId: wire.id, x, y });
  });

  const wasHorizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const extent = computeTrunkExtent(coreAssignments, wasHorizontal);

  const sheet = getActiveSheet();
  if (!sheet.cableMarkers) sheet.cableMarkers = [];
  // which end of the line the details go at: the end the line was dragged towards, as with the shield tool (1 = right / bottom, -1 = left / top)
  const labelDir = wasHorizontal ? (x2 >= x1 ? 1 : -1) : (y2 >= y1 ? 1 : -1);
  sheet.cableMarkers.push({ id: Date.now() + 1, cableId: cable.id, ...extent, labelDir, coreAssignments });

  closeCableAssignmentModal();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

// ---- Cable manager: view, amend, delete ----
let highlightedCableId = null; // the cable whose row is picked out (opened by double-clicking one of its markers)

export function openCableManagerModal(cableId) {
  highlightedCableId = (typeof cableId === 'string' || typeof cableId === 'number') ? String(cableId) : null;
  renderCableManagerTable();
  const modal = document.getElementById('cableManagerModal');
  if (modal) modal.style.display = 'flex';
  const row = document.querySelector('#cableManagerTableBody tr.cable-row-highlight');
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
}

export function closeCableManagerModal() {
  highlightedCableId = null;
  const modal = document.getElementById('cableManagerModal');
  if (modal) modal.style.display = 'none';
}

function renderCableManagerTable() {
  const tbody = document.getElementById('cableManagerTableBody');
  if (!tbody) return;

  const cables = state.cables || [];
  if (cables.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-faint);">No cables yet — use the Cable tool to drag across a group of wires.</td></tr>';
    return;
  }

  let openMap = null;
  try { openMap = findOpenWireEndpoints(); } catch (e) { openMap = new Map(); }
  tbody.innerHTML = cables.map(cable => {
    let routes = {};
    try { routes = traceCableCores(cable, openMap); } catch (e) { routes = {}; }   // a route that can't be worked out leaves the columns empty rather than hiding the cable
    const coreChips = [];
    for (let i = 1; i <= cable.coreCount; i++) {
      const wireId = cable.coreWireIds[i];
      const colour = coreColourOf(cable, i);
      const picker = `<select class="cable-colour-select" title="Core ${i} colour" onchange="updateCableCoreColour('${cable.id}',${i},this.value)">${colourOptionsHtml(colour)}</select>`;
      const chip = wireId
        ? `<span class="cable-core-chip cable-core-chip-assigned"${routes[i] ? ` title="${escapeHtml(`Core ${i}: ${routes[i].from.join(', ') || '?'} \u2192 ${routes[i].to.join(', ') || '?'}`)}"` : ''}>${i}:${escapeHtml(wireId)} <span onclick="clearCableCore('${cable.id}',${i})" title="Clear this core, releasing it back to the pool">&#10005;</span></span>`
        : `<span class="cable-core-chip cable-core-chip-free">${i}: \u2014</span>`;
      const move = wireId
        ? `<button type="button" class="cable-core-move" onclick="moveCableCore('${cable.id}',${i},-1)" title="Move this wire up to core ${i - 1}" ${i > 1 ? '' : 'disabled'}>&#9650;</button><button type="button" class="cable-core-move" onclick="moveCableCore('${cable.id}',${i},1)" title="Move this wire down to core ${i + 1}" ${i < cable.coreCount ? '' : 'disabled'}>&#9660;</button>`
        : '';
      const r = routes[i];
      const endHtml = (e) => {
        const where = e.sheet ? ` (Sh.${e.sheet})` : '';
        if (e.terminal) return `<span class="cable-term" title="Terminal ${escapeHtml(e.device)}, position ${escapeHtml(e.pin)}">${escapeHtml(e.device)}${e.pin && !e.device.includes(':') ? ':' + escapeHtml(e.pin) : ''}</span>${escapeHtml(where)}`;
        return `${escapeHtml(e.device)}${e.pin ? ':' + escapeHtml(e.pin) : ''}${escapeHtml(where)}`;
      };
      const ends = (list, loose) => list.length ? list.map(endHtml).join(' / ') : (loose ? '<i>open end</i>' : '?');
      const route = r && wireId ? `<span class="cable-core-route" title="From the left or top end of the wire to the right or bottom end">${ends(r.fromPins, r.fromLoose)} <b>&rarr;</b> ${ends(r.toPins, r.toLoose)}</span>` : '';
      coreChips.push(`<span class="cable-core-block">${colourSwatchHtml(colour)}${picker}${chip}${move}${route}</span>`);
    }

    const picked = highlightedCableId !== null && String(cable.id) === highlightedCableId;
    return `
      <tr${picked ? ' class="cable-row-highlight" style="background:rgba(245,158,11,.18); box-shadow:inset 3px 0 0 #f59e0b;"' : ''}>
        <td><input type="text" value="${escapeHtml(cable.designator)}" style="width:70px;" onchange="updateCableField('${cable.id}','designator',this.value)"></td>
        <td><input type="text" value="${escapeHtml(cable.cableType || '')}" style="width:80px;" onchange="updateCableField('${cable.id}','cableType',this.value)"></td>
        <td><input type="number" min="1" value="${cable.coreCount}" style="width:56px;" onchange="updateCableField('${cable.id}','coreCount',this.value)"></td>
        <td><input type="text" value="${escapeHtml(cable.csa || '')}" style="width:56px;" onchange="updateCableField('${cable.id}','csa',this.value)"></td>
        <td>${coreChips.join('')}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn-icon" onclick="applyStandardCableColours('${cable.id}')" title="Colour the cores in the standard order (BRN, BLK, GRY, BLU, GRN/YEL ...)">&#127912;</button>
          <button type="button" class="btn-icon" onclick="saveCableToLibrary('${cable.id}')" title="Save this cable's type, cores, CSA and colours to the cable library">&#128190;</button>
          <button type="button" class="btn-icon" onclick="deleteCable('${cable.id}')" title="Delete cable">&#128465;</button>
        </td>
      </tr>
    `;
  }).join('');
}

export async function updateCableField(cableId, field, rawValue) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;

  if (field === 'coreCount') {
    const newCount = parseInt(rawValue, 10);
    const highestAssigned = Math.max(0, ...Object.keys(cable.coreWireIds || {}).map(Number));
    if (!newCount || newCount < highestAssigned) {
      await appAlert(`Can't reduce core count below ${highestAssigned} — core ${highestAssigned} already has a wire assigned there. Remove that assignment first, or choose a larger count.`);
      renderCableManagerTable(); // revert the input's displayed value
      return;
    }
    pushHistory();
    cable.coreCount = newCount;
  } else {
    pushHistory();
    cable[field] = String(rawValue).trim();
  }

  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

// Moves the wire on a core one place up or down (to the next lower or higher core). If that core already carries a
// wire the two swap, so the order of the wires in the cable can be rearranged. Core colours belong to the cores, so the
// wires take on the colour of their new core. Every marker showing the cable follows (the core numbers on the sheet).
export function moveCableCore(cableId, coreNo, delta) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;
  const a = Number(coreNo), b = a + Number(delta);
  if (!(b >= 1 && b <= cable.coreCount) || b === a) return;
  const ids = cable.coreWireIds || (cable.coreWireIds = {});
  if (!ids[a]) return;
  pushHistory();
  const wa = ids[a], wb = ids[b];
  ids[b] = wa;
  if (wb) ids[a] = wb; else delete ids[a];
  state.sheets.forEach(sheet => (sheet.cableMarkers || []).forEach(marker => {
    if (String(marker.cableId) !== String(cableId)) return;
    (marker.coreAssignments || []).forEach(ca => {
      if (ca.coreNumber === a) ca.coreNumber = b; else if (ca.coreNumber === b) ca.coreNumber = a;
    });
  }));
  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

export function updateCableCoreColour(cableId, coreNo, code) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;
  pushHistory();
  if (!cable.coreColours) cable.coreColours = {};
  if (code) cable.coreColours[coreNo] = code; else delete cable.coreColours[coreNo];
  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

export function applyStandardCableColours(cableId) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;
  pushHistory();
  cable.coreColours = coloursToMap(standardCoreColours(cable.coreCount));
  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

// Copies a cable's definition into the library (Pro: the library is a Pro feature to edit).
export async function saveCableToLibrary(cableId) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;
  if (isFreePlan()) { await appAlert('Adding to the cable library is a Pro feature. You can still pick from the standard cables already in your library.'); return; }
  if (!state.cableLibrary) state.cableLibrary = [];
  const base = [cable.cableType, `${cable.coreCount}C`, cable.csa].filter(Boolean).join(' ').slice(0, 40) || `${cable.coreCount}C cable`;
  let name = base, n = 2;
  while (state.cableLibrary.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    const suffix = ` (${n++})`; name = base.slice(0, 40 - suffix.length) + suffix;
  }
  const out = addCableEntry(state.cableLibrary, { name, cableType: cable.cableType, coreCount: cable.coreCount, csa: cable.csa, description: '', coreColours: cableColourList(cable) });
  if (!out.ok) { await appAlert(out.error); return; }
  scheduleAutosave();
  await appAlert(`Saved to the cable library as "${out.entry.name}". Rename it or add details in Cable Library.`);
}

// Unassigns one specific core from a cable and strips that core's entry from
// every marker (any sheet) that shows it — releasing it back to the pool for
// the cable tool to reuse. A marker left with no core assignments at all is
// removed outright, since a bare line with no ticks isn't meaningful.
export function clearCableCore(cableId, coreNumber) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;

  pushHistory();
  delete cable.coreWireIds[coreNumber];

  state.sheets.forEach(sheet => {
    if (!sheet.cableMarkers) return;
    sheet.cableMarkers.forEach(marker => {
      if (String(marker.cableId) !== String(cableId)) return;
      marker.coreAssignments = (marker.coreAssignments || []).filter(ca => ca.coreNumber !== Number(coreNumber));
      if (marker.coreAssignments.length > 0) {
        const wasHorizontal = Math.abs(marker.x2 - marker.x1) >= Math.abs(marker.y2 - marker.y1);
        Object.assign(marker, computeTrunkExtent(marker.coreAssignments, wasHorizontal));
      }
    });
    sheet.cableMarkers = sheet.cableMarkers.filter(m =>
      String(m.cableId) !== String(cableId) || (m.coreAssignments && m.coreAssignments.length > 0)
    );
  });

  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

export async function deleteCable(cableId) {
  const cable = (state.cables || []).find(c => String(c.id) === String(cableId));
  if (!cable) return;
  const proceed = await appConfirm(`Delete cable "${cable.designator}"? This also removes its markers from every sheet.`);
  if (!proceed) return;

  pushHistory();
  state.cables = state.cables.filter(c => String(c.id) !== String(cableId));
  state.sheets.forEach(sheet => {
    if (sheet.cableMarkers) sheet.cableMarkers = sheet.cableMarkers.filter(m => String(m.cableId) !== String(cableId));
  });

  renderCableManagerTable();
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

// Removes one cable marker from a sheet and releases the cores it held
// (unless some OTHER marker anywhere still shows that same core — e.g. this
// cable's source crossing stays valid even after deleting its destination
// crossing). Pure data work — no history/render/autosave — so a caller
// removing several at once (a rubber-band group) can wrap the whole batch in
// one history step instead of one per marker.
export function removeCableMarker(sheet, markerId) {
  const marker = (sheet?.cableMarkers || []).find(m => m.id === markerId);
  if (!marker) return;
  sheet.cableMarkers = sheet.cableMarkers.filter(m => m.id !== markerId);

  const cable = (state.cables || []).find(c => c.id === marker.cableId);
  if (cable) {
    (marker.coreAssignments || []).forEach(({ coreNumber }) => {
      const stillUsedElsewhere = state.sheets.some(s =>
        (s.cableMarkers || []).some(m => m.cableId === marker.cableId && (m.coreAssignments || []).some(ca => ca.coreNumber === coreNumber))
      );
      if (!stillUsedElsewhere) delete cable.coreWireIds[coreNumber];
    });
  }
}

export function deleteSelectedCableMarker() {
  if (!state.selectedCableMarkerId) return;
  const sheet = getActiveSheet();
  if (!sheet?.cableMarkers?.some(m => m.id === state.selectedCableMarkerId)) return;

  pushHistory();
  removeCableMarker(sheet, state.selectedCableMarkerId);
  state.selectedCableMarkerId = null;

  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();
  scheduleAutosave();
}

// ---- cable schedule (CSV) ----
// One row per wired core: cable, type, CSA, core, colour, wire ID, then the device and pin at each end.
const csvCell = (v) => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function buildCableSchedule() {
  const rows = [];
  const openMap = findOpenWireEndpoints();
  (state.cables || []).forEach(cable => {
    const routes = traceCableCores(cable, openMap);
    for (let i = 1; i <= (cable.coreCount || 0); i++) {
      const wireId = (cable.coreWireIds || {})[i];
      if (!wireId) continue;
      const r = routes[i] || { fromPins: [], toPins: [] };
      const part = (list, f) => list.map(e => f(e)).join(' / ');
      const dev = e => e.device + (e.sheet ? ` (Sh.${e.sheet})` : '');
      rows.push([cable.designator || '', cable.cableType || '', cable.csa || '', i, coreColourOf(cable, i), wireId,
        part(r.fromPins, dev), part(r.fromPins, e => e.pin), part(r.toPins, dev), part(r.toPins, e => e.pin)]);
    }
  });
  return rows;
}

export async function exportCableSchedule() {
  const rows = buildCableSchedule();
  if (!rows.length) { await appAlert('There are no wired cable cores to list yet.'); return; }
  const head = ['Cable', 'Type', 'CSA (mm2)', 'Core', 'Core colour', 'Wire ID', 'From device', 'From pin', 'To device', 'To pin'];
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const name = (document.getElementById('projectNameInput')?.value || 'schematic').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'schematic';
  await saveTextFile(csv, `${name}_cable_schedule.csv`, 'text/csv', 'Cable schedule (CSV)');
}
