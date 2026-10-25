// ==========================================
// 13. TERMINAL MODELS MANAGER
// ==========================================
// Where a terminal type is defined once — its name, make, part number, description
// and how many levels it has — so it never has to be filled in again. A terminal
// just points at its model, so changing a model here changes every terminal that
// uses it, on every sheet; and the BOM takes its details from it.
//
// Opened from the terminal dialog ("+ New / edit models…"). When it closes, the
// dialog is told which model was last worked on, and selects it.
//
// Terminal models are a Pro feature: on the Free plan the manager opens read-only.
// The rules (what a valid model is, what may be changed, what deleting does) live
// in 11_terminal_blocks.js and are tested there; this file is the form.

import { isFreePlan, appAlert, appConfirm, pushHistory, scheduleAutosave, saveTextFile } from './1_config_state.js';
import { renderComponents } from './3_schematic_engine.js';
import { openEditModal } from './5_portfolio_sheets.js';
import * as TB from './11_terminal_blocks.js';

const LEVEL_NAMES = { 1: 'single level', 2: 'double level', 3: 'triple level', 4: 'four levels' };

let session = null;      // { onClose, lastId } while the manager is open
let editingId = null;    // the model on the form; null = a new one

const el = (id) => document.getElementById(id);
const FIELD_IDS = ['tmName', 'tmMake', 'tmModelNo', 'tmDescription', 'tmLevels'];

function setMessage(text, kind) {
  const box = el('tmMessage');
  if (!box) return;
  box.textContent = text || '';
  box.style.display = text ? 'block' : 'none';
  box.style.color = kind === 'error' ? '#f87171' : (kind === 'ok' ? '#4ade80' : '');
}

function populateList(selectedId) {
  const list = el('tmList');
  if (!list) return;
  list.innerHTML = '';
  TB.listTerminalModels().forEach(m => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = `${m.name}  \u2014  ${m.levels} level${m.levels === 1 ? '' : 's'}${m.modelNo ? `  \u00b7  ${m.modelNo}` : ''}`;
    list.appendChild(opt);
  });
  list.value = selectedId !== null && selectedId !== undefined && TB.findTerminalModel(selectedId) ? String(selectedId) : '';
}

function populateLevels() {
  const select = el('tmLevels');
  if (!select) return;
  select.innerHTML = '';
  for (let n = 1; n <= TB.MAX_TERMINAL_LEVELS; n++) {
    const opt = document.createElement('option');
    opt.value = String(n); opt.textContent = `${n} \u2014 ${LEVEL_NAMES[n]}`;
    select.appendChild(opt);
  }
}

function fillForm(model) {
  el('tmName').value = model ? model.name : '';
  el('tmMake').value = model ? model.make : '';
  el('tmModelNo').value = model ? model.modelNo : '';
  el('tmDescription').value = model ? model.description : '';
  el('tmLevels').value = String(model ? model.levels : 1);
  const usage = el('tmUsage');
  if (usage) {
    const n = model ? TB.terminalsUsingModel(model.id).length : 0;
    usage.textContent = model ? (n === 0 ? 'Not used by any terminal yet.' : `Used by ${n} terminal${n === 1 ? '' : 's'}. Changes here apply to ${n === 1 ? 'it' : 'all of them'}.`) : 'A new model.';
  }
  const del = el('tmDeleteBtn');
  if (del) del.disabled = !model || isFreePlan();
  setMessage('');
}

function readForm() {
  return { name: el('tmName').value, make: el('tmMake').value, modelNo: el('tmModelNo').value, description: el('tmDescription').value, levels: el('tmLevels').value };
}

export function openTerminalModelsModal({ selectId = null, onClose = null } = {}) {
  session = { onClose, lastId: TB.findTerminalModel(selectId) ? TB.findTerminalModel(selectId).id : null };
  const pro = !isFreePlan();
  populateLevels();
  populateList(selectId);
  const model = TB.findTerminalModel(selectId);
  editingId = model ? model.id : null;
  fillForm(model);
  FIELD_IDS.forEach(id => { const e = el(id); if (e) e.disabled = !pro; });
  ['tmSaveBtn', 'tmNewBtn', 'tmImportBtn', 'tmStandardBtn'].forEach(id => { const e = el(id); if (e) e.disabled = !pro; });
  if (!pro) setMessage('Terminal models are a Pro feature. You can look at the ones in this project, but not change them.', 'error');
  wireKeyboardOnce();
  el('terminalModelsModal').style.display = 'flex';
  const focus = pro ? el('tmName') : el('tmList');
  if (focus && focus.focus) focus.focus();
}

export function closeTerminalModelsModal() {
  const modal = el('terminalModelsModal');
  if (modal) modal.style.display = 'none';
  const done = session;
  session = null; editingId = null;
  if (done && typeof done.onClose === 'function') done.onClose(done.lastId);
}

