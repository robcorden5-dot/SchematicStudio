// ==========================================
// 32. SHEET TOOLS: DUPLICATE A SHEET, REVIEW STATE
// ==========================================
// Duplicate sheet copies a schematic sheet (parts, wires, texts, shapes, terminal links, connectors) and gives the copy its own
// designators, so a repeated motor starter or drive can be made in seconds:
//   - part designators take the new sheet's number (3K1 on sheet 3 becomes 4K1 on sheet 4) and move on to the next free number
//     if that designator is already used anywhere in the project;
//   - every component gets a new id, because a contact finds its coil by id across the whole project;
//   - numbered wire IDs are dropped and worked out again for the new sheet; names somebody typed are kept (and reported, since
//     two open ends with the same name are read as one wire continuing from sheet to sheet);
//   - terminals keep their place on the sheet but lose their block position, so nothing sits on a screw already in use;
//   - cable assignments are not copied (a cable belongs to the whole project), connectors are, with a new designator.
// It is a Pro feature, like the other ways of organising a project.
import { state, getSchematicSheetNumber, getPageType, pushHistory, scheduleAutosave, appAlert, appPrompt, sheetGroupsOn, cleanFunctionTag, getPrefixAndValue, todayStr, SHEET_REVIEW_STATES } from './1_config_state.js';
import { loadActiveSheet, renderTabs } from './5_portfolio_sheets.js';
import { isAssignedTerminal, isTerminal } from './11_terminal_blocks.js';

const MAX_COPIES = 20;

// ---- designators ----
function relabel(label, newNum, taken, counter = null) {
  const text = String(label ?? '').trim();
  if (!text) return label;
  const m = /^(\d*)(.*?)(\d+)$/.exec(text);
  if (m && m[2]) {                                   // 3K12, M4 ...
    const lead = m[1] !== '' ? String(newNum) : '';  // a designator typed without a sheet number stays without one
    let n = parseInt(m[3], 10);
    let out = `${lead}${m[2]}${n}`;
    while (taken.has(out)) { n += 1; out = `${lead}${m[2]}${n}`; if (counter) counter.bumped += 1; }
    return out;
  }
  const lead = /^\d+(.+)$/.exec(text);               // 1X: a terminal row, or a part with no number of its own
  return lead ? `${newNum}${lead[1]}` : text;
}

function nextFree(text, taken) {
  const m = /^(.*?)(\d+)$/.exec(String(text ?? ''));
  if (!m) return text;
  let n = parseInt(m[2], 10);
  let out = text;
  while (taken.has(out)) { n += 1; out = `${m[1]}${n}`; }
  return out;
}

function allLabels() {
  const set = new Set();
  state.sheets.forEach(s => (s.components || []).forEach(c => { if (c.label && !isTerminal(c)) set.add(String(c.label)); }));
  return set;
}
function allConnectorDesignators() {
  const set = new Set();
  state.sheets.forEach(s => (s.cableMarkers || []).forEach(m => { if (m.kind === 'connector' && m.designator) set.add(String(m.designator)); }));
  return set;
}
function allIds() {
  const set = new Set();
  state.sheets.forEach(s => (s.components || []).forEach(c => set.add(c.id)));
  return set;
}

let idCounter = 0;
function freshId(used) {
  let id;
  do { id = Date.now() * 1000 + (idCounter++ % 1000) + Math.floor(Math.random() * 1000); } while (used.has(id));
  used.add(id);
  return id;
}

