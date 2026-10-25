// ==========================================
// 15. TERMINAL BLOCK MANAGER
// ==========================================
// Opened from the Terminal Blocks button on the Home ribbon. Lists every declared
// block (a designator, in a location) with what is on it, and lets a block be
// renamed, moved to another location, or told what its labels show - always the
// whole block, on every sheet, so it stays one block. Clicking a terminal goes to it.
// Locations and the label setting are Pro features, as in the terminal dialog;
// renaming and the description are not. The description is shown on a generated
// terminal table, under the block's designator. The rules live in 11_terminal_blocks.js (amendTerminalBlock).
//
// A generated terminal table is a snapshot, so it is not redrawn here - generate it
// again after changing a block.

import { state, isFreePlan, appConfirm, pushHistory, scheduleAutosave } from './1_config_state.js';
import { renderComponents } from './3_schematic_engine.js';
import { openEditModal, switchSheet, sheetTabLabel } from './5_portfolio_sheets.js';
import * as TB from './11_terminal_blocks.js';
import * as SIDES from './43_terminal_sides.js';

const el = (id) => document.getElementById(id);
let selectedKey = null;

function setMessage(text, kind) {
  const box = el('tbmMessage');
  if (!box) return;
  box.textContent = text || '';
  box.style.display = text ? 'block' : 'none';
  box.style.color = kind === 'error' ? '#f87171' : (kind === 'ok' ? '#4ade80' : '');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function populateBlockList() {
  const list = el('tbmList');
  if (!list) return;
  list.innerHTML = '';
  TB.listTerminalBlocks().forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.key;
    opt.textContent = `${b.displayName}${b.description ? ` (${b.description})` : ''}  —  ${plural(new Set(b.positions).size, 'terminal')}, position${b.positions.length === 1 ? '' : 's'} ${TB.formatPositionRanges(b.positions)}`;
    list.appendChild(opt);
  });
  list.value = selectedKey && TB.findTerminalBlock(selectedKey) ? selectedKey : '';
  const none = el('tbmEmpty');
  if (none) none.style.display = list.options.length ? 'none' : 'block';
  const form = el('tbmForm');
  if (form) form.style.display = list.options.length ? 'block' : 'none';
}

function populateLocations(block) {
  const select = el('tbmLocation');
  if (!select) return;
  select.innerHTML = '';
  // "None" is only offered to a block that has none already (it cannot be chosen
  // for one on a sheet that is in a location).
  if (!block || block.locationId === null) {
    const none = document.createElement('option');
    none.value = ''; none.textContent = '-- None --';
    select.appendChild(none);
  }
  state.locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = String(loc.id);
    opt.textContent = loc.description ? `${loc.abbreviation} — ${loc.description}` : loc.abbreviation;
    select.appendChild(opt);
  });
  select.value = block && block.locationId !== null ? String(block.locationId) : '';
}

function describeTerminal(row) {
  const parts = [`Position ${row.position}`];
  if (row.levels > 1) parts.push(`level ${row.level} of ${row.levels}`);
  if (row.pe) parts.push('PE');
  parts.push(row.side === TB.SIDE_EXTERNAL ? 'external' : 'internal');
  if (row.modelName) parts.push(row.modelName);
  return parts.join(' · ');
}

