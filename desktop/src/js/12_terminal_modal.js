// ==========================================
// 12. TERMINAL DIALOG
// ==========================================
// What appears when a terminal is placed (the Terminal tool) or double-clicked:
// which block it belongs to — an existing one, or a new one — and where that
// block is (its location), its position and level on it, its terminal model (which
// says how many levels it has), whether it is a standard or a PE terminal, and
// what the label on the sheet shows.
//
// Placing a run of terminals is meant to be quick: the dialog comes up with the
// block last used and the next free position already filled in, so each one is
// click, Enter. Cancelling a placement places nothing.
//
// The location controls are always there (greyed out, marked Pro, on the Free
// plan) — a block's location can be set when it is created and changed later,
// which moves every terminal on it.
//
// The rules for blocks, positions and what is valid live in
// 11_terminal_blocks.js (and are tested there); this file is the form.

import { state, isFreePlan, appConfirm, appAlert, pushHistory, scheduleAutosave, getSchematicSheetNumber } from './1_config_state.js';
import { placeTerminal, renderComponents } from './3_schematic_engine.js';
import { openEditModal, populateLocationDropdown, handleLocationSelectChange } from './5_portfolio_sheets.js';
import * as TB from './11_terminal_blocks.js';
import { analyseSide } from './43_terminal_sides.js';

const NEW_BLOCK = '__new__';
const MANAGE_MODELS = '__manage__';
const LEVEL_NAMES = { 1: 'single', 2: 'double', 3: 'triple', 4: 'quad' };

let dialog = null;             // what the open dialog is doing: { mode: 'place' | 'edit', sheet, x, y, comp }
let positionTouched = false;   // once the person types a position, changing the block does not overwrite it
let labelTouched = false;      // likewise the "location in the label" choice
let levelTouched = false;      // likewise the level, until the block or position changes
let lastModelChoice = null;    // the model chosen in the dialog before "New / edit models…" was picked
let lastDescKey = null;        // which block the description box was last filled in for
let lastChoice = { blockKey: null, modelId: null };   // remembered between placements, this session only

const el = (id) => document.getElementById(id);
const normLoc = (v) => (v === undefined || v === null || v === '') ? null : String(v);
const sheetLocationId = () => normLoc(dialog?.sheet?.iecLocation);
const findLoc = (id) => state.locations.find(l => String(l.id) === String(id)) || null;

function locationText(id) {
  const loc = findLoc(id);
  if (!loc) return 'no location';
  return loc.description ? `+${loc.abbreviation} \u2014 ${loc.description}` : `+${loc.abbreviation}`;
}

// What the first entry of the location list means depends on the block: for a new
// one it is "follow the sheet", for an existing one "leave it where it is".
function locationNoneLabel(isNew, block) {
  if (isNew) {
    const loc = findLoc(sheetLocationId());
    return loc ? `Same as the sheet (+${loc.abbreviation})` : 'Same as the sheet';
  }
  return block && block.locationId ? `Currently ${locationText(block.locationId)}` : 'Currently no location';
}

// ---- reading the form ----

function readForm() {
  const pro = !isFreePlan();
  const sel = el('terminalBlockSelect')?.value || '';
  const isNew = sel === NEW_BLOCK;
  const choice = pro ? (el('terminalLocationSelect')?.value || '') : '';
  const picked = choice !== '' && choice !== '__new__' ? String(choice) : null;

  let blockName, currentLocationId, locationId;
  if (isNew) {
    blockName = (el('terminalNewBlockName')?.value || '').trim();
    locationId = picked ?? sheetLocationId();
    currentLocationId = locationId;
  } else {
    const block = TB.findTerminalBlock(sel);
    blockName = block ? block.name : '';
    currentLocationId = block ? block.locationId : sheetLocationId();
    locationId = picked ?? currentLocationId;
  }
  // A name typed for a "new" block that is really an existing one (x1 for X1,
  // in the same location) means that block — with its own spelling.
  const existing = isNew && blockName ? TB.findTerminalBlock(TB.blockKey(blockName, locationId)) : null;
  if (existing) blockName = existing.name;

  const modelChoice = el('terminalModelSelect')?.value || '';
  const model = modelChoice && modelChoice !== MANAGE_MODELS ? TB.findTerminalModel(modelChoice) : null;

  return {
    isNew, blockName, locationId, currentLocationId,
    modelId: model ? model.id : null,
    levels: model ? model.levels : (Number(el('terminalLevelsSelect')?.value) || 1),
    level: Number(el('terminalLevel')?.value) || 1,
    moving: !isNew && locationId !== currentLocationId,       // an existing block being given a different location
    key: blockName ? TB.blockKey(blockName, currentLocationId) : '',
    position: el('terminalPosition')?.value ?? '',
    kind: el('terminalKindPE')?.checked ? TB.TERMINAL_KIND_PE : 'standard',
    side: el('terminalSide')?.value || TB.SIDE_AUTO,
    locationLabel: el('terminalLocationLabel')?.value || TB.LOCATION_LABEL_AUTO,
    labelBlockWide: !!el('terminalLocationLabelBlock')?.checked,
    description: (el('terminalBlockDescription')?.value || '').replace(/\s+/g, ' ').trim()
  };
}