// Builds one copy of `src` as the sheet that will be number `newNum`. `ctx` carries what is already taken, so several copies
// made in one go do not collide with each other. Returns { sheet, notes }.
export function cloneSheetForDuplicate(src, newNum, ctx) {
  const copy = JSON.parse(JSON.stringify(src));
  const notes = { keptNames: new Set(), droppedCables: 0, unassignedTerminals: 0, cutLinks: 0, bumped: 0 };

  // ---- the sheet itself ----
  const base = String(src.title || 'Untitled').replace(/ \(copy( \d+)?\)$/, '');
  copy.title = `${base} (copy${ctx.copyNo > 1 ? ' ' + ctx.copyNo : ''})`;
  copy.id = freshId(ctx.sheetIds);
  copy.createdDate = todayStr;
  copy.rev = '1.0';
  ['tabClosed', 'identificationNumber', 'review', 'note'].forEach(k => delete copy[k]);
  if (copy.iecFunction) copy.iecFunction = nextFree(cleanFunctionTag(copy.iecFunction), new Set(state.sheets.map(s => s.iecFunction).filter(Boolean)));

  // ---- components ----
  const idMap = new Map();
  (copy.components || []).forEach(c => idMap.set(c.id, freshId(ctx.compIds)));
  const oldLabelById = new Map((src.components || []).map(c => [c.id, c.label]));
  const newLabelById = new Map();

  (copy.components || []).forEach(c => {
    const oldId = c.id;
    c.id = idMap.get(oldId);
    const isChild = !!c.parentId;
    const parentInside = isChild && idMap.has(c.parentId);

    if (isTerminal(c)) {
      if (isAssignedTerminal(c)) {
        notes.unassignedTerminals += 1;
        delete c.position;
        delete c.blockDescription;
        c.label = `${newNum}X`;
      } else if (c.label) c.label = relabel(c.label, newNum, new Set());
    } else if (!parentInside) {
      if (isChild) {                                   // its coil is on another sheet: this part stands alone now
        c.parentId = null; c.contactNo = ''; c.isParent = false; c.labelX = undefined; c.labelY = undefined;
        notes.cutLinks += 1;
      }
      if (c.jointToId && !idMap.has(c.jointToId)) { c.jointToId = undefined; notes.cutLinks += 1; }
      if (c.linkContactId && !idMap.has(c.linkContactId)) c.linkContactId = undefined;
      let label = c.label;
      if (label) label = relabel(label, newNum, ctx.labels, notes);
      else if (isChild) label = relabel(`${getPrefixAndValue(c.type).prefix}1`, newNum, ctx.labels);
      c.label = label;
      if (label) ctx.labels.add(String(label));
    }
    newLabelById.set(oldId, c.label);
  });
  // Second pass: references that stay inside the copy follow the new ids, and a contact keeps showing its coil's number.
  (copy.components || []).forEach(c => {
    if (c.parentId && idMap.has(c.parentId)) {
      const oldParent = c.parentId;
      c.parentId = idMap.get(oldParent);
      if (c.label && c.label === oldLabelById.get(oldParent)) c.label = newLabelById.get(oldParent) ?? c.label;
    }
    if (c.jointToId && idMap.has(c.jointToId)) c.jointToId = idMap.get(c.jointToId);
    if (c.linkContactId && idMap.has(c.linkContactId)) c.linkContactId = idMap.get(c.linkContactId);
  });

  // ---- wires: numbered IDs are worked out again for the new sheet; typed names stay ----
  (copy.wires || []).forEach(w => {
    if (w.wireIdManual && w.wireId) notes.keptNames.add(String(w.wireId));
    else delete w.wireId;
  });

  // ---- terminal links follow the new terminal ids ----
  copy.terminalLinks = (copy.terminalLinks || []).filter(l => idMap.has(l.a) && idMap.has(l.b)).map(l => ({ ...l, a: idMap.get(l.a), b: idMap.get(l.b) }));
  if (!copy.terminalLinks.length) delete copy.terminalLinks;

  // ---- cable markers: connectors come along, cable assignments do not ----
  const markers = [];
  (copy.cableMarkers || []).forEach(m => {
    if (m.kind !== 'connector') { notes.droppedCables += 1; return; }
    if (m.designator) {
      m.designator = nextFree(m.designator, ctx.connectors);
      ctx.connectors.add(m.designator);
    }
    markers.push(m);
  });
  copy.cableMarkers = markers;

  return { sheet: copy, notes };
}

export function duplicateSheetCheck(idx) {
  const sheet = state.sheets[idx];
  if (!sheetGroupsOn()) return 'Duplicating a sheet is a Pro feature.';
  if (!sheet) return 'There is no such sheet.';
  if (getPageType(sheet) !== 'schematic') return 'Only schematic sheets can be duplicated. Title, Contents, Locations, BOM and Panel pages are made from the Add menu.';
  return '';
}