function fillForm() {
  const block = selectedKey ? TB.findTerminalBlock(selectedKey) : null;
  const pro = !isFreePlan();
  el('tbmName').value = block ? block.name : '';
  populateLocations(block);
  el('tbmLabelMode').value = block ? TB.blockLocationLabelMode(block.key) : TB.LOCATION_LABEL_AUTO;
  el('tbmLocation').disabled = !pro || !block;
  el('tbmLabelMode').disabled = !pro || !block;
  el('tbmName').disabled = !block;
  el('tbmDescription').value = block ? block.description : '';
  el('tbmDescription').disabled = !block;
  el('tbmSaveBtn').disabled = !block;
  el('tbmAutoBtn').disabled = !block;
  el('tbmAutoStart').disabled = !block;
  if (el('tbmPackBtn')) el('tbmPackBtn').disabled = !block;
  if (el('tbmResetSidesBtn')) el('tbmResetSidesBtn').disabled = !block;
  if (el('tbmArrangeBtn')) el('tbmArrangeBtn').disabled = !block;
  updatePackHint(block);
  el('tbmLocationHeading').textContent = pro ? 'Location' : 'Location (Pro)';
  el('tbmLabelModeHeading').textContent = pro ? 'Label shows' : 'Label shows (Pro)';

  const rows = el('tbmTerminals');
  rows.innerHTML = '';
  const described = block ? TB.describeBlockTerminals(block.key) : [];
  described.forEach(row => {
    const item = document.createElement('div');
    item.className = 'tbm-row';
    const main = document.createElement('div');
    main.className = 'tbm-row-main';
    main.textContent = describeTerminal(row);
    const sub = document.createElement('div');
    sub.className = 'tbm-row-sub';
    const wires = row.wireIds.length ? `Wire ${row.wireIds.join(', ')}` : 'No wire connected';
    sub.textContent = `${wires}  ·  ${sheetTabLabel(row.sheet, row.sheetIndex).replace(/^[^\w]*\s*/, '')}`;
    // Why it is on the side it is on: set by hand, or worked out (and from what).
    const why = document.createElement('div');
    why.className = 'tbm-row-sub';
    const sideWord = row.side === TB.SIDE_EXTERNAL ? 'External' : 'Internal';
    const an = row.sideSetting === TB.SIDE_AUTO ? SIDES.analyseSide(row.comp, row.sheet) : null;
    why.textContent = an && an.ends ? `Internal and external (automatic): ${an.reason}` : an ? `${sideWord} (automatic): ${an.reason}` : `${sideWord} (set by hand)`;
    item.appendChild(main); item.appendChild(sub); item.appendChild(why);
    item.title = 'Go to this terminal';
    item.onclick = () => goToTerminal(row);
    rows.appendChild(item);
  });
  const summary = el('tbmSummary');
  if (summary) summary.textContent = block
    ? `${plural(described.length, 'terminal symbol')} on ${plural(new Set(described.map(r => r.sheetIndex)).size, 'sheet')}. Changes apply to all of them.`
    : '';
  const unassigned = TB.countUnassignedTerminals();
  const note = el('tbmUnassigned');
  if (note) {
    note.style.display = unassigned ? 'block' : 'none';
    note.textContent = unassigned ? `${plural(unassigned, 'terminal')} in this project ${unassigned === 1 ? 'is' : 'are'} not assigned to a block yet. Double-click one on its sheet to assign it.` : '';
  }
}

// Says, before anything is pressed, how much packing would save on the chosen block.
function updatePackHint(block) {
  const hint = el('tbmPackHint');
  if (!hint) return;
  const plan = block ? SIDES.planPack(block.key) : null;
  if (!plan || !plan.ok) { hint.textContent = ''; return; }
  hint.textContent = plan.pairs > 0
    ? `Packing would pair ${plural(plan.pairs, 'internal/external connection')} and use ${plural(plan.after, 'terminal')} instead of ${plan.before}.`
    : 'Nothing (more) to pair on this block: no net has an internal and an external connection on separate terminals. Set a terminal\u2019s Side (double-click it), or give the blocks locations so it can be worked out.';
}

function goToTerminal(row) {
  closeTerminalBlockManager();
  switchSheet(row.sheetIndex);
  state.selectedComponentId = row.comp.id;
  renderComponents(openEditModal);
}

export function openTerminalBlockManager() {
  TB.refreshAllTerminalWireIds();
  const first = TB.listTerminalBlocks()[0];
  selectedKey = first ? first.key : null;
  populateBlockList();
  fillForm();
  setMessage('');
  wireKeyboardOnce();
  el('terminalBlockManagerModal').style.display = 'flex';
  const focus = el('tbmList'); if (focus && focus.focus) focus.focus();
}

export function closeTerminalBlockManager() {
  const modal = el('terminalBlockManagerModal');
  if (modal) modal.style.display = 'none';
}

function wireKeyboardOnce() {
  const modal = el('terminalBlockManagerModal');
  if (!modal || modal.dataset.keysWired === '1') return;
  modal.dataset.keysWired = '1';
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeTerminalBlockManager(); }
    else if (e.key === 'Enter' && e.target?.tagName === 'INPUT') { e.preventDefault(); saveTerminalBlockChanges(); }
  });
}

export function onTerminalBlockManagerPick() {
  selectedKey = el('tbmList').value || null;
  fillForm();
  setMessage('');
}

