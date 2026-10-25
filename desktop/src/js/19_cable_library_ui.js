// ==========================================
// 19. CABLE LIBRARY WINDOW
// ==========================================
// Where a cable is defined once - name, type, core count, CSA and the colour of
// each core - so it never has to be typed in again. Picking it in the Assign to
// Cable window fills everything in. The rules live in 18_cable_library.js.
//
// Editing the library, loading a file and the standard set are Pro features;
// on the Free plan the window opens read-only, and saving a file is allowed.
import { state, isFreePlan, appAlert, appConfirm, scheduleAutosave, saveTextFile } from './1_config_state.js';
import * as CL from './18_cable_library.js';

let editingId = null;    // the entry on the form; null = a new one
let colours = [];        // the form's core colours, core 1 first

const el = (id) => document.getElementById(id);
const lib = () => (state.cableLibrary || (state.cableLibrary = []));
const FIELDS = ['clName', 'clType', 'clCores', 'clCsa', 'clDescription'];

function setMessage(text, kind) {
  const box = el('clMessage');
  if (!box) return;
  box.textContent = text || '';
  box.style.display = text ? 'block' : 'none';
  box.style.color = kind === 'error' ? '#f87171' : (kind === 'ok' ? '#4ade80' : '');
}

function populateList(selectedId) {
  const list = el('clList');
  if (!list) return;
  list.innerHTML = '';
  lib().forEach(e => {
    const opt = document.createElement('option');
    opt.value = String(e.id);
    opt.textContent = `${e.name}  —  ${e.coreCount} core${e.coreCount === 1 ? '' : 's'}${e.csa ? `  ·  ${e.csa} mm²` : ''}`;
    list.appendChild(opt);
  });
  list.value = selectedId !== null && selectedId !== undefined && lib().some(e => String(e.id) === String(selectedId)) ? String(selectedId) : '';
}

function renderColourRows() {
  const box = el('clColours');
  if (!box) return;
  const pro = !isFreePlan();
  box.innerHTML = colours.map((c, i) =>
    `<div class="cable-lib-core"><b>${i + 1}</b>${CL.colourSwatchHtml(c)}<select class="cable-colour-select" ${pro ? '' : 'disabled'} onchange="onCableLibraryColourChange(${i}, this.value)">${CL.colourOptionsHtml(c)}</select></div>`).join('');
}

function fillForm(entry) {
  el('clName').value = entry ? entry.name : '';
  el('clType').value = entry ? entry.cableType : '';
  el('clCores').value = entry ? entry.coreCount : 3;
  el('clCsa').value = entry ? entry.csa : '';
  el('clDescription').value = entry ? entry.description : '';
  colours = CL.fitColours(entry ? entry.coreColours : [], entry ? entry.coreCount : 3);
  renderColourRows();
  const del = el('clDeleteBtn');
  if (del) del.disabled = !entry || isFreePlan();
  setMessage('');
}

function readForm() {
  const n = Math.max(1, Math.min(CL.MAX_CABLE_CORES, parseInt(el('clCores').value, 10) || 0));
  return { name: el('clName').value, cableType: el('clType').value, coreCount: n, csa: el('clCsa').value, description: el('clDescription').value, coreColours: CL.fitColours(colours, n) };
}

export function openCableLibraryModal(selectId = null) {
  const pro = !isFreePlan();
  populateList(selectId);
  const entry = lib().find(e => String(e.id) === String(selectId)) || null;
  editingId = entry ? entry.id : null;
  fillForm(entry);
  FIELDS.forEach(id => { const e = el(id); if (e) e.disabled = !pro; });
  ['clSaveBtn', 'clNewBtn', 'clImportBtn', 'clStandardBtn'].forEach(id => { const e = el(id); if (e) e.disabled = !pro; });
  if (!pro) setMessage('The cable library is a Pro feature. You can look at the cables in it and pick them when assigning, but not change them.', 'error');
  const modal = el('cableLibraryModal');
  if (modal) modal.style.display = 'flex';
}