// The side a conflict is judged on. Internal and external connections may share a screw, so only a symbol on the SAME side is
// in the way. A terminal set to Automatic keeps the side it resolves to now when it is being edited; one being placed has no
// wire yet, so it counts as internal until the side is chosen.
function conflictSide(form) {
  if (form.side === TB.SIDE_INTERNAL || form.side === TB.SIDE_EXTERNAL) return form.side;
  return dialog?.mode === 'edit' && dialog.comp ? TB.terminalSideOf(dialog.comp, dialog.sheet) : TB.SIDE_INTERNAL;
}

// ---- keeping the form consistent as it is changed ----

function populateBlockSelect(selectedKey) {
  const select = el('terminalBlockSelect');
  if (!select) return;
  select.innerHTML = '';
  TB.listTerminalBlocks().forEach(block => {
    const opt = document.createElement('option');
    opt.value = block.key;
    opt.textContent = `${block.displayName}${block.description ? ` (${block.description})` : ''} \u2014 ${block.terminals.length} terminal${block.terminals.length === 1 ? '' : 's'}`;
    select.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = NEW_BLOCK; newOpt.textContent = '+ New block\u2026';
  select.appendChild(newOpt);
  select.value = selectedKey;
}

// Rebuilt whenever the chosen block changes, since its first entry means something different.
function populateLocationChoices() {
  const select = el('terminalLocationSelect');
  if (!select) return;
  const isNew = (el('terminalBlockSelect')?.value || '') === NEW_BLOCK;
  const block = isNew ? null : TB.findTerminalBlock(el('terminalBlockSelect')?.value || '');
  populateLocationDropdown('terminalLocationSelect', '', { includeNone: true, noneLabel: locationNoneLabel(isNew, block) });
  select.dataset.prev = '';
}

// The four choices say what they would look like for THIS block.
function updateLabelChoiceText(form) {
  const select = el('terminalLocationLabel');
  if (!select || !select.children) return;
  const name = form.blockName || 'X1';
  const loc = findLoc(form.locationId);
  const withLocation = loc && loc.abbreviation ? `+${loc.abbreviation}-${name}` : name;
  const n = Number(form.position);
  const position = Number.isInteger(n) && n >= 1 ? String(n) : '#';
  const text = {
    [TB.LOCATION_LABEL_AUTO]: 'Automatic \u2014 the location only when it differs from the sheet\u2019s',
    [TB.LOCATION_LABEL_SHOW]: `Always show the location (${withLocation})`,
    [TB.LOCATION_LABEL_HIDE]: `Hide the location (${name})`,
    [TB.LOCATION_LABEL_POSITION]: `Position only \u2014 hide the location and block (${position})`
  };
  Array.from(select.children).forEach(opt => { if (text[opt.value]) opt.textContent = text[opt.value]; });
}

function setHint(text, warning) {
  const hint = el('terminalPositionHint');
  if (!hint) return;
  hint.textContent = text;
  hint.style.color = warning ? '#fbbf24' : '';
}

function showError(message) {
  const box = el('terminalFormError');
  if (!box) return;
  box.textContent = message || '';
  box.style.display = message ? 'block' : 'none';
}

const range = (from, to) => { const out = []; for (let i = from; i <= to; i++) out.push(i); return out; };

function setSelectOptions(id, values, selected, labelFor) {
  const select = el(id);
  if (!select) return;
  select.innerHTML = '';
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = labelFor ? labelFor(v) : String(v);
    select.appendChild(opt);
  });
  select.value = String(selected);
}