export function saveTerminalBlockChanges() {
  if (!selectedKey) return;
  const block = TB.findTerminalBlock(selectedKey);
  if (!block) return;
  const pro = !isFreePlan();
  const fields = { name: el('tbmName').value, description: el('tbmDescription').value };
  if (pro) {
    fields.locationId = el('tbmLocation').value;
    fields.labelMode = el('tbmLabelMode').value;
  }
  const unchanged = fields.name.trim() === block.name
    && fields.description.replace(/\s+/g, ' ').trim() === block.description
    && (!pro || (fields.locationId === (block.locationId === null ? '' : String(block.locationId)) && fields.labelMode === TB.blockLocationLabelMode(block.key)));
  if (unchanged) { setMessage('Nothing has changed.'); return; }

  pushHistory();
  const result = TB.amendTerminalBlock(selectedKey, fields);
  if (!result.ok) {
    setMessage(result.errors.name || result.errors.description || result.errors.locationId || result.errors.labelMode || 'The block could not be changed.', 'error');
    return;   // nothing was changed, so the undo step just pushed is harmless
  }
  selectedKey = result.newKey;
  populateBlockList();
  fillForm();
  setMessage(`Updated ${plural(result.count, 'terminal symbol')}. A generated terminal table is a snapshot, so generate it again to show the change.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// Gives the block's positions out in ascending order of the wire ID on each terminal.
export async function autoPositionSelectedBlock() {
  if (!selectedKey) return;
  const plan = TB.planAutoPosition(selectedKey, { start: el('tbmAutoStart').value || 1, descending: el('tbmOrder') && el('tbmOrder').value === 'desc' });
  if (!plan.ok) { setMessage(plan.error, 'error'); return; }
  if (plan.changed === 0) { setMessage('The positions are already in wire ID order.'); return; }

  const name = plan.block.displayName;
  const preview = plan.moves.slice(0, 8).map(m => `${m.wire || 'no wire'} \u2192 position ${m.to}`).join('\n') + (plan.moves.length > 8 ? `\n\u2026 and ${plan.moves.length - 8} more` : '');
  const proceed = await appConfirm(
    `Renumber ${plural(plan.moves.length, 'terminal position')} on ${name} in ${el('tbmOrder') && el('tbmOrder').value === 'desc' ? 'descending' : 'ascending'} wire ID order?\n\n${preview}` +
    (plan.unwired ? `\n\n${plural(plan.unwired, 'terminal')} with no wire connected will come after the others, in their current order.` : '') +
    '\n\nYou can Undo (Ctrl+Z) afterwards.',
    'Auto-position'
  );
  if (!proceed) return;

  pushHistory();
  const done = TB.autoPositionBlock(selectedKey, { start: el('tbmAutoStart').value || 1, descending: el('tbmOrder') && el('tbmOrder').value === 'desc' });
  if (!done.ok) { setMessage(done.error, 'error'); return; }
  populateBlockList();
  fillForm();
  setMessage(`Renumbered ${name}: ${plural(done.changed, 'position')} changed. A generated terminal table is a snapshot, so generate it again to show the change.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// Pairs up internal and external connections of the same net on the selected block, and closes up the strip.
export async function packSelectedBlock() {
  if (!selectedKey) return;
  const plan = SIDES.planPack(selectedKey);
  if (!plan.ok) { setMessage(plan.error, 'error'); return; }
  if (plan.moves.length === 0) { setMessage('Nothing to pack: this block already uses each terminal for one internal and one external connection where it can, with no gaps.'); return; }
  const name = plan.block.displayName;
  const lines = SIDES.describePlan(plan);
  const proceed = await appConfirm(
    `Pack ${name}?\n\n${plural(plan.before, 'terminal')} now \u2192 ${plural(plan.after, 'terminal')} (${plan.saved > 0 ? `${plural(plan.saved, 'terminal')} saved` : 'none saved'}).` +
    (lines.length ? `\n\n${lines.join('\n')}` : '') +
    `\n\n${plural(plan.changed, 'terminal symbol')} will move to another position. Positions are closed up and renumbered from ${plan.start}.\n\nYou can Undo (Ctrl+Z) afterwards.`,
    'Pack connections'
  );
  if (!proceed) return;
  pushHistory();
  const done = SIDES.applyPack(plan);
  populateBlockList(); fillForm();
  setMessage(`Packed ${name}: ${plural(done.after, 'terminal')} (was ${done.before}). A generated terminal table is a snapshot, so generate it again to show the change.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// The same for every block in the project.
export async function packEveryBlock() {
  const all = SIDES.planPackAll();
  const work = all.plans.filter(p => p.moves.length);
  if (!work.length) { setMessage('Nothing to pack: no block has an internal and an external connection of the same net on separate terminals.'); return; }
  const lines = work.slice(0, 8).map(p => `${p.block.displayName}: ${p.before} \u2192 ${p.after} terminals`);
  if (work.length > 8) lines.push(`\u2026 and ${work.length - 8} more block${work.length - 8 === 1 ? '' : 's'}`);
  const proceed = await appConfirm(
    `Pack ${plural(work.length, 'block')}?\n\n${plural(all.before, 'terminal')} now \u2192 ${plural(all.after, 'terminal')} (${all.saved > 0 ? `${plural(all.saved, 'terminal')} saved` : 'none saved'}).\n\n${lines.join('\n')}\n\nPositions are closed up and renumbered on each. You can Undo (Ctrl+Z) afterwards.`,
    'Pack all blocks'
  );
  if (!proceed) return;
  pushHistory();
  work.forEach(SIDES.applyPack);
  populateBlockList(); fillForm();
  setMessage(`Packed ${plural(work.length, 'block')}: ${plural(all.after, 'terminal')} (was ${all.before}). A generated terminal table is a snapshot, so generate it again to show the change.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// Takes every terminal of the selected block off "set by hand" so each one follows the automatic rule again (packing and the
// terminal dialog fix a Side; this undoes that).
export async function resetBlockSides() {
  if (!selectedKey) return;
  const block = TB.findTerminalBlock(selectedKey);
  if (!block) return;
  const hand = block.terminals.filter(t => TB.terminalSideSetting(t.comp) !== TB.SIDE_AUTO);
  if (!hand.length) { setMessage('Every terminal in this block is already on Automatic.'); return; }
  const proceed = await appConfirm(`Set ${plural(hand.length, 'terminal')} in ${block.displayName} back to Automatic?\n\nEach one will then take its side from its wire (location, boundary or cable). You can Undo (Ctrl+Z) afterwards.`, 'Sides to Automatic');
  if (!proceed) return;
  pushHistory();
  hand.forEach(t => TB.setTerminalSide(t.comp, TB.SIDE_AUTO));
  populateBlockList(); fillForm();
  setMessage(`${block.displayName}: ${plural(hand.length, 'terminal')} set back to Automatic.`, 'ok');
  scheduleAutosave();
  renderComponents(openEditModal);
}

// One button for a block that has had its terminals placed and assigned: sides back to Automatic, the connections of each net
// paired internal / external and the gaps closed, then the positions numbered by wire ID (ascending or descending). One preview,
// one Undo.
export async function arrangeSelectedBlock() {
  if (!selectedKey) return;
  const descending = el('tbmOrder') && el('tbmOrder').value === 'desc';
  const start = el('tbmAutoStart') ? (el('tbmAutoStart').value || 1) : 1;
  const block = TB.findTerminalBlock(selectedKey);
  if (!block) return;
  const saved = block.terminals.map(t => ({ comp: t.comp, side: TB.terminalSideSetting(t.comp) === TB.SIDE_AUTO ? null : t.comp.side }));
  const restore = () => saved.forEach(r => TB.setTerminalSide(r.comp, r.side || TB.SIDE_AUTO));
  const handSet = saved.filter(r => r.side).length;
  // preview with the sides as Automatic, then put them back until it is confirmed
  saved.forEach(r => TB.setTerminalSide(r.comp, TB.SIDE_AUTO));
  const plan = SIDES.planPack(selectedKey);
  let before = 0, after = 0;
  if (plan.ok) { before = plan.before; after = plan.after; }
  restore();
  if (!plan.ok) { setMessage(plan.error, 'error'); return; }
  const name = plan.block.displayName;
  const lines = SIDES.describePlan(plan);
  const proceed = await appConfirm(
    `Arrange ${name}?\n\n` +
    `1. Sides: ${handSet ? `${plural(handSet, 'terminal')} set by hand go back to Automatic` : 'all terminals already on Automatic'}.\n` +
    `2. Pair each net's internal and external connections on one terminal, and close the gaps: ${plural(before, 'terminal')} \u2192 ${plural(after, 'terminal')}.\n` +
    `3. Number the positions by wire ID, ${descending ? 'descending' : 'ascending'}, from ${start}.` +
    (lines.length ? `\n\n${lines.join('\n')}` : '') +
    '\n\nYou can Undo (Ctrl+Z) afterwards.',
    'Arrange block'
  );
  if (!proceed) return;
  pushHistory();
  saved.forEach(r => TB.setTerminalSide(r.comp, TB.SIDE_AUTO));
  SIDES.applyPack(SIDES.planPack(selectedKey));
  const done = TB.autoPositionBlock(selectedKey, { start, descending });
  if (done && done.ok === false) setMessage(done.error, 'error');
  else setMessage(`Arranged ${name}: ${plural(after, 'terminal')} (was ${before}), numbered by wire ID ${descending ? 'descending' : 'ascending'}. Terminal tables made with the new generator have updated.`, 'ok');
  populateBlockList(); fillForm();
  if (typeof window.refreshTerminalTables === 'function') window.refreshTerminalTables();
  scheduleAutosave();
  renderComponents(openEditModal);
}

window.openTerminalBlockManager = openTerminalBlockManager;