export function closeCableLibraryModal() {
  const modal = el('cableLibraryModal');
  if (modal) modal.style.display = 'none';
  editingId = null;
}

export function newCableLibraryForm() {
  editingId = null;
  const list = el('clList'); if (list) list.value = '';
  fillForm(null);
  const name = el('clName'); if (name && name.focus) name.focus();
}

export function onCableLibraryListPick() {
  const entry = lib().find(e => String(e.id) === String(el('clList')?.value)) || null;
  editingId = entry ? entry.id : null;
  fillForm(entry);
}

export function onCableLibraryCoresChange() {
  const n = Math.max(1, Math.min(CL.MAX_CABLE_CORES, parseInt(el('clCores').value, 10) || 1));
  el('clCores').value = n;
  colours = CL.fitColours(colours, n);
  renderColourRows();
}

export function onCableLibraryColourChange(index, code) {
  colours[index] = code;
  renderColourRows();
}

export function fillStandardCableLibraryColours() {
  if (isFreePlan()) return;
  const n = Math.max(1, Math.min(CL.MAX_CABLE_CORES, parseInt(el('clCores').value, 10) || 1));
  colours = CL.standardCoreColours(n);
  renderColourRows();
}

export function saveCableLibraryForm() {
  if (isFreePlan()) return;
  const fields = readForm();
  const result = editingId ? CL.updateCableEntry(lib(), editingId, fields) : CL.addCableEntry(lib(), fields);
  if (!result.ok) { setMessage(result.error, 'error'); return; }
  editingId = result.entry.id;
  populateList(editingId);
  fillForm(result.entry);
  setMessage('Saved.', 'ok');
  scheduleAutosave();
}

export async function deleteCableLibraryEntry() {
  if (isFreePlan() || !editingId) return;
  const entry = lib().find(e => String(e.id) === String(editingId));
  if (!entry) return;
  const proceed = await appConfirm(`Delete "${entry.name}" from the cable library? Cables already drawn in this project are not affected.`);
  if (!proceed) return;
  CL.deleteCableEntry(lib(), entry.id);
  editingId = null;
  populateList(null);
  fillForm(null);
  setMessage('Deleted.', 'ok');
  scheduleAutosave();
}

export async function exportCableLibrary() {
  if (!lib().length) { await appAlert('There are no cables in this library to save yet.'); return; }
  const data = CL.buildCableLibraryExport(lib(), 'Cable library');
  const saved = await saveTextFile(JSON.stringify(data, null, 2), 'cable-library.json', 'application/json', 'Cable Library (JSON)');
  if (saved) setMessage(`Saved ${lib().length} cable${lib().length === 1 ? '' : 's'} to a file.`, 'ok');
}

export function chooseCableLibraryFile() {
  if (isFreePlan()) return;
  const input = el('clImportInput');
  if (input) input.click();
}

export function importCableLibraryFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file || isFreePlan()) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(String(reader.result)); }
    catch (err) { setMessage('That file could not be read as a cable library file.', 'error'); return; }
    const parsed = CL.parseCableLibraryFile(data);
    if (!parsed.ok) { setMessage(parsed.error, 'error'); return; }
    if (!parsed.cables.length) { setMessage(parsed.skipped ? 'None of the cables in that file were valid.' : 'That file has no cables in it.', 'error'); return; }
    const result = CL.mergeCableEntries(lib(), parsed.cables);
    populateList(editingId);
    scheduleAutosave();
    setMessage('Imported: ' + CL.describeMerge(result, parsed.skipped), result.added ? 'ok' : undefined);
  };
  reader.onerror = () => setMessage('That file could not be read.', 'error');
  reader.readAsText(file);
}

export function addStandardCablesFromForm() {
  if (isFreePlan()) return;
  const result = CL.addStandardCableEntries(lib());
  populateList(editingId);
  scheduleAutosave();
  setMessage(result.added ? 'Standard set: ' + CL.describeMerge(result, 0) : 'You already have the whole standard set.', result.added ? 'ok' : undefined);
}