function populateModelSelect(selectedId) {
  const select = el('terminalModelSelect');
  if (!select) return;
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'None \u2014 choose the levels';
  select.appendChild(none);
  TB.listTerminalModels().forEach(m => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = `${m.name} \u2014 ${m.levels} level${m.levels === 1 ? '' : 's'}`;
    select.appendChild(opt);
  });
  const manage = document.createElement('option');
  manage.value = MANAGE_MODELS; manage.textContent = '+ New / edit models\u2026';
  select.appendChild(manage);
  select.value = selectedId !== null && selectedId !== undefined && TB.findTerminalModel(selectedId) ? String(selectedId) : '';
}

// The terminal on a block that was placed last — the one the next is most like.
function lastTerminalOf(block, excludeId) {
  if (!block) return null;
  const comps = block.terminals.map(t => t.comp).filter(c => String(c.id) !== String(excludeId));
  comps.sort((a, b) => a.position - b.position || TB.levelOf(a) - TB.levelOf(b));
  return comps.length ? comps[comps.length - 1] : null;
}

// Shows or hides the new-block fields, suggests a position and level when the person
// has not chosen them, works out the model, the levels and which levels can be picked,
// follows the block's own label choice, and describes what is on the block.
function refreshForm({ fromBlockChange = false, fromPositionChange = false, fromModelChange = false, fromLevelsChange = false } = {}) {
  const isNew = (el('terminalBlockSelect')?.value || '') === NEW_BLOCK;
  const newRow = el('terminalNewBlockRow');
  if (newRow) newRow.style.display = isNew ? 'block' : 'none';
  showError('');
  if (fromBlockChange) populateLocationChoices();

  let form = readForm();
  const excludeId = dialog?.comp?.id;
  const block = form.key ? TB.findTerminalBlock(form.key) : null;

  // The description box shows the chosen block's description, and starts again when a different block is chosen.
  // Typing in it is left alone while the same block stays chosen (even while a new block's name is being typed).
  const descKey = block ? form.key : 'new';
  if (descKey !== lastDescKey) {
    lastDescKey = descKey;
    if (el('terminalBlockDescription')) el('terminalBlockDescription').value = block ? (block.description || '') : '';
    form = readForm();
  }

  // Where on the block: the next free slot, unless a position has been typed.
  let suggestedLevel = null;
  if (fromBlockChange && !positionTouched) {
    const slot = form.key ? TB.nextFreeSlot(form.key, excludeId) : { position: 1, level: 1 };
    const input = el('terminalPosition');
    if (input) input.value = String(slot.position);
    suggestedLevel = slot.level;
  }
  if (fromBlockChange || fromPositionChange) levelTouched = false;

  const positionNumber = Number(el('terminalPosition')?.value);
  const havePosition = Number.isInteger(positionNumber) && positionNumber >= 1;
  const physical = form.key && havePosition ? TB.physicalTerminalAt(form.key, positionNumber, excludeId) : null;

  // The model and the levels. A physical terminal that is already there decides them
  // (its levels are a fact about the terminal); otherwise a terminal joining a block
  // is like the one placed before it.
  let desiredModel = el('terminalModelSelect')?.value ?? '';
  let desiredLevels = Number(el('terminalLevelsSelect')?.value) || 1;
  if (fromBlockChange || fromPositionChange) {
    const last = lastTerminalOf(block, excludeId);
    if (physical) { desiredModel = physical.modelId !== null ? String(physical.modelId) : ''; desiredLevels = physical.levels; }
    else if (fromBlockChange && last) { desiredModel = last.modelId ? String(last.modelId) : ''; desiredLevels = TB.levelsOf(last); }
    else if (fromBlockChange) { desiredModel = lastChoice.modelId !== null && TB.findTerminalModel(lastChoice.modelId) ? String(lastChoice.modelId) : ''; desiredLevels = 1; }
  }
  const modelSelect = el('terminalModelSelect');
  if (modelSelect && desiredModel !== modelSelect.value && desiredModel !== MANAGE_MODELS) modelSelect.value = TB.findTerminalModel(desiredModel) ? String(desiredModel) : '';
  const model = modelSelect && modelSelect.value && modelSelect.value !== MANAGE_MODELS ? TB.findTerminalModel(modelSelect.value) : null;

  // Only levels that can exist: none fewer than one already drawn on this terminal,
  // and with a model, the model's count and nothing else.
  const minLevels = physical ? Math.max(...physical.usedLevels) : 1;
  const levelsNow = model ? model.levels : Math.min(TB.MAX_TERMINAL_LEVELS, Math.max(minLevels, desiredLevels));
  const levelsSelect = el('terminalLevelsSelect');
  setSelectOptions('terminalLevelsSelect', model ? [model.levels] : range(minLevels, TB.MAX_TERMINAL_LEVELS), levelsNow, n => (n === 1 ? '1' : `${n} \u2014 ${LEVEL_NAMES[n] || ''}`));
  if (levelsSelect) levelsSelect.disabled = !!model;

  // Which level this symbol is: 1 to however many there are.
  const currentLevel = Number(el('terminalLevel')?.value) || 1;
  let levelNow = Math.min(currentLevel, levelsNow);
  if (!levelTouched && (fromBlockChange || fromPositionChange || fromModelChange || fromLevelsChange || suggestedLevel !== null)) {
    const free = physical ? TB.lowestFreeLevel(form.key, positionNumber, excludeId) : (suggestedLevel ?? 1);
    levelNow = Math.min(free ?? 1, levelsNow);
  }
  const drawn = physical ? physical.usedLevels : [];
  setSelectOptions('terminalLevel', range(1, levelsNow), levelNow, n => (drawn.includes(n) ? `${n} \u2014 drawn` : String(n)));
  if (el('terminalLevel')) el('terminalLevel').disabled = levelsNow <= 1;

  form = readForm();

  // A terminal joining a block takes up whatever its terminals already agree on.
  if (fromBlockChange && !labelTouched) {
    const select = el('terminalLocationLabel');
    if (select) select.value = form.key ? TB.blockLocationLabelMode(form.key) : TB.LOCATION_LABEL_AUTO;
  }
  updateLabelChoiceText(form);

  const othersOnBlock = block ? block.terminals.filter(t => String(t.comp.id) !== String(excludeId)).length : 0;
  const blockRow = el('terminalLocationLabelBlockRow');
  if (blockRow) blockRow.style.display = othersOnBlock > 0 && !isFreePlan() ? 'flex' : 'none';
  if (blockRow && blockRow.style.display === 'none' && el('terminalLocationLabelBlock')) el('terminalLocationLabelBlock').checked = false;

  const note = el('terminalLocationNote');
  if (note) {
    const count = block ? block.terminals.length : 0;
    note.style.display = form.moving ? 'block' : 'none';
    note.textContent = form.moving ? `This moves ${count === 1 ? 'the terminal' : `all ${count} terminals`} on ${block.displayName} to ${locationText(form.locationId)}.` : '';
  }

  // What Automatic works out for this terminal (only a terminal already on a sheet has a wire to look at).
  const sideNote = el('terminalSideNote');
  if (sideNote) {
    const editing = dialog?.mode === 'edit' && dialog.comp;
    sideNote.style.display = editing && form.side === TB.SIDE_AUTO ? 'block' : 'none';
    if (editing && form.side === TB.SIDE_AUTO) {
      const a = analyseSide(dialog.comp, dialog.sheet);
      sideNote.textContent = `Automatic gives ${a.side}: ${a.reason}.`;
    }
  }

  if (!form.blockName) { setHint('Name the new block to see which positions it has.', false); return; }
  const others = block ? block.positions.filter(p => block.terminals.some(t => t.comp.position === p && String(t.comp.id) !== String(excludeId))) : [];
  const where = block ? block.displayName : TB.blockDisplayName(form.blockName, form.locationId);
  const next = form.key ? TB.nextFreeSlot(form.key, excludeId) : { position: 1, level: 1 };
  const nextText = next.level > 1 ? `${next.position}.${next.level}` : String(next.position);
  const slotConflicts = form.key && havePosition ? TB.findSlotConflicts(form.key, positionNumber, form.level, excludeId, conflictSide(form)) : [];
  if (slotConflicts.length) {
    const slotName = form.levels > 1 ? `Position ${positionNumber} level ${form.level}` : `Position ${positionNumber}`;
    setHint(`${slotName} on ${where} is already used by a terminal on sheet ${getSchematicSheetNumber(slotConflicts[0].sheetIndex) || slotConflicts[0].sheetIndex + 1}.`, true);
  } else if (physical && physical.levels > 1) {
    setHint(`${where}:${positionNumber} has ${physical.levels} levels \u2014 drawn: ${physical.usedLevels.join(', ')}.  Next free: ${nextText}.`, false);
  } else if (others.length) {
    setHint(`Positions in use on ${where}: ${TB.formatPositionRanges(others)}.  Next free: ${nextText}.`, false);
  } else {
    setHint(`${where} has no terminals yet \u2014 it will start at position ${nextText}.`, false);
  }
}