function wireKeyboardOnce() {
  const modal = el('terminalModelsModal');
  if (!modal || modal.dataset.keysWired === '1') return;
  modal.dataset.keysWired = '1';
  modal.addEventListener('keydown', (e) => {
    if (!session) return;
    if (e.key === 'Escape') { e.preventDefault(); closeTerminalModelsModal(); }
    else if (e.key === 'Enter' && e.target?.tagName === 'INPUT') { e.preventDefault(); saveTerminalModelForm(); }
  });
}

export function newTerminalModelForm() {
  editingId = null;
  const list = el('tmList'); if (list) list.value = '';
  fillForm(null);
  const name = el('tmName'); if (name && name.focus) name.focus();
}

export function onTerminalModelListPick() {
  const model = TB.findTerminalModel(el('tmList')?.value);
  editingId = model ? model.id : null;
  if (session && model) session.lastId = model.id;
  fillForm(model);
}

export function saveTerminalModelForm() {
  if (isFreePlan() || !session) return;
  const fields = readForm();
  const result = editingId ? TB.updateTerminalModel(editingId, fields) : TB.addTerminalModel(fields);
  if (!result.ok) {
    setMessage(result.errors.name || result.errors.levels || 'That model could not be saved.', 'error');
    const bad = result.errors.name ? el('tmName') : el('tmLevels');
    if (bad && bad.focus) bad.focus();
    return;
  }
  editingId = result.model.id;
  session.lastId = result.model.id;
  populateList(editingId);
  fillForm(result.model);
  setMessage('Saved.', 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);   // levels and part details may have changed on the sheet
}

export async function deleteTerminalModelFromForm() {
  if (isFreePlan() || !session || !editingId) return;
  const model = TB.findTerminalModel(editingId);
  if (!model) return;
  const n = TB.terminalsUsingModel(model.id).length;
  const proceed = await appConfirm(
    `Delete the model ${model.name}?` +
    (n ? `\n\n${n} terminal${n === 1 ? ' uses' : 's use'} it. ${n === 1 ? 'It keeps' : 'They keep'} ${n === 1 ? 'its' : 'their'} number of levels and part details; ${n === 1 ? 'it' : 'they'} just stop${n === 1 ? 's' : ''} being linked to the model.` : '')
  );
  if (!proceed) return;
  pushHistory();
  TB.deleteTerminalModel(model.id);
  editingId = null;
  session.lastId = null;
  populateList(null);
  fillForm(null);
  setMessage(`Deleted ${model.name}.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// ---- save to a file, load from a file, the standard set ----

function describeMerge(r, skipped) {
  const parts = [];
  if (r.added) parts.push(`${r.added} added${r.renamed ? ` (${r.renamed} under a new name because that name was already used for a different model)` : ''}`);
  if (r.unchanged) parts.push(`${r.unchanged} already here`);
  if (skipped) parts.push(`${skipped} skipped because ${skipped === 1 ? 'it was' : 'they were'} not valid`);
  return parts.length ? parts.join(', ') + '.' : 'Nothing to add.';
}

function afterModelsChanged(selectId) {
  populateList(selectId ?? editingId);
  const model = TB.findTerminalModel(editingId);
  if (!model) editingId = null;
  fillForm(model);
  if (session && selectId) session.lastId = selectId;
  scheduleAutosave();
}

export async function exportTerminalModels() {
  const models = TB.listTerminalModels();
  if (!models.length) { await appAlert('There are no terminal models in this project to save yet.'); return; }
  const data = TB.buildTerminalModelExport('Terminal models');
  const saved = await saveTextFile(JSON.stringify(data, null, 2), 'terminal-models.json', 'application/json', 'Terminal Models (JSON)');
  if (saved) setMessage(`Saved ${models.length} model${models.length === 1 ? '' : 's'} to a file.`, 'ok');
}

export function chooseTerminalModelsFile() {
  if (isFreePlan() || !session) return;
  const input = el('tmImportInput');
  if (input) input.click();
}

export function importTerminalModelsFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file || isFreePlan() || !session) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(String(reader.result)); }
    catch (err) { setMessage('That file could not be read as a terminal models file.', 'error'); return; }
    const parsed = TB.parseTerminalModelFile(data);
    if (!parsed.ok) { setMessage(parsed.error, 'error'); return; }
    if (!parsed.models.length) { setMessage(parsed.skipped ? 'None of the models in that file were valid.' : 'That file has no models in it.', 'error'); return; }
    const result = TB.mergeTerminalModels(parsed.models);
    afterModelsChanged();
    setMessage('Imported: ' + describeMerge(result, parsed.skipped), result.added ? 'ok' : undefined);
  };
  reader.onerror = () => setMessage('That file could not be read.', 'error');
  reader.readAsText(file);
}

export function addStandardTerminalModelsFromForm() {
  if (isFreePlan() || !session) return;
  const result = TB.addStandardTerminalModels();
  afterModelsChanged();
  setMessage(result.added ? 'Standard set: ' + describeMerge(result, 0) : 'You already have the whole standard set.', result.added ? 'ok' : undefined);
}

window.openTerminalModelsModal = openTerminalModelsModal;