// Asks how many copies, then inserts them straight after the sheet. Returns the number made.
export async function duplicateSheet(idx = state.activeSheetIndex) {
  const problem = duplicateSheetCheck(idx);
  if (problem) { await appAlert(problem); return 0; }
  const src = state.sheets[idx];

  const answer = await appPrompt(`How many copies of "${src.title || 'this sheet'}" do you want? Each one gets its own sheet number and part designators.`, '1', 'Duplicate sheet');
  if (answer === null || answer === undefined) return 0;
  const count = Math.floor(Number(String(answer).trim()));
  if (!Number.isFinite(count) || count < 1 || count > MAX_COPIES) { await appAlert(`Enter a number of copies from 1 to ${MAX_COPIES}.`); return 0; }

  pushHistory();
  const numsBefore = new Map(state.sheets.map((s, i) => [s.id, getSchematicSheetNumber(i)]));
  const ctx = { labels: allLabels(), connectors: allConnectorDesignators(), compIds: allIds(), sheetIds: new Set(state.sheets.map(s => s.id)), copyNo: 1 };
  const totals = { keptNames: new Set(), droppedCables: 0, unassignedTerminals: 0, cutLinks: 0, bumped: 0 };
  let at = idx;
  for (let k = 1; k <= count; k++) {
    ctx.copyNo = k;
    const insertAt = at + 1;
    const newNum = state.sheets.slice(0, insertAt).filter(s => getPageType(s) === 'schematic').length + 1;
    const { sheet, notes } = cloneSheetForDuplicate(src, newNum, ctx);
    state.sheets.splice(insertAt, 0, sheet);
    at = insertAt;
    notes.keptNames.forEach(n => totals.keptNames.add(n));
    totals.droppedCables += notes.droppedCables;
    totals.unassignedTerminals += notes.unassignedTerminals;
    totals.cutLinks += notes.cutLinks;
    totals.bumped += notes.bumped;
  }
  if (typeof window.renumberSheetsFrom === 'function') window.renumberSheetsFrom(numsBefore);   // the sheets after the copies move up, designators and wire IDs with them
  state.activeSheetIndex = idx + 1;
  loadActiveSheet();
  scheduleAutosave();

  const lines = [];
  if (totals.keptNames.size) lines.push(`Wires you named keep their names (${[...totals.keptNames].slice(0, 8).join(', ')}${totals.keptNames.size > 8 ? ', …' : ''}). An open end with the same name on two sheets is read as one wire continuing, so rename any that should be separate.`);
  if (totals.droppedCables) lines.push(`${totals.droppedCables} cable assignment${totals.droppedCables === 1 ? ' was' : 's were'} not copied, because a cable belongs to the whole project. Assign cables to the copy from the Cable tool.`);
  if (totals.unassignedTerminals) lines.push(`${totals.unassignedTerminals} terminal${totals.unassignedTerminals === 1 ? '' : 's'} on the copy ${totals.unassignedTerminals === 1 ? 'has' : 'have'} no block position yet, so none sits on a screw that is already in use. Assign them from the terminal dialog.`);
  if (totals.cutLinks) lines.push(`${totals.cutLinks} part${totals.cutLinks === 1 ? ' was' : 's were'} linked to a coil on another sheet and ${totals.cutLinks === 1 ? 'is' : 'are'} now independent.`);
  if (totals.bumped) lines.push(`Some designators were numbered on to stay unique (2Q1 became 2Q2, say), because sheets after the copy still carry designators from before they moved down. Nothing on those sheets was changed.`);
  if (lines.length) await appAlert(`${count === 1 ? 'The copy is ready' : count + ' copies are ready'}.\n\n${lines.join('\n\n')}`, 'Sheet duplicated');
  return count;
}

// ---- review state ----
// Sets the review state of one sheet ('' clears it).
export function setSheetReview(idx, id) {
  const sheet = state.sheets[idx];
  if (!sheet || !sheetGroupsOn()) return;
  const wanted = SHEET_REVIEW_STATES.some(s => s.id === id) ? id : '';
  if ((sheet.review || '') === wanted) return;
  pushHistory();
  if (wanted) sheet.review = wanted; else delete sheet.review;
  const box = document.getElementById('sheetReviewSelect');
  if (box && idx === state.activeSheetIndex) box.value = wanted;
  renderTabs();
  scheduleAutosave();
}

window.duplicateSheet = duplicateSheet;