// ---- opening and closing ----

// mode 'place': a new terminal at (x, y) on sheet. mode 'edit': the terminal comp.
export function openTerminalModal({ mode = 'place', sheet, x, y, comp = null } = {}) {
  dialog = { mode, sheet, x, y, comp };
  positionTouched = false;
  lastDescKey = null;
  labelTouched = false;
  const editing = mode === 'edit' && !!comp;

  el('terminalModalTitle').textContent = editing ? 'Edit Terminal' : 'Place Terminal';
  el('terminalModalConfirmBtn').textContent = editing ? 'Save' : 'Place';
  el('terminalDetailsBtn').style.display = editing ? 'inline-flex' : 'none';

  const pe = editing && TB.isPETerminal(comp);
  el('terminalKindStandard').checked = !pe;
  el('terminalKindPE').checked = pe;
  if (el('terminalSide')) el('terminalSide').value = editing ? TB.terminalSideSetting(comp) : TB.SIDE_AUTO;

  // Locations are a Pro feature: the controls are there either way, so it is clear
  // they exist, but greyed out and marked on the Free plan.
  const pro = !isFreePlan();
  ['terminalLocationSelect', 'terminalLocationLabel', 'terminalLocationLabelBlock'].forEach(id => { const e = el(id); if (e) e.disabled = !pro; });
  if (el('terminalLocationHeading')) el('terminalLocationHeading').textContent = pro ? 'Location of this block' : 'Location of this block (Pro)';
  if (el('terminalLocationLabelHeading')) el('terminalLocationLabelHeading').textContent = pro ? 'Label shows' : 'Label shows (Pro)';

  // Which block to start on: this terminal's own, else the last one used, else
  // the first there is — or a new one, if there are none.
  const blocks = TB.listTerminalBlocks();
  let startKey = NEW_BLOCK;
  if (editing && TB.isAssignedTerminal(comp)) startKey = TB.terminalBlockKeyOf(comp, sheet);
  else if (lastChoice.blockKey && blocks.some(b => b.key === lastChoice.blockKey)) startKey = lastChoice.blockKey;
  else if (blocks.length) startKey = blocks[0].key;
  populateBlockSelect(blocks.some(b => b.key === startKey) ? startKey : NEW_BLOCK);
  populateLocationChoices();

  const newName = el('terminalNewBlockName');
  if (newName) newName.value = TB.suggestNewBlockName(sheetLocationId());

  // The position and level, the model and the levels: this terminal's own when editing;
  // otherwise the next free slot on the block, and — like the terminal placed before it —
  // its model and levels (or those of the terminal already at that position).
  const position = el('terminalPosition');
  const form = readForm();
  const startBlock = form.key ? TB.findTerminalBlock(form.key) : null;
  let initModel = null, initLevels = 1, initLevel = 1, initPosition = 1;
  if (editing && TB.isAssignedTerminal(comp)) {
    initModel = comp.modelId ?? null; initLevels = TB.levelsOf(comp); initLevel = TB.levelOf(comp); initPosition = comp.position;
  } else {
    const slot = form.key ? TB.nextFreeSlot(form.key, comp?.id) : { position: 1, level: 1 };
    initPosition = slot.position;
    const there = form.key ? TB.physicalTerminalAt(form.key, slot.position, comp?.id) : null;
    const last = lastTerminalOf(startBlock, comp?.id);
    if (there) { initModel = there.modelId; initLevels = there.levels; initLevel = TB.lowestFreeLevel(form.key, slot.position, comp?.id) ?? 1; }
    else if (last) { initModel = last.modelId ?? null; initLevels = TB.levelsOf(last); initLevel = slot.level; }
    else { initModel = lastChoice.modelId; }
  }
  position.value = String(initPosition);
  populateModelSelect(initModel);
  lastModelChoice = TB.findTerminalModel(initModel) ? String(initModel) : null;
  const initModelObj = TB.findTerminalModel(initModel);
  setSelectOptions('terminalLevelsSelect', range(1, TB.MAX_TERMINAL_LEVELS), initModelObj ? initModelObj.levels : initLevels);
  setSelectOptions('terminalLevel', range(1, initModelObj ? initModelObj.levels : initLevels), initLevel);
  if (el('terminalModelHeading')) el('terminalModelHeading').textContent = pro ? 'Terminal model' : 'Terminal model (Pro)';
  if (el('terminalModelSelect')) el('terminalModelSelect').disabled = !pro;

  // The location in the label: this terminal's own setting when editing; otherwise
  // whatever the block it is joining already does.
  const labelSelect = el('terminalLocationLabel');
  levelTouched = false;
  if (labelSelect) labelSelect.value = editing && TB.isAssignedTerminal(comp) ? TB.locationLabelMode(comp) : (form.key ? TB.blockLocationLabelMode(form.key) : TB.LOCATION_LABEL_AUTO);
  if (el('terminalLocationLabelBlock')) el('terminalLocationLabelBlock').checked = false;

  refreshForm();
  wireKeyboardOnce();
  el('terminalModal').style.display = 'flex';
  // Straight to what usually needs typing: the new block's name, else the position.
  const focusTarget = el('terminalBlockSelect').value === NEW_BLOCK ? newName : position;
  if (focusTarget) { focusTarget.focus(); if (focusTarget.select) focusTarget.select(); }
}

export function closeTerminalModal() {
  const modal = el('terminalModal');
  if (modal) modal.style.display = 'none';
  dialog = null;
}

// Enter confirms and Escape cancels — what makes placing a run of terminals quick.
function wireKeyboardOnce() {
  const modal = el('terminalModal');
  if (!modal || modal.dataset.keysWired === '1') return;
  modal.dataset.keysWired = '1';
  modal.addEventListener('keydown', (e) => {
    if (!dialog) return;
    if (e.key === 'Escape') { e.preventDefault(); closeTerminalModal(); }
    else if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); confirmTerminalModal(); }
  });
}

// ---- the form's own events ----

export function onTerminalBlockChange() { refreshForm({ fromBlockChange: true }); }
export function onTerminalNewBlockInput() { refreshForm({ fromBlockChange: true }); }
export function onTerminalPositionInput() { positionTouched = true; refreshForm({ fromPositionChange: true }); }
export function onTerminalLevelsChange() { refreshForm({ fromLevelsChange: true }); }
export function onTerminalLevelChange() { levelTouched = true; refreshForm(); }
export function onTerminalSideChange() { refreshForm(); }
export function onTerminalModelChange() {
  const select = el('terminalModelSelect');
  if (select && select.value === MANAGE_MODELS) {
    // Choosing "New / edit models…" opens the model manager; when it closes, the
    // model that was last worked on is the one chosen here.
    const before = lastModelChoice;
    select.value = before ?? '';
    if (typeof window.openTerminalModelsModal === 'function') {
      window.openTerminalModelsModal({ selectId: before, onClose: (id) => { populateModelSelect(id ?? before); lastModelChoice = el('terminalModelSelect')?.value || null; refreshForm({ fromModelChange: true }); } });
    }
    return;
  }
  lastModelChoice = select ? (select.value || null) : null;
  refreshForm({ fromModelChange: true });
}
export function onTerminalLocationLabelChange() { labelTouched = true; refreshForm(); }
export function onTerminalLocationChange() {
  const select = el('terminalLocationSelect');
  if (!select) return;
  const form = readForm();
  const block = form.isNew ? null : TB.findTerminalBlock(el('terminalBlockSelect')?.value || '');
  handleLocationSelectChange(select, select.dataset.prev || '', () => { select.dataset.prev = select.value; refreshForm(); }, { includeNone: true, noneLabel: locationNoneLabel(form.isNew, block) });
}

// ---- confirming ----

function describeConflict(conflict) {
  const sheetNum = getSchematicSheetNumber(conflict.sheetIndex) || conflict.sheetIndex + 1;
  const wires = (conflict.comp.wireIds || []).length ? ` (wire ${conflict.comp.wireIds.join(' / ')})` : '';
  return `a terminal on sheet ${sheetNum}${wires}`;
}

export async function confirmTerminalModal() {
  if (!dialog) return;
  const current = dialog;                         // the dialog may be closed while a question is being answered
  const form = readForm();
  const pro = !isFreePlan();

  const check = TB.validateTerminalAssignment({ blockName: form.blockName, position: form.position, kind: form.kind, levels: form.levels, level: form.level });
  if (!check.ok) {
    showError(check.errors.blockName || check.errors.position || check.errors.kind || check.errors.levels || check.errors.level);
    const bad = check.errors.blockName ? (form.isNew ? el('terminalNewBlockName') : el('terminalBlockSelect'))
      : check.errors.position ? el('terminalPosition')
      : check.errors.levels ? el('terminalLevelsSelect') : el('terminalLevel');
    if (bad) { bad.focus(); if (bad.select) bad.select(); }
    return;
  }

  const position = Number(form.position);
  const where = TB.blockDisplayName(form.blockName, form.currentLocationId);

  // A terminal cannot have fewer levels than are already drawn on it.
  const physical = TB.physicalTerminalAt(form.key, position, current.comp?.id);
  if (physical) {
    const highest = Math.max(...physical.usedLevels);
    if (highest > form.levels) {
      const model = TB.findTerminalModel(form.modelId);
      showError(`Level ${highest} of ${where}:${position} is already drawn, so it needs at least ${highest} levels.${model ? ` The model ${model.name} has ${model.levels}.` : ''}`);
      const bad = el('terminalLevelsSelect') && !el('terminalLevelsSelect').disabled ? el('terminalLevelsSelect') : el('terminalModelSelect');
      if (bad) bad.focus();
      return;
    }
  }

  // Moving a block to a location where a block of the same name already is would
  // merge the two — better said than done silently.
  if (pro && form.moving && TB.findTerminalBlock(TB.blockKey(form.blockName, form.locationId))) {
    await appAlert(`There is already a block called ${form.blockName} in ${locationText(form.locationId)}.\n\nMoving this one there would merge the two. Rename one of them first, or choose a different location.`);
    return;
  }

  const conflicts = TB.findSlotConflicts(form.key, position, form.level, current.comp?.id, conflictSide(form));
  if (conflicts.length) {
    const slot = form.levels > 1 ? `Position ${position} level ${form.level}` : `Position ${position}`;
    const proceed = await appConfirm(
      `${slot} on ${where} is already used by ${describeConflict(conflicts[0])}.\n\n` +
      `${current.mode === 'edit' ? 'Give this terminal the same position' : 'Place this one there as well'}? Only do that if it is the same physical terminal drawn again.`
    );
    if (!proceed) return;
  }

  // On the Free plan the label choice is greyed out and cannot be changed, so what it
  // holds is only what the terminal already had, or what its block does — which is
  // what a new terminal on that block should do too, so a strip looks consistent.
  const locationLabel = form.locationLabel;
  const assignment = { blockName: form.blockName, position, kind: form.kind, locationId: pro ? form.locationId : (form.isNew ? sheetLocationId() : form.currentLocationId), locationLabel, levels: form.levels, level: form.level, modelId: form.modelId, side: form.side };
  const movedKey = TB.blockKey(form.blockName, assignment.locationId);

  if (current.mode === 'edit' && current.comp) {
    pushHistory();
    if (pro && form.moving) TB.moveBlockToLocation(form.key, form.locationId);
    TB.applyTerminalAssignment(current.comp, current.sheet, assignment);
    scheduleAutosave();
  } else {
    placeTerminal(current.sheet, current.x, current.y, assignment);
    if (pro && form.moving) TB.moveBlockToLocation(form.key, form.locationId);
  }
  // Every symbol on a physical terminal has the same model and number of levels.
  TB.setPhysicalTerminalSpec(movedKey, position, { levels: form.levels, modelId: form.modelId });
  if (pro && form.labelBlockWide) TB.setBlockLocationLabel(movedKey, form.locationLabel);

  // The description: only written when it differs from what the block already has, so placing a terminal never wipes one.
  const baseline = TB.findTerminalBlock(form.key);
  const before = baseline ? (baseline.description || '') : '';
  if (form.description !== before) TB.amendTerminalBlock(movedKey, { description: form.description });

  lastChoice = { blockKey: movedKey, modelId: form.modelId };
  closeTerminalModal();
  renderComponents(openEditModal);
}

// "More details…" in the edit dialog: the usual component dialog, for the part
// number, make, description and fill colour.
export function openTerminalDetails() {
  const comp = dialog?.comp;
  closeTerminalModal();
  if (comp) openEditModal(comp, { force: true });
}

// For tests: forget what was last used.
export function resetTerminalDialogMemory() { lastChoice = { blockKey: null, modelId: null }; lastModelChoice = null; }

window.openTerminalModal = openTerminalModal;
