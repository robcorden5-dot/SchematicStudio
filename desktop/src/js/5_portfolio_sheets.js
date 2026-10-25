// ==========================================
// 5. SHEET & PORTFOLIO MANAGEMENT
// ==========================================
import { plcChannels, plcFunctionFor, cleanPlcFns, PLC_FUNCTION_SUGGESTIONS, PLC_LIMITS } from './16_plc_modules.js';
import { driveChannels, driveFunctionFor, cleanDriveFns, DRIVE_FUNCTION_SUGGESTIONS, DRIVE_LIMITS } from './35_drive_modules.js';
import { cleanSectionPath, cleanSectionName, cleanSectionList, sectionDepth, sectionParent, sectionLeaf, inSection, SECTION_MAX_DEPTH, symbolsForSave, state, todayStr, snapToGrid, getActiveSheet, pushHistory, scheduleAutosave, clearHistory, getPrefixAndValue, nextLabelForType, SHEET_CONFIGS, saveTextFile, getRefText, getGridLocation, getPageType, getSchematicSheetNumber, getTotalSchematicSheets, getBOMPageNumber, getTotalBOMPages, getPlcIoPageNumber, getTotalPlcIoPages, appAlert, appConfirm, repairSymbolLibrary, findLocationById, isFreePlan, sheetGroupsOn, sheetGroupOf, sheetReviewOf, sheetFunctionOf, cleanFunctionTag, cleanWirePrefix } from './1_config_state.js';
import { stage, wirePreviewLayer, borderLayer } from './2_main_stage.js';
import { applySymbolDragImage } from './9_symbol_thumbnails.js';
import { childContactKind, contactSetsOf, choiceValue, splitChoice, childFieldsFor, hasStandardContactPins, ownsPartDetails, isValveBody, suggestValveSolenoids, contactUsage, syncChildContacts, suggestTerminals, suggestPushButtonTerminals, isPushButtonParent, termsFor, newContactId, newAuxId, kindText } from './39_contact_sets.js';
import { renderSheetBorder, renderComponents, snapComponentIntoWires, clearWireState, baselineWireAudit, logWireOp, syncJunctionControls } from './3_schematic_engine.js';
import { renderCustomSymbolsList } from './4_symbol_studio.js';
import { cleanRevisionList } from './23_revision_data.js';
import { cleanProjectInfo, cleanTitleBlockSettings, titleBlockValues, buildDocNumber, PROJECT_INFO_MAX, DOC_TYPE_SUGGESTIONS, DOC_STATUS_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from './25_title_block.js';

let editingComponent = null;
let editingWire = null;
let editingTextBox = null;
let pendingNewTextPos = null;

export function loadActiveSheet() {
  const sheet = getActiveSheet();
  if (!sheet) return;

  // A wire still being drawn was started on whichever sheet was showing
  // before — its points mean nothing on this one, so drop it.
  clearWireState(false);
  logWireOp('sheet-loaded', { sheetIndex: state.activeSheetIndex });
  baselineWireAudit(sheet); // wires that were already diagonal when the sheet loaded aren't new news

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setVal('sizeSelect', sheet.size);
  setVal('orientationSelect', sheet.orientation);
  setVal('lineColumnsSelect', String(sheet.lineColumns === 2 ? 2 : 1));
  setVal('titleInput', sheet.title);
  setVal('descInput', sheet.description);
  setVal('authorInput', sheet.author);
  setVal('approvedInput', sheet.approvedBy);
  setVal('createdInput', sheet.createdDate);
  setVal('locationInput', sheet.location);
  populateLocationDropdown('iecLocationSelect', sheet.iecLocation || '', { includeNone: true, noneLabel: '-- None --' });
  setVal('customerInput', sheet.customer);
  setVal('idNumberInput', sheet.identificationNumber);
  setVal('docTypeInput', sheet.docType);
  setVal('docStatusInput', sheet.docStatus);
  setVal('languageInput', sheet.language);
  setVal('sheetWirePrefixInput', sheet.wirePrefix);
  setVal('sheetFunctionInput', sheet.iecFunction);
  setVal('sheetReviewSelect', sheet.review);
  setVal('sheetNoteInput', sheet.note);
  syncDocNumberHint(sheet);

  // The sheet being worked on always has a tab, even if its tab had been closed
  // (it was reached from the Portfolio view, a link, or after a delete).
  if (sheet.tabClosed) delete sheet.tabClosed;

  renderSheetBorder(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets());
  renderComponents(openEditModal);
  renderTabs();
}

// ---- which sheets have a tab ----
// Every sheet stays in the project (numbering, Contents and the BOM all still see
// it); a closed tab only hides it from the tab bar. The Portfolio view lists them all.
export const isSheetTabOpen = (sheet) => !sheet.tabClosed;

export function sheetTabLabel(sheet, idx) {
  const pageType = getPageType(sheet);
  if (pageType === 'title') return `\u{1F4C4} ${sheet.title || 'Title Page'}`;
  if (pageType === 'contents') return `\u{1F4D1} ${sheet.title || 'Contents'}`;
  if (pageType === 'locations') return `\u{1F4CD} ${sheet.title || 'Locations'}`;
  if (pageType === 'cables') return `\u{1F50C} ${sheet.title || 'Cable diagram'}`;
  if (pageType === 'panel') return `\u{1F5C4}\uFE0F ${sheet.title || 'Panel Layout'}`;
  if (pageType === 'plcio') {
    const n = getPlcIoPageNumber(idx), t = getTotalPlcIoPages();
    return `\u{1F5A5}\uFE0F ${sheet.title || 'PLC I/O Schedule'}${t > 1 ? ` (${n}/${t})` : ''}`;
  }
  if (pageType === 'bom') {
    const bomNum = getBOMPageNumber(idx), bomTotal = getTotalBOMPages();
    const suffix = bomTotal > 1 ? ` (${bomNum}/${bomTotal})` : '';
    return `\u{1F4CB} ${sheet.title || 'Bill of Materials'}${suffix}`;
  }
  const fn = sheetFunctionOf(sheet);
  return `${getSchematicSheetNumber(idx)}. ${fn ? fn + ' ' : ''}${sheet.title || 'Untitled'}`;
}

export function openSheetTab(idx) {
  const sheet = state.sheets[idx];
  if (!sheet || !sheet.tabClosed) return;
  delete sheet.tabClosed;
  renderTabs();
  scheduleAutosave();
}

// Closing the tab you are on moves to the nearest tab still open (the next one,
// else the one before). The last open tab cannot be closed.
export function closeSheetTab(idx) {
  const sheet = state.sheets[idx];
  if (!sheet || sheet.tabClosed) return false;
  const open = state.sheets.map((s, i) => i).filter(i => !state.sheets[i].tabClosed);
  if (open.length <= 1) return false;
  if (idx === state.activeSheetIndex) {
    const next = open.find(i => i > idx) ?? open.slice().reverse().find(i => i < idx);
    sheet.tabClosed = true;
    switchSheet(next);          // loads it, and redraws the tabs
  } else {
    sheet.tabClosed = true;
    renderTabs();
  }
  scheduleAutosave();
  return true;
}

// Open or close many tabs at once; `wanted(sheet, idx)` says which should be open.
// The sheet being worked on always stays open.
export function setSheetTabs(wanted) {
  state.sheets.forEach((sheet, idx) => {
    if (idx === state.activeSheetIndex || wanted(sheet, idx)) delete sheet.tabClosed;
    else sheet.tabClosed = true;
  });
  renderTabs();
  scheduleAutosave();
}

// ---- reordering sheets by dragging ----
// Moves the sheet at `from` so it sits before (`after` false) or after the sheet at `to`.
// Everything that shows a sheet number (labels, Contents, cross-references) is worked out
// from the order on every render, so the numbers follow on their own.
// What number each schematic sheet has now, so that after the order changes everything numbered from it can follow.
const sheetNumbers = () => new Map(state.sheets.map((s, i) => [s.id, getSchematicSheetNumber(i)]));
const renumberAfter = (before) => { if (typeof window.renumberSheetsFrom === 'function') window.renumberSheetsFrom(before); };

export function moveSheet(from, to, after) {
  const n = state.sheets.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
  let at = to + (after ? 1 : 0);
  if (from < at) at -= 1;
  if (at === from) return false;
  pushHistory();
  const activeId = state.sheets[state.activeSheetIndex]?.id;
  const before = sheetNumbers();
  const target = state.sheets[to];
  const [moved] = state.sheets.splice(from, 1);
  state.sheets.splice(at, 0, moved);
  // Dropping a sheet among another section's sheets puts it in that section (so every section stays in one run).
  if (sheetGroupsOn() && target && sheetGroupOf(target) !== sheetGroupOf(moved)) { if (sheetGroupOf(target)) moved.group = sheetGroupOf(target); else delete moved.group; }
  renumberAfter(before);   // designators and wire IDs take the sheets' new numbers
  const ni = state.sheets.findIndex(x => x.id === activeId);
  state.activeSheetIndex = ni < 0 ? 0 : ni;
  loadActiveSheet();     // redraws the sheet and the tabs so numbering is fresh
  scheduleAutosave();
  return true;
}

let dragFrom = null;
// Makes `node` draggable and a drop target. axis 'x' for the tab bar, 'y' for a list.
export function makeSheetDraggable(node, idx, axis = 'x', onMoved = null) {
  const half = (e) => { const r = node.getBoundingClientRect(); return axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2; };
  const clear = () => node.classList.remove('drop-before', 'drop-after');
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    dragFrom = idx;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* some browsers refuse */ }
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => { dragFrom = null; node.classList.remove('dragging'); document.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
  node.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const a = half(e); node.classList.toggle('drop-after', a); node.classList.toggle('drop-before', !a);
  });
  node.addEventListener('dragleave', clear);
  node.addEventListener('drop', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const from = dragFrom, after = half(e); dragFrom = null; clear();
    if (moveSheet(from, idx, after) && onMoved) onMoved();
  });
}

// ---- sheet groups ----
// A sheet can belong to a named group (Power, Control, PLC I/O ...). Groups are kept together in the sheet order, so
// the tab bar, Contents page and Portfolio view all show them as runs. Collapsing a group simply closes its tabs
// (the same thing the Portfolio tick-boxes do), so nothing new has to be saved for it.
export function sheetGroupNames() {
  const names = [];
  state.sheets.forEach(s => { const g = sheetGroupOf(s); if (g && !names.includes(g)) names.push(g); });
  return names;
}

// ---- sections: the portfolio tree ----
// A sheet's `group` is the path of its section ('Power' or 'Power/Motors'). A section's sheets (and its subsections')
// always sit together in the sheet order, so the tree is just the order read top to bottom. Empty sections are kept in
// state.sections. Moving anything here moves sheets, so numbering, designators and wire IDs follow the new order.
export const draggedSheetIndex = () => dragFrom;

// Every section path in use (sheets and empty sections), with each parent, in the order they first appear.
export function sectionPaths() {
  const out = [];
  const add = (path) => {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); if (!out.includes(p)) out.push(p); }
  };
  state.sheets.forEach(s => { const g = sheetGroupOf(s); if (g) add(g); });
  (state.sections || []).forEach(add);
  return out;
}
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
const sectionExists = (path) => sectionPaths().some(p => samePath(p, path));

// Where a block of sheets goes when it has no sheets of its own to sit beside: after the last schematic sheet.
function lastSchematicAnchor(exclude) {
  const list = state.sheets.filter(s => !exclude.has(s) && getPageType(s) === 'schematic');
  return list.length ? list[list.length - 1] : null;
}

// Moves `moving` (sheets, in their present order) so they sit together straight after `anchor` (or at the end when
// there is no anchor), then renumbers and redraws. Returns true when the order actually changed.
function placeSheetsAfter(moving, anchor) {
  const set = new Set(moving);
  const before = state.sheets.slice();
  const numsBefore = sheetNumbers();
  const activeId = state.sheets[state.activeSheetIndex]?.id;
  const rest = state.sheets.filter(s => !set.has(s));
  const at = anchor ? rest.indexOf(anchor) + 1 : rest.length;
  const block = state.sheets.filter(s => set.has(s));
  state.sheets = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (!state.sheets.some((s, i) => s !== before[i])) return false;
  renumberAfter(numsBefore);
  const ni = state.sheets.findIndex(x => x.id === activeId);
  state.activeSheetIndex = ni < 0 ? 0 : ni;
  return true;
}

// Brings every sheet of a section together (after its first one) if something left them scattered.
function gatherSection(path) {
  const members = state.sheets.filter(s => inSection(sheetGroupOf(s), path));
  if (members.length < 2) return false;
  const first = state.sheets.indexOf(members[0]), last = state.sheets.indexOf(members[members.length - 1]);
  if (last - first + 1 === members.length) return false;
  return placeSheetsAfter(members.slice(1), members[0]);
}

// Where a section's sheets belong: after the last sheet already in it, else after its parent's last, else the end.
function sectionAnchor(path, exclude) {
  for (let p = path; p; p = sectionParent(p)) {
    const own = state.sheets.filter(s => !exclude.has(s) && inSection(sheetGroupOf(s), p));
    if (own.length) return own[own.length - 1];
  }
  return lastSchematicAnchor(exclude);
}

function finishSectionChange(reordered) {
  if (reordered) loadActiveSheet(); else renderTabs();   // the numbering and Contents follow a new order
  scheduleAutosave();
}

// Gives a sheet to a section ('' to take it out). The sheet moves to sit with the others in that section.
export function setSheetGroup(idx, name) {
  const sheet = state.sheets[idx];
  if (!sheet || !sheetGroupsOn()) return;
  const clean = cleanSectionPath(name);
  if ((sheet.group || '') === clean) return;
  pushHistory();
  if (clean) sheet.group = clean; else delete sheet.group;
  let reordered = false;
  if (clean) {
    const set = new Set([sheet]);
    const hasOthers = state.sheets.some(s => s !== sheet && inSection(sheetGroupOf(s), clean)) || sectionParent(clean) && state.sheets.some(s => s !== sheet && inSection(sheetGroupOf(s), sectionParent(clean)));
    if (hasOthers) reordered = placeSheetsAfter([sheet], sectionAnchor(clean, set));
    gatherSection(clean);
  }
  finishSectionChange(reordered);
}

// Makes a new, empty section inside `parent` ('' for the top level). Returns '' or the reason it could not be made.
export function addSection(parent, name) {
  const leaf = cleanSectionName(name);
  if (!leaf) return 'Give the section a name.';
  const path = parent ? `${parent}/${leaf}` : leaf;
  if (sectionDepth(path) > SECTION_MAX_DEPTH) return `Sections can only go ${SECTION_MAX_DEPTH} levels deep.`;
  if (sectionExists(path)) return `There is already a section called "${leaf}" there.`;
  pushHistory();
  state.sections = [...(state.sections || []), path];
  finishSectionChange(false);
  return '';
}

// Rewrites a section path (and everything inside it) from `from` to `to` on every sheet and empty section.
function rewriteSectionPaths(from, to) {
  const swap = (p) => inSection(p, from) ? to + p.slice(from.length) : p;
  state.sheets.forEach(s => { if (typeof s.group === 'string' && inSection(s.group, from)) s.group = swap(s.group); });
  state.sections = [...new Set((state.sections || []).map(swap))];
}

export function renameSection(path, name) {
  const leaf = cleanSectionName(name);
  if (!leaf) return 'Give the section a name.';
  const to = sectionParent(path) ? `${sectionParent(path)}/${leaf}` : leaf;
  if (to === path) return '';
  if (sectionPaths().some(p => samePath(p, to) && !samePath(p, path))) return `There is already a section called "${leaf}" there.`;
  pushHistory();
  rewriteSectionPaths(path, to);
  finishSectionChange(false);
  return '';
}

// Deletes a section but keeps what is in it: its sheets and subsections move up one level.
export function deleteSection(path) {
  pushHistory();
  const parent = sectionParent(path);
  const lift = (p) => p === path ? parent : (inSection(p, path) ? (parent ? parent + '/' : '') + p.slice(path.length + 1) : p);
  const touched = new Set();
  state.sheets.forEach(s => {
    if (typeof s.group !== 'string' || !inSection(s.group, path)) return;
    const g = lift(s.group);
    if (g) { s.group = g; touched.add(g); } else delete s.group;
  });
  state.sections = [...new Set((state.sections || []).filter(p => p !== path).map(lift).filter(Boolean))];
  let reordered = false;
  touched.forEach(g => { if (gatherSection(g)) reordered = true; });
  finishSectionChange(reordered);
}

// Moves a whole section (with its sheets and subsections) inside `newParent` ('' for the top level).
export function moveSection(path, newParent) {
  const leaf = sectionLeaf(path);
  const to = newParent ? `${newParent}/${leaf}` : leaf;
  if (to === path) return '';
  if (newParent && inSection(newParent, path)) return 'A section cannot go inside itself.';
  const deepest = Math.max(sectionDepth(path), ...sectionPaths().filter(p => inSection(p, path)).map(sectionDepth));
  if (sectionDepth(to) + (deepest - sectionDepth(path)) > SECTION_MAX_DEPTH) return `Sections can only go ${SECTION_MAX_DEPTH} levels deep.`;
  if (sectionPaths().some(p => samePath(p, to))) return `There is already a section called "${leaf}" in there.`;
  pushHistory();
  const members = state.sheets.filter(s => inSection(sheetGroupOf(s), path));
  rewriteSectionPaths(path, to);
  let reordered = false;
  if (members.length) reordered = placeSheetsAfter(members, sectionAnchor(newParent, new Set(members)));
  finishSectionChange(reordered);
  return '';
}

// Shows or hides the tabs of the run of sheets in one group.
export function toggleGroupTabs(members) {
  const set = new Set(members);
  const anyOpen = members.some(i => isSheetTabOpen(state.sheets[i]) && i !== state.activeSheetIndex);
  setSheetTabs((s, i) => set.has(i) ? !anyOpen : isSheetTabOpen(s));
}

function groupColour(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

// Right-click a tab: add a sheet after it, duplicate it or delete it, without a trip to the Portfolio view.
function showSheetTabMenu(x, y, idx) {
  document.getElementById('sheetTabMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'sheetTabMenu';
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:100000; background:var(--bg-panel, #fff); color:var(--text, #111); border:1px solid var(--border-light, #cbd5e1); border-radius:6px; box-shadow:0 6px 20px rgba(0,0,0,.2); padding:4px; min-width:190px; font-size:13px;`;
  const add = (text, fn, disabled) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.disabled = !!disabled;
    b.style.cssText = 'display:block; width:100%; text-align:left; padding:6px 10px; background:none; border:0; border-radius:4px; cursor:pointer; color:inherit; font:inherit;' + (disabled ? 'opacity:.45; cursor:default;' : '');
    if (!disabled) { b.onmouseenter = () => { b.style.background = 'var(--bg-hover, rgba(100,116,139,.15))'; }; b.onmouseleave = () => { b.style.background = 'none'; }; }
    b.onclick = () => { menu.remove(); fn(); };
    menu.appendChild(b);
  };
  const isSchem = getPageType(state.sheets[idx]) === 'schematic';
  add('Add a sheet after this one', () => { if (state.activeSheetIndex !== idx) switchSheet(idx); addSheet(); }, !isSchem);
  add('Duplicate this sheet\u2026', () => { if (typeof window.duplicateSheet === 'function') window.duplicateSheet(idx); }, !isSchem || typeof window.duplicateSheet !== 'function');
  add('Delete this sheet\u2026', () => removeSheet(idx), state.sheets.length <= 1);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - r.width - 6) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - r.height - 6) + 'px';
  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

export function renderTabs() {
  const tabsContainer = document.getElementById('tabs-list');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const openCount = state.sheets.filter(isSheetTabOpen).length;
  let activeTab = null;
  let previousGroup = '';

  state.sheets.forEach((sheet, idx) => {
    const group = sheetGroupOf(sheet);
    if (group !== previousGroup) {
      previousGroup = group;
      if (group) {
        // A chip for the group, placed where its run of sheets starts (even if every tab in it is closed).
        const members = [];
        for (let i = idx; i < state.sheets.length && sheetGroupOf(state.sheets[i]) === group; i++) members.push(i);
        const shown = members.some(i => isSheetTabOpen(state.sheets[i]) || i === state.activeSheetIndex);
        const chip = document.createElement('div');
        chip.className = 'tab-group';
        chip.style.setProperty('--group-colour', groupColour(group));
        chip.textContent = `${shown ? '\u25BE' : '\u25B8'} ${group.replace(/\//g, ' \u203A ')}${shown ? '' : ` (${members.length})`}`;
        chip.title = shown ? `Hide the tabs in "${group}"` : `Show the ${members.length} tab${members.length === 1 ? '' : 's'} in "${group}"`;
        chip.onclick = () => toggleGroupTabs(members);
        tabsContainer.appendChild(chip);
      }
    }
    if (!isSheetTabOpen(sheet) && idx !== state.activeSheetIndex) return;
    const tab = document.createElement('div');
    tab.className = `tab ${idx === state.activeSheetIndex ? 'active' : ''}`;
    tab.onclick = () => switchSheet(idx);
    tab.oncontextmenu = (e) => { e.preventDefault(); showSheetTabMenu(e.clientX, e.clientY, idx); };
    makeSheetDraggable(tab, idx, 'x');
    tab.title = 'Drag to reorder';
    if (group) tab.style.boxShadow = `inset 0 3px 0 ${groupColour(group)}`;
    if (idx === state.activeSheetIndex) activeTab = tab;

    const review = sheetReviewOf(sheet);
    if (review) {
      const dot = document.createElement('span');
      dot.className = 'review-dot';
      dot.style.background = review.colour;
      dot.title = review.label + (sheet.note ? ` \u2014 ${sheet.note}` : '');
      tab.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = sheetTabLabel(sheet, idx);
    tab.appendChild(label);

    // The cross closes the tab only; the sheet stays in the project and is
    // listed in the Portfolio view, where it can be opened again or deleted.
    if (openCount > 1) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'close-btn';
      closeBtn.innerHTML = '&#10005;';
      closeBtn.title = 'Close this tab (the sheet stays in the project \u2014 open it again from Portfolio)';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeSheetTab(idx);
      };
      tab.appendChild(closeBtn);
    }

    tabsContainer.appendChild(tab);
  });

  // With many tabs open the bar scrolls; keep the one being worked on in view.
  if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const hidden = state.sheets.length - openCount;
  const btn = document.getElementById('portfolioBtn');
  if (btn) btn.textContent = hidden > 0 ? `\u2630 Portfolio (${hidden} hidden)` : '\u2630 Portfolio';
}

export function switchSheet(index) {
  state.selectedComponentId = null;
  state.selectedShapeId = null;
  state.selectedImageId = null;
  state.selectedTerminalLinkId = null;
  state.activeSheetIndex = index;
  loadActiveSheet();
}

export async function addSheet() {
  if (window.currentUser?.plan === 'free' && getTotalSchematicSheets() + 1 > 2) {
    const proceed = await appConfirm('The free plan saves projects with up to 2 schematic sheets. You can keep working, but saving to your account won\'t work past that limit unless you upgrade. Continue?');
    if (!proceed) return;
  }
  pushHistory();
  // The new sheet goes straight after the last schematic sheet, ahead of any BOM, PLC I/O or other pages at the back.
  const before = sheetNumbers();
  let at = 0;
  for (let i = state.sheets.length - 1; i >= 0; i--) if (getPageType(state.sheets[i]) === 'schematic') { at = i + 1; break; }
  if (!at) at = state.sheets.length;
  const newNum = state.sheets.slice(0, at).filter(s => getPageType(s) === 'schematic').length + 1;
  state.sheets.splice(at, 0, {
    id: Date.now(), pageType: 'schematic', size: 'A3', orientation: 'landscape',
    title: `SHEET ${newNum}`, description: 'NEW CIRCUIT',
    author: '', approvedBy: '', createdDate: todayStr, location: '',
    rev: '1.0', components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  renumberAfter(before);
  state.activeSheetIndex = at;
  loadActiveSheet();
  scheduleAutosave();
}

// Title and Contents pages always sit at the very start of the portfolio,
// in that order, and are never counted in schematic sheet numbering.
export async function addTitlePage() {
  if (state.sheets.some(s => getPageType(s) === 'title')) {
    await appAlert('This portfolio already has a title page.');
    state.activeSheetIndex = state.sheets.findIndex(s => getPageType(s) === 'title');
    loadActiveSheet();
    return;
  }
  pushHistory();
  state.sheets.splice(0, 0, {
    id: Date.now(), pageType: 'title', size: 'A4', orientation: 'portrait',
    title: 'Project Title', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = 0;
  loadActiveSheet();
  scheduleAutosave();
}

export async function addContentsPage() {
  if (state.sheets.some(s => getPageType(s) === 'contents')) {
    await appAlert('This portfolio already has a contents page.');
    state.activeSheetIndex = state.sheets.findIndex(s => getPageType(s) === 'contents');
    loadActiveSheet();
    return;
  }
  pushHistory();
  const insertIdx = (state.sheets[0] && getPageType(state.sheets[0]) === 'title') ? 1 : 0;
  state.sheets.splice(insertIdx, 0, {
    id: Date.now(), pageType: 'contents', size: 'A4', orientation: 'portrait',
    title: 'Contents', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = insertIdx;
  loadActiveSheet();
  scheduleAutosave();
}

// Sits right after Contents (or after Title if there's no Contents page yet,
// or at the very start if neither exists) — the user's own stated
// preference for where this belongs in the page order.
export async function addLocationsPage() {
  if (state.sheets.some(s => getPageType(s) === 'locations')) {
    await appAlert('This portfolio already has a locations page.');
    state.activeSheetIndex = state.sheets.findIndex(s => getPageType(s) === 'locations');
    loadActiveSheet();
    return;
  }
  pushHistory();
  let insertIdx = 0;
  if (state.sheets[0] && getPageType(state.sheets[0]) === 'title') insertIdx = 1;
  if (state.sheets[insertIdx] && getPageType(state.sheets[insertIdx]) === 'contents') insertIdx++;
  state.sheets.splice(insertIdx, 0, {
    id: Date.now(), pageType: 'locations', size: 'A4', orientation: 'portrait',
    title: 'Locations', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = insertIdx;
  loadActiveSheet();
  scheduleAutosave();
}

// Unlike Title/Contents, which always sit at the very start, a BOM page goes
// at the very end — the usual place for a parts list in a real drawing set —
// and, like them, is never counted in schematic sheet numbering. More than
// one is allowed, one after another: renderBOMPageContent paginates the
// parts list across however many BOM pages actually exist, so a long list
// spans several rather than running off the bottom of a single page. Every
// BOM page carries the same plain "Bill of Materials" title — which one it
// is, and any "(continued)" wording, is worked out fresh at render time from
// its own position among the others, not stored here, so it stays correct
// even if pages are added, removed, or reordered later.
export async function addBOMPage() {
  pushHistory();
  const insertIdx = state.sheets.length;
  state.sheets.push({
    id: Date.now(), pageType: 'bom', size: 'A4', orientation: 'landscape', // landscape: the BOM table has 8 columns, needs the extra width
    title: 'Bill of Materials', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = insertIdx;
  loadActiveSheet();
  scheduleAutosave();
}

// A PLC I/O schedule page goes at the end with the BOM (after it, when there is one), and is never counted in schematic sheet
// numbering. More than one is allowed: renderPlcIoPageContent paginates the list across them, the way the BOM does.
export async function addPlcIoPage() {
  pushHistory();
  const insertIdx = state.sheets.length;
  state.sheets.push({
    id: Date.now(), pageType: 'plcio', size: 'A4', orientation: 'landscape',
    title: 'PLC I/O Schedule', description: '', author: '', approvedBy: '',
    createdDate: todayStr, location: '', customer: '', rev: '1.0',
    components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
  });
  state.activeSheetIndex = insertIdx;
  loadActiveSheet();
  scheduleAutosave();
}

// Brings the designators and automatic wire IDs of a project into line with the order its sheets are in now (for a project that was
// already out of step; adding, deleting and moving sheets now does this itself).
export async function renumberProject() {
  if (!(await appConfirm('Renumber every sheet\'s part designators (3K1) and automatic wire IDs (305) to match the order of the sheets now? Names you typed yourself are left alone. You can Undo (Ctrl+Z) right after.', 'Renumber sheets'))) return;
  const n = typeof window.renumberSheetsFromContent === 'function' ? window.renumberSheetsFromContent() : 0;
  loadActiveSheet();
  await appAlert(n ? `${n} designator${n === 1 ? '' : 's'} and wire ID${n === 1 ? '' : 's'} renumbered.` : 'Everything already matches the order of the sheets.');
}

export async function removeSheet(index) {
  if (state.sheets.length <= 1) return;

  const sheetName = state.sheets[index].title || (getSchematicSheetNumber(index) ? `Sheet ${getSchematicSheetNumber(index)}` : `Page ${index + 1}`);
  const proceed = await appConfirm(`Delete "${sheetName}"? You can Undo (Ctrl+Z) right after if this was a mistake.`);
  if (!proceed) return;

  pushHistory();
  const activeId = state.sheets[state.activeSheetIndex]?.id;
  const before = sheetNumbers();
  state.sheets.splice(index, 1);
  renumberAfter(before);   // the sheets after it close the gap: sheet numbers, designators and wire IDs
  const ni = state.sheets.findIndex(s => s.id === activeId);
  state.activeSheetIndex = ni >= 0 ? ni : Math.min(index, state.sheets.length - 1);   // stay on the sheet being worked on, else the one that took its place
  loadActiveSheet();
  scheduleAutosave();
}

export function updateCurrentSheet() {
  const sheet = getActiveSheet();
  if (!sheet) return;

  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };

  sheet.size = getVal('sizeSelect');
  sheet.orientation = getVal('orientationSelect');
  if (getVal('lineColumnsSelect') === '2') sheet.lineColumns = 2; else delete sheet.lineColumns;
  sheet.title = getVal('titleInput');
  sheet.description = getVal('descInput');
  sheet.author = getVal('authorInput');
  sheet.approvedBy = getVal('approvedInput');
  sheet.createdDate = getVal('createdInput');
  sheet.location = getVal('locationInput');
  sheet.iecLocation = getVal('iecLocationSelect') || null;
  sheet.customer = getVal('customerInput');
  sheet.identificationNumber = getVal('idNumberInput').trim().slice(0, 60);
  sheet.docType = getVal('docTypeInput').trim().slice(0, 40);
  sheet.docStatus = getVal('docStatusInput').trim().slice(0, 30);
  sheet.language = getVal('languageInput').trim().slice(0, 10);
  const wp = cleanWirePrefix(getVal('sheetWirePrefixInput'));
  const wpChanged = (sheet.wirePrefix || '') !== wp;
  if (wp) sheet.wirePrefix = wp; else delete sheet.wirePrefix;
  // Function (=P1), review state and note are Pro; on a Free account the boxes are disabled and whatever the sheet holds is left alone.
  const fnBox = document.getElementById('sheetFunctionInput');
  if (fnBox && !fnBox.disabled) {
    const fn = cleanFunctionTag(fnBox.value);
    if (fn) sheet.iecFunction = fn; else delete sheet.iecFunction;
    const review = getVal('sheetReviewSelect');
    if (review) sheet.review = review; else delete sheet.review;
    const note = getVal('sheetNoteInput').trim().slice(0, 500);
    if (note) sheet.note = note; else delete sheet.note;
  }

  if (wpChanged && typeof window.applyWirePrefixes === 'function') window.applyWirePrefixes();   // this sheet's automatic wire IDs take the new prefix
  renderSheetBorder(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets());
  renderTabs();
  scheduleAutosave();
}

export function handleDragStart(e, type) {
  e.dataTransfer.setData('symbolType', type);
  applySymbolDragImage(e, type, stage.scaleX() || 1); // the symbol itself follows the pointer, at the sheet's zoom, instead of the sidebar row
}

export function handleDrop(e) {
  e.preventDefault();
  const type = e.dataTransfer.getData('symbolType');
  if (!type) return;

  stage.setPointersPositions(e);
  const pointer = stage.getPointerPosition();
  const scale = stage.scaleX();
  
  const x = snapToGrid((pointer.x - stage.x()) / scale);
  const y = snapToGrid((pointer.y - stage.y()) / scale);

  const sheet = getActiveSheet();
  if (!sheet.components) sheet.components = [];

  const compId = Date.now();
  const { prefix, value: val } = getPrefixAndValue(type);
  const formattedLabel = nextLabelForType(sheet, type);

  pushHistory();
  const newComp = {
    id: compId, type: type, label: formattedLabel, value: val,
    modelNo: '', make: '', description: '', x: x, y: y, rotation: 0
  };
  // A PLC module carries its make, model and description with it (the BOM reads them).
  const dropped = window.customSymbolDefinitions?.[type];
  if (dropped && (dropped.parentCoil || isValveBody(newComp, dropped))) { newComp.isParent = true; newComp.description = dropped.description || ''; }   // the built-in coils are parents already
    if (dropped && (dropped.plc || dropped.drive)) { newComp.make = dropped.make || ''; newComp.modelNo = dropped.modelNo || ''; newComp.description = dropped.description || ''; }
  sheet.components.push(newComp);
  snapComponentIntoWires(newComp, sheet); // wire it in automatically if dropped directly onto one

  state.selectedComponentId = compId;
  renderComponents(openEditModal);
  scheduleAutosave();
}

export function openSheetPropsModal() {
  const modal = document.getElementById('sheetPropsModal');
  if (modal) modal.style.display = 'flex';
  fillDocSuggestions();
  syncDocNumberHint(getActiveSheet());
}

// The identification-number box shows what the pattern would give while it is left empty.
function syncDocNumberHint(sheet) {
  const el = document.getElementById('idNumberInput');
  if (!el || !sheet) return;
  const v = titleBlockValues(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets());
  el.placeholder = v.docNumber ? `Automatic: ${buildDocNumber(state.projectInfo && state.projectInfo.docPattern, state.projectInfo, v.sheetNum, v.sheetTotal, sheet)}` : 'Worked out from the pattern in Project & title block';
}

function fillDocSuggestions() {
  const fill = (id, list) => { const dl = document.getElementById(id); if (dl && !dl.children.length) list.forEach(t => { const o = document.createElement('option'); o.value = t; dl.appendChild(o); }); };
  fill('docTypeList', DOC_TYPE_SUGGESTIONS); fill('docStatusList', DOC_STATUS_SUGGESTIONS); fill('languageList', LANGUAGE_SUGGESTIONS);
}

// ---- Project & title block: company / project level fields and the choice of title block ----
const PI_FIELDS = { refStyle: 'piRefStyle', legalOwner: 'piLegalOwner', projectNumber: 'piProjectNumber', customer: 'piCustomer', site: 'piSite', docPrefix: 'piDocPrefix', docPattern: 'piDocPattern', wireIdPrefix: 'piWireIdPrefix', docType: 'piDocType', docStatus: 'piDocStatus', language: 'piLanguage' };

function syncProjectInfoPreview() {
  const hint = document.getElementById('tbTemplateHint');
  const sel = document.getElementById('tbTemplateSelect');
  if (hint && sel) {
    const free = isFreePlan();
    hint.textContent = sel.value === 'iso7200'
      ? 'Boxed, captioned fields in the ISO 7200 layout: legal owner, document number, type, status, language and sheet x of y.'
      : sel.value === 'custom' ? 'Your own design. Use Design your own to change it, including a different layout for each paper size.'
      : (free ? 'The ISO 7200 title block is a Pro feature.' : 'The original title block.');
  }
  const prev = document.getElementById('piDocPreview');
  if (prev) {
    const info = state.projectInfo || {};
    prev.textContent = buildDocNumber(info.docPattern, info, 1, getTotalSchematicSheets(), getActiveSheet()) || '(empty)';
  }
}

export function openProjectInfoModal() {
  const modal = document.getElementById('projectInfoModal');
  if (!modal) return;
  const info = state.projectInfo || {};
  Object.keys(PI_FIELDS).forEach(k => { const el = document.getElementById(PI_FIELDS[k]); if (el) el.value = info[k] || ''; });
  const sel = document.getElementById('tbTemplateSelect');
  const hasCustom = !!(state.titleBlock && state.titleBlock.custom && state.titleBlock.custom.default);
  const customOpt = sel && sel.querySelector('option[value="custom"]');
  if (customOpt) customOpt.disabled = !hasCustom || isFreePlan();
  if (sel) sel.value = (state.titleBlock && state.titleBlock.templateId) || 'standard';
  fillDocSuggestions();
  syncProjectInfoPreview();
  modal.style.display = 'flex';
}

export function closeProjectInfoModal() {
  const modal = document.getElementById('projectInfoModal');
  if (modal) modal.style.display = 'none';
}

export function updateProjectInfo() {
  const raw = {};
  Object.keys(PI_FIELDS).forEach(k => { const el = document.getElementById(PI_FIELDS[k]); raw[k] = el ? el.value : ''; });
  // trimming as you type would eat the space you are about to type after a word, so only the length is limited here
  const info = {};
  Object.keys(PI_FIELDS).forEach(k => { info[k] = String(raw[k]).slice(0, PROJECT_INFO_MAX[k]); });
  state.projectInfo = info;
  if (typeof window.applyWirePrefixes === 'function') window.applyWirePrefixes();   // automatic wire IDs take the new prefix
  const sel = document.getElementById('tbTemplateSelect');
  state.titleBlock = cleanTitleBlockSettings({ templateId: sel ? sel.value : 'standard', custom: state.titleBlock && state.titleBlock.custom });   // the custom design is kept while another block is chosen
  syncProjectInfoPreview();
  const sheet = getActiveSheet();
  if (sheet) renderSheetBorder(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets());
  if (typeof window.refreshCanvas === 'function') window.refreshCanvas();   // cross-references on the sheet are written in the chosen style
  scheduleAutosave();
}

export function closeSheetPropsModal() {
  const modal = document.getElementById('sheetPropsModal');
  if (modal) modal.style.display = 'none';
}

// ---- IEC-style locations: shared "pick or create" UI, used by Sheet
// Properties, the Component Edit modal, and the Location boundary tool. ----

let locationModalCallback = null;

// Fills a <select> with every defined location ("ABBR — Description"),
// a trailing "+ New Location..." option that opens the create-modal when
// picked, and — only when asked for — a leading "none/inherit" option for
// pickers where leaving it unset is meaningful (a component's own
// override, unlike a sheet's own prevailing location, which always has a
// definite value once set).
export function populateLocationDropdown(selectId, currentValue, { includeNone = false, noneLabel = '-- None --' } = {}) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';

  if (includeNone) {
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = noneLabel;
    select.appendChild(noneOpt);
  }

  state.locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.description ? `${loc.abbreviation} — ${loc.description}` : loc.abbreviation;
    select.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New Location…';
  select.appendChild(newOpt);

  select.value = currentValue || '';
  // currentValue might not match any option (e.g. "" with includeNone
  // false, on a sheet that's never had one set) — fall back to the first
  // real option rather than silently leaving the browser's own default
  // (usually "+ New Location...", which would be a confusing thing to
  // land on with nothing selected). Compared as strings: a <select>'s own
  // value is always a string, even right after being set from a number
  // (every location id is Date.now(), a number) — a raw !== here would
  // misfire on every single successful selection and wrongly fall back.
  if (String(select.value) !== String(currentValue || '') && !includeNone && state.locations.length) {
    select.value = state.locations[0].id;
  }
}

// Wired to a location <select>'s onchange. A direct pick of a real,
// existing location resolves immediately — onResolved (if given) fires
// right away, e.g. so the Sheet Properties modal can save the change the
// same way every other field there already auto-saves on input. Picking
// the sentinel "+ New Location..." option opens the create-modal instead
// of leaving that literal placeholder selected, and onResolved only fires
// once that's actually settled — either a new location was created (the
// select ends up on it) or the modal was cancelled (the select reverts to
// whatever it was before) — never while "+ New Location..." is still the
// select's own value.
export function handleLocationSelectChange(selectEl, previousValue, onResolved, populateOptions) {
  if (selectEl.value !== '__new__') {
    if (onResolved) onResolved();
    return;
  }
  openCreateLocationModal(loc => {
    // Re-populate first: a freshly-created location has no <option> for it
    // yet anywhere on the page, since nothing else refreshes a dropdown's
    // own option list when state.locations gains a new entry — just setting
    // .value to its id would silently fail to select anything, same as
    // setting a <select> to a value it has no matching <option> for ever
    // does. The same options (e.g. includeNone) the dropdown was first
    // populated with are passed through so a re-populate here doesn't
    // silently drop its "-- Inherits from sheet --" entry or similar.
    populateLocationDropdown(selectEl.id, loc.id, populateOptions);
    if (onResolved) onResolved();
  }, () => {
    selectEl.value = previousValue || '';
    if (onResolved) onResolved();
  });
}

let editingLocationId = null; // null = creating a new location; set = amending an existing one in place

export function openCreateLocationModal(onCreated, onCancelled) {
  editingLocationId = null;
  locationModalCallback = { onCreated: onCreated || null, onCancelled: onCancelled || null };
  document.getElementById('newLocationAbbr').value = '';
  document.getElementById('newLocationDesc').value = '';
  const titleEl = document.getElementById('createLocationModalTitle');
  if (titleEl) titleEl.textContent = 'New Location';
  const btnEl = document.getElementById('createLocationModalConfirmBtn');
  if (btnEl) btnEl.textContent = 'Create';
  const modal = document.getElementById('createLocationModal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('newLocationAbbr')?.focus(), 0);
}

// Opened from Manage Locations — reuses the same create modal and form
// (same fields, same validation), just pre-filled and updating the
// existing location object in place rather than pushing a new one.
// Because every reference to a location is by id, not by abbreviation,
// renaming one here automatically shows correctly everywhere it's already
// used — the title block, designators, the boundary box label, the
// Locations page — with nothing else to update by hand.
export function openEditLocationModal(locationId) {
  const loc = findLocationById(locationId);
  if (!loc) return;
  editingLocationId = loc.id;
  locationModalCallback = null; // Manage Locations re-renders its own list directly, not via this callback
  document.getElementById('newLocationAbbr').value = loc.abbreviation;
  document.getElementById('newLocationDesc').value = loc.description || '';
  const titleEl = document.getElementById('createLocationModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Location';
  const btnEl = document.getElementById('createLocationModalConfirmBtn');
  if (btnEl) btnEl.textContent = 'Save';
  const modal = document.getElementById('createLocationModal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('newLocationAbbr')?.focus(), 0);
}

export function openManageLocationsModal() {
  renderManageLocationsList();
  const modal = document.getElementById('manageLocationsModal');
  if (modal) modal.style.display = 'flex';
}

export function closeManageLocationsModal() {
  const modal = document.getElementById('manageLocationsModal');
  if (modal) modal.style.display = 'none';
}

function renderManageLocationsList() {
  const list = document.getElementById('manageLocationsList');
  if (!list) return; // modal not open — nothing to keep current
  list.innerHTML = '';

  if (state.locations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'modal-hint';
    empty.textContent = 'No locations defined yet.';
    list.appendChild(empty);
    return;
  }

  state.locations.forEach(loc => {
    const row = document.createElement('div');
    row.className = 'browse-library-row'; // same row styling as Browse Libraries — label + actions, same spacing

    const label = document.createElement('div');
    label.textContent = loc.description ? `+${loc.abbreviation} — ${loc.description}` : `+${loc.abbreviation}`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:6px; flex:0 0 auto;';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-ghost';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditLocationModal(loc.id);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => deleteLocation(loc.id);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(label);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

// Every sheet and component currently pointing at this location, by id —
// used both to warn before deleting and to clear those references
// afterward, so a delete never leaves a dangling reference to a location
// that no longer exists (it would just silently stop showing, rather than
// erroring, but a clean removal is better than an invisible stale one).
function findLocationUsages(locationId) {
  const usages = { sheets: [], components: [] };
  state.sheets.forEach(sheet => {
    if (String(sheet.iecLocation) === String(locationId)) usages.sheets.push(sheet);
    (sheet.components || []).forEach(comp => {
      if (String(comp.location) === String(locationId)) usages.components.push(comp);
    });
  });
  return usages;
}

export async function deleteLocation(locationId) {
  const loc = findLocationById(locationId);
  if (!loc) return;
  const usages = findLocationUsages(locationId);
  const usageCount = usages.sheets.length + usages.components.length;

  if (usageCount > 0) {
    const parts = [];
    if (usages.sheets.length) parts.push(`${usages.sheets.length} sheet${usages.sheets.length === 1 ? '' : 's'}`);
    if (usages.components.length) parts.push(`${usages.components.length} component${usages.components.length === 1 ? '' : 's'}`);
    const proceed = await appConfirm(`"+${loc.abbreviation}" is currently used by ${parts.join(' and ')}. Deleting it will clear those assignments — they'll fall back to no location set. Continue?`, 'Delete Location');
    if (!proceed) return;
  }

  pushHistory();
  usages.sheets.forEach(sheet => { sheet.iecLocation = null; });
  usages.components.forEach(comp => { comp.location = null; });
  // A location boundary that marked this one becomes a plain, unassigned
  // annotation box rather than being deleted outright — same reasoning as
  // cancelling the assignment prompt: never discard a shape someone drew.
  state.sheets.forEach(sheet => {
    (sheet.shapes || []).forEach(s => { if (String(s.locationId) === String(locationId)) s.locationId = null; });
  });
  state.locations = state.locations.filter(l => String(l.id) !== String(locationId));
  scheduleAutosave();
  renderManageLocationsList();
  loadActiveSheet();
}

export function closeCreateLocationModal() {
  const modal = document.getElementById('createLocationModal');
  if (modal) modal.style.display = 'none';
  const callback = locationModalCallback;
  locationModalCallback = null;
  if (callback && callback.onCancelled) callback.onCancelled();
}

let pendingBoundaryAssignment = null; // { shape, sheet } awaiting a pick from assignLocationModal

// Called from finishShapeDraw() in 3_schematic_engine.js (via
// window.promptAndAssignLocationBoundary, to avoid a circular import — that
// module already imports FROM this one) right after a boundary rectangle is
// drawn. Opens a small modal to pick (or create) the location it marks;
// cancelling just leaves it as a plain, unassigned annotation box rather
// than discarding the shape the person just drew.
export function promptAndAssignLocationBoundary(shape, sheet) {
  pendingBoundaryAssignment = { shape, sheet };
  populateLocationDropdown('assignLocationSelect', state.locations[0]?.id || '');
  const modal = document.getElementById('assignLocationModal');
  if (modal) modal.style.display = 'flex';
}

export function cancelAssignLocation() {
  const modal = document.getElementById('assignLocationModal');
  if (modal) modal.style.display = 'none';
  pendingBoundaryAssignment = null; // shape keeps whatever it already had (nothing, on first creation) — never deleted out from under the person
}

export function confirmAssignLocation() {
  if (!pendingBoundaryAssignment) return;
  const { shape, sheet } = pendingBoundaryAssignment;
  const select = document.getElementById('assignLocationSelect');
  const locId = select ? select.value : '';

  if (locId && locId !== '__new__') {
    pushHistory();
    shape.locationId = locId;
    // Bulk-stamp: every component currently within the box's bounds (at the
    // moment it's assigned, not a live/ongoing relationship — matching how
    // the equivalent single-component override already works, a deliberate
    // snapshot rather than something that keeps re-evaluating itself as
    // things get moved around later) gets this location as its own
    // explicit override.
    const x = Math.min(shape.x1, shape.x2), y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1), h = Math.abs(shape.y2 - shape.y1);
    (sheet.components || []).forEach(comp => {
      if (comp.x >= x && comp.x <= x + w && comp.y >= y && comp.y <= y + h) {
        comp.location = locId;
      }
    });
    scheduleAutosave();
    loadActiveSheet(); // re-render so the newly-stamped components' designators pick up the +ABBR- prefix immediately
  }

  const modal = document.getElementById('assignLocationModal');
  if (modal) modal.style.display = 'none';
  pendingBoundaryAssignment = null;
}

export async function confirmCreateLocation() {
  const abbr = document.getElementById('newLocationAbbr').value.trim();
  const desc = document.getElementById('newLocationDesc').value.trim();
  if (!abbr) {
    await appAlert('An abbreviation is required — it\'s what shows in designators, e.g. "CP" for +CP-K1.');
    return;
  }
  // Excludes itself when editing — otherwise saving a location without
  // touching its own abbreviation would always "collide" with itself.
  if (state.locations.some(l => l.abbreviation.toLowerCase() === abbr.toLowerCase() && String(l.id) !== String(editingLocationId))) {
    await appAlert(`A location with abbreviation "${abbr}" already exists — pick a different one, or select the existing one from the dropdown instead.`);
    return;
  }

  pushHistory();
  let loc;
  if (editingLocationId !== null) {
    loc = findLocationById(editingLocationId);
    if (loc) { loc.abbreviation = abbr; loc.description = desc; }
  } else {
    loc = { id: Date.now(), abbreviation: abbr, description: desc };
    state.locations.push(loc);
  }
  scheduleAutosave();
  renderManageLocationsList(); // harmless no-op if that modal isn't open; keeps it current if it is
  loadActiveSheet(); // picks up a renamed abbreviation in the title block / on-canvas designators immediately

  const callback = locationModalCallback;
  locationModalCallback = null; // cleared before closeCreateLocationModal() so it doesn't also fire onCancelled
  editingLocationId = null;
  const modal = document.getElementById('createLocationModal');
  if (modal) modal.style.display = 'none';
  if (callback && callback.onCreated) callback.onCreated(loc);
}

export async function savePortfolio() {
  const nameInput = document.getElementById('projectNameInput');
  const rawProjectName = nameInput ? nameInput.value.trim() : '';
  const sanitizedName = rawProjectName.replace(/[^a-z0-9_\-]/gi, '_') || 'schematic_project';

  const portfolioData = {
    version: "1.0",
    projectName: rawProjectName,
    savedAt: new Date().toISOString(),
    customSymbols: symbolsForSave(),
    companyLogo: state.companyLogo,
    cables: state.cables,
    locations: state.locations,
    sections: state.sections,
    terminalModels: state.terminalModels,
    cableLibrary: state.cableLibrary,
    panelFootprints: state.panelFootprints,
    revisions: state.revisions,
    projectInfo: state.projectInfo,
    titleBlock: state.titleBlock,
    showWireIds: state.showWireIds,
    showWirePlcData: state.showWirePlcData,
    sheets: state.sheets
  };

  const jsonStr = JSON.stringify(portfolioData, null, 2);
  await saveTextFile(jsonStr, `${sanitizedName}.json`, 'application/json', 'Schematic Project (JSON)');
}

// Reads an uploaded image file as a data URL and stores it as the company
// logo, shown in every sheet's title block. Stored inline (not a file
// reference) so it travels with the saved portfolio JSON.
export function setCompanyLogo(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    pushHistory();
    state.companyLogo = e.target.result;
    loadActiveSheet();
    scheduleAutosave();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// SHEET_CONFIGS' pixel dimensions are the 96-DPI CSS-pixel equivalent of the
// real ISO paper sizes (e.g. A4 landscape 1123px == 297mm at 96px/inch), so this
// converts cleanly back to millimeters for physically-accurate print output.
const PX_PER_MM = 96 / 25.4;
// The printed page is a rasterised image, not vector output — its sharpness
// is capped by how many pixels get baked in here, independent of anything
// the printer itself can do. The sheet's own coordinate system is built on a
// 96 DPI baseline (see PX_PER_MM above), so a plain pixelRatio of 2 only
// bakes in ~192 DPI of real detail; a printer then has to upscale that to
// its own resolution (typically 300 DPI or more), and upscaling is exactly
// what shows up as softness on thin wire lines and small labels. 300 DPI is
// the standard threshold for print output to read as genuinely sharp, so
// PRINT_PIXEL_RATIO is set to reach it exactly (96 * this = 300).
const PRINT_PIXEL_RATIO = 300 / 96;

function escapeHtmlAttr(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Prints every sheet, in order, each as its own physical page sized to match
// that sheet's actual paper size and orientation. Deliberately synchronous
// throughout (no await before window.open) so the popup isn't blocked by the
// browser as an unrequested popup.
export function printPortfolio() {
  if (!state.sheets || state.sheets.length === 0) return;

  const originalActiveIndex = state.activeSheetIndex;
  const originalScale = stage.scale();
  const originalPosition = stage.position();
  const originalStageWidth = stage.width();
  const originalStageHeight = stage.height();
  const wirePreviewWasVisible = wirePreviewLayer.visible();
  wirePreviewLayer.visible(false); // never print the interactive wire-draw preview

  // Nothing should show as selected/highlighted on the printed output.
  const originalSelection = {
    componentId: state.selectedComponentId,
    wireIndex: state.selectedWireIndex,
    textId: state.selectedTextId,
    shapeId: state.selectedShapeId,
    terminalLinkId: state.selectedTerminalLinkId,
    cableMarkerId: state.selectedCableMarkerId,
    rubberBandComponentIds: state.rubberBandComponentIds,
    rubberBandTextIds: state.rubberBandTextIds,
    rubberBandWireIndices: state.rubberBandWireIndices,
    rubberBandCableMarkerIds: state.rubberBandCableMarkerIds
  };
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  state.selectedTextId = null;
  state.selectedShapeId = null;
  state.selectedImageId = null;
  state.selectedTerminalLinkId = null;
  state.selectedCableMarkerId = null;
  state.rubberBandComponentIds = [];
  state.rubberBandTextIds = [];
  state.rubberBandWireIndices = [];
  state.rubberBandCableMarkerIds = [];

  const pageImages = [];

  state.sheets.forEach((sheet, idx) => {
    state.activeSheetIndex = idx;
    loadActiveSheet(); // repaints border/wires/components for this sheet

    const config = SHEET_CONFIGS[sheet.size] || SHEET_CONFIGS.A3;
    const isLandscape = sheet.orientation === 'landscape';
    const pageWidth = isLandscape ? config.width : config.height;
    const pageHeight = isLandscape ? config.height : config.width;

    // The canvas element must be at least as large as the page to capture all
    // of it — the viewport is usually smaller than a full A3/A2 sheet.
    stage.width(Math.max(originalStageWidth, pageWidth));
    stage.height(Math.max(originalStageHeight, pageHeight));
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });

    borderLayer.find('.placementGrid').forEach(n => n.visible(false)); // screen-only aid, not part of the drawing
    borderLayer.find('.cable-diagram-tip').forEach(n => n.visible(false)); // on-screen help button, never printed
    stage.draw(); // immediate, synchronous — not batchDraw, which can be deferred

    const dataUrl = stage.toDataURL({ x: 0, y: 0, width: pageWidth, height: pageHeight, pixelRatio: PRINT_PIXEL_RATIO });

    pageImages.push({
      dataUrl,
      widthMm: pageWidth / PX_PER_MM,
      heightMm: pageHeight / PX_PER_MM,
      title: sheet.title || (getSchematicSheetNumber(idx) ? `Sheet ${getSchematicSheetNumber(idx)}` : `Page ${idx + 1}`)
    });
  });

  // Restore the view — and selection — exactly as the person left it.
  state.activeSheetIndex = originalActiveIndex;
  state.selectedComponentId = originalSelection.componentId;
  state.selectedWireIndex = originalSelection.wireIndex;
  state.selectedTextId = originalSelection.textId;
  state.selectedShapeId = originalSelection.shapeId;
  state.selectedTerminalLinkId = originalSelection.terminalLinkId;
  state.selectedCableMarkerId = originalSelection.cableMarkerId;
  state.rubberBandComponentIds = originalSelection.rubberBandComponentIds;
  state.rubberBandTextIds = originalSelection.rubberBandTextIds;
  state.rubberBandWireIndices = originalSelection.rubberBandWireIndices;
  state.rubberBandCableMarkerIds = originalSelection.rubberBandCableMarkerIds;
  loadActiveSheet();
  stage.width(originalStageWidth);
  stage.height(originalStageHeight);
  stage.scale(originalScale);
  stage.position(originalPosition);
  wirePreviewLayer.visible(wirePreviewWasVisible);
  stage.draw();

  openPrintWindow(pageImages);
}

async function openPrintWindow(pageImages) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    await appAlert('Your browser blocked the print window. Please allow popups for this page and try again.');
    return;
  }

  // Named @page rules: each sheet declares its own physical size explicitly,
  // rather than relying on '@page { size: auto }' (which means "whatever paper
  // size is currently selected in the print dialog", not "fit to content" —
  // the actual cause of the extra blank page whenever a sheet was larger than
  // that default). This also correctly handles a print job with mixed sheet
  // sizes (some A4, some A3, etc.) in a single pass.
  const pageRules = pageImages
    .map((p, i) => `@page page${i} { size: ${p.widthMm.toFixed(2)}mm ${p.heightMm.toFixed(2)}mm; margin: 0; }`)
    .join('\n  ');

  const pagesHtml = pageImages.map((p, i) => `
    <div class="print-page" style="page:page${i}; width:${p.widthMm}mm; height:${p.heightMm}mm;">
      <img src="${p.dataUrl}" alt="${escapeHtmlAttr(p.title)}">
    </div>
  `).join('');

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Print Schematic</title>
<style>
  @page { size: auto; margin: 0; }
  ${pageRules}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  .print-page { page-break-after: always; overflow: hidden; }
  .print-page:last-child { page-break-after: auto; }
  .print-page img { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
  // afterprint fires once the browser's print dialog is dismissed, whether
  // the person actually printed or cancelled — either way, this popup has
  // done its job and shouldn't linger as a stray window.
  printWindow.onafterprint = () => printWindow.close();
}

// Shared by loadPortfolio (file import) and openProjectFromServer/resumeMostRecentProject (8_projects.js)
export function applyPortfolioData(portfolioData) {
  if (!portfolioData || !Array.isArray(portfolioData.sheets)) return false;

  state.sheets = portfolioData.sheets;
  if (portfolioData.customSymbols) {
    repairSymbolLibrary(portfolioData.customSymbols); // symbols saved by older versions can carry damaged arcs
    window.customSymbolDefinitions = portfolioData.customSymbols;
    renderCustomSymbolsList(handleDragStart);
  }
  state.companyLogo = portfolioData.companyLogo || null;
  state.cables = portfolioData.cables || [];
  state.locations = portfolioData.locations || [];
  state.sections = cleanSectionList(portfolioData.sections);
  state.panelFootprints = Array.isArray(portfolioData.panelFootprints) ? portfolioData.panelFootprints : [];
  state.projectInfo = cleanProjectInfo(portfolioData.projectInfo);   // a project saved before these existed has empty ones
  state.titleBlock = cleanTitleBlockSettings(portfolioData.titleBlock);
  state.revisions = cleanRevisionList(portfolioData.revisions);   // a project saved before revisions existed simply has none
  state.cableLibrary = portfolioData.cableLibrary || [];   // a project saved before the cable library existed simply has none
  state.terminalModels = portfolioData.terminalModels || [];   // a project saved before models existed simply has none
  // The junction look is saved with the drawing. A project saved before it was
  // (or one that simply has none) opens with the defaults — the same as it
  // always did, rather than inheriting whatever the previous project had set.
  state.showWireIds = portfolioData.showWireIds !== false;   // a project saved before this existed shows them, as it always did
  state.showWirePlcData = portfolioData.showWirePlcData !== false;
  state.junctionStyle = portfolioData.junctionStyle === 'notch' ? 'notch' : 'dot';
  state.junctionHopDirection = portfolioData.junctionHopDirection === 'away' ? 'away' : 'toward';
  syncJunctionControls();
  if (portfolioData.projectName && document.getElementById('projectNameInput')) {
    document.getElementById('projectNameInput').value = portfolioData.projectName;
  }
  state.activeSheetIndex = 0;
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  loadActiveSheet();
  clearHistory(); // loading a different project is a fresh undo context
  return true;
}

export function loadPortfolio(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const portfolioData = JSON.parse(e.target.result);
      if (applyPortfolioData(portfolioData)) {
        await appAlert("Portfolio loaded successfully!");
        scheduleAutosave();
      } else {
        await appAlert("Invalid portfolio file format.");
      }
    } catch (err) {
      await appAlert("Error parsing the project file: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

export function openEditModal(comp, options = {}) {
  // A terminal is edited in its own dialog — block, position and type — which has
  // a "More details..." button that comes back here (force) for the part number,
  // make, description and fill colour.
  if (comp.type === 'terminal' && !options.force && typeof window.openTerminalModal === 'function') {
    window.openTerminalModal({ mode: 'edit', comp, sheet: getActiveSheet() });
    return;
  }
  editingComponent = comp;
  document.getElementById('editCompLabel').value = comp.label || '';

  // Start from this component's OWN stored values, enabled — a fresh baseline
  // for THIS edit session. refreshEditModalDerivedFields(), called below,
  // switches to the parent's values (and disables the fields) if it turns
  // out this component is itself a child.
  ['editCompValue', 'editCompMake', 'editCompModel', 'editCompDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  document.getElementById('editCompValue').value = comp.value || '';
  document.getElementById('editCompMake').value = comp.make || '';
  document.getElementById('editCompModel').value = comp.modelNo || '';
  document.getElementById('editCompDesc').value = comp.description || '';
  [['editShowDesignator', 'designator'], ['editShowValue', 'value'], ['editShowModel', 'modelNo'], ['editShowDesc', 'description'], ['editShowRef', 'crossRef']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = !(comp.hiddenFields || []).includes(key);
  });
  populateLocationDropdown('editCompLocation', comp.location || '', { includeNone: true, noneLabel: '-- Inherits from sheet --' });
  // Locations are a Pro feature, and the page renders this dropdown disabled
  // for a free account — don't switch it back on every time the dialog opens.
  // (A free account keeps SEEING a location it already has, e.g. from a trial.)
  document.getElementById('editCompLocation').disabled = isFreePlan();

  const isParent = !!comp.isParent;
  document.getElementById('editCompIsParent').checked = isParent;
  document.getElementById('editCompContactNo').value = comp.contactNo || '';

  populateJointDropdown(comp.id, comp.jointToId);
  { const sc = document.getElementById('editCompSelfContact'); if (sc) { sc.innerHTML = ''; sc.dataset.initial = comp.selfContactRef ? choiceValue(comp.selfContactRef.set, comp.selfContactRef.id) : ''; } }
  { const lc = document.getElementById('editCompLinkChildren'); if (lc) lc.checked = !!comp.linkChildren; }
  const linkSel = document.getElementById('editCompLinkTo'); if (linkSel) linkSel.innerHTML = ''; if (linkSel) linkSel.dataset.initial = comp.linkContactId !== undefined && comp.linkContactId !== null ? String(comp.linkContactId) : '';
  { const refSel = document.getElementById('editCompContactRef'); if (refSel) { refSel.innerHTML = ''; refSel.dataset.initial = ''; refSel.style.outline = ''; } }
  populateParentDropdown(comp.id, comp.parentId);
  const parentSelect = document.getElementById('editCompParentId');
  if (parentSelect) parentSelect.value = comp.parentId || '';

  // A PLC module or drive has its make, model and description from the creator, so they are not edited here: a note takes their place.
  const moduleDef = window.customSymbolDefinitions?.[comp.type];
  const isModule = !!(moduleDef && (moduleDef.plc || (moduleDef.drive && moduleDef.drive.layout !== 'block')));   // a block-layout drive has its part number and description edited here
  const showIf = (id, on, display = 'block') => { const e = document.getElementById(id); if (e) e.style.display = on ? display : 'none'; };
  showIf('editMakeModelDesc', !isModule); showIf('editNoteRow', isModule);
  showIf('editShowModelLbl', !isModule, 'flex'); showIf('editShowDescLbl', !isModule, 'flex');
  const noteEl = document.getElementById('editCompNote'); if (noteEl) noteEl.value = comp.note || '';
  renderAuxItemsRows(comp.auxItems || []);
  renderOwnContacts(comp.contacts || []);
  renderPlcFunctionRows(comp);
  toggleParentOptions(isParent); // also runs refreshEditModalDerivedFields(), which resolves child inheritance and the aux-items section's visibility

  const fillRow = document.getElementById('terminalFillRow');
  if (fillRow) fillRow.style.display = comp.type === 'terminal' ? 'block' : 'none';
  const fillColorInput = document.getElementById('editCompFillColor');
  if (fillColorInput) fillColorInput.value = comp.fillColor || '#ffffff';

  const modal = document.getElementById('editComponentModal');
  if (modal) modal.style.display = 'flex';
}

export function closeEditModal() {
  const modal = document.getElementById('editComponentModal');
  if (modal) modal.style.display = 'none';
  editingComponent = null;
}

export function openWireEditModal(wire) {
  editingWire = wire;
  const input = document.getElementById('editWireId');
  if (input) input.value = wire.wireId || '';
  const hide = document.getElementById('editWireHideId');
  if (hide) hide.checked = !!wire.hideWireId;
  const all = document.getElementById('editWireHideAll');
  if (all) all.checked = false;
  const onlyNet = document.getElementById('editWireOnlyNet');
  if (onlyNet) onlyNet.checked = false;

  const modal = document.getElementById('editWireModal');
  if (modal) modal.style.display = 'flex';
}

export function closeWireEditModal() {
  const modal = document.getElementById('editWireModal');
  if (modal) modal.style.display = 'none';
  editingWire = null;
}

export function saveWireDetails() {
  if (!editingWire) return;

  const input = document.getElementById('editWireId');
  const newId = input ? input.value.trim() : '';
  const oldId = editingWire.wireId;
  const wasManual = !!editingWire.wireIdManual;

  pushHistory();

  // If this wire was already part of a manually-named net, renaming (or
  // clearing) it applies to every wire that shared the old name — on ANY
  // sheet, not just this one — so cross-sheet open-end references and this
  // sheet's own other segments stay in sync as one net, rather than splitting
  // into an old name and a new one.
  const onlyThisNet = !!document.getElementById('editWireOnlyNet')?.checked;
  // The wires of this wire's own net on this sheet (found by shared vertices).
  const thisNet = new Set([editingWire]);
  {
    const own = getActiveSheet()?.wires || [];
    let grew = true;
    while (grew) {
      grew = false;
      const keys = new Set();
      thisNet.forEach(w => { for (let i = 0; i < (w.points || []).length; i += 2) keys.add(`${w.points[i]},${w.points[i + 1]}`); });
      own.forEach(w => {
        if (thisNet.has(w)) return;
        for (let i = 0; i < (w.points || []).length; i += 2) if (keys.has(`${w.points[i]},${w.points[i + 1]}`)) { thisNet.add(w); grew = true; break; }
      });
    }
  }
  if (wasManual && oldId && oldId !== newId) {
    state.sheets.forEach(sheet => {
      (sheet.wires || []).forEach(wire => {
        if (onlyThisNet && !thisNet.has(wire)) return;   // leave other nets, and other sheets, that happen to share the name alone
        if (wire.wireIdManual && wire.wireId === oldId) {
          if (newId) {
            wire.wireId = newId;
          } else {
            wire.wireId = null;
            wire.wireIdManual = false;
            delete wire.wireIdUser;
          }
        }
      });
    });
  }

  if (newId) {
    editingWire.wireId = newId;
    editingWire.wireIdManual = true;
    editingWire.wireIdUser = true;   // typed by the person, so it outranks a name merely carried along the net
  } else {
    // Blank clears the manual name and reverts to automatic numbering.
    editingWire.wireId = null;
    editingWire.wireIdManual = false;
    delete editingWire.wireIdUser;
  }
  if (onlyThisNet) thisNet.forEach(w => { if (w !== editingWire && w.wireIdManual && w.wireId === oldId && newId) w.wireId = newId; });

  // Showing or hiding this wire's ID on the sheet: just this wire, or every wire on
  // this sheet that carries the same ID. Hiding only affects what is drawn.
  const hideBox = document.getElementById('editWireHideId');
  if (hideBox) {
    const hide = hideBox.checked;
    const targets = document.getElementById('editWireHideAll')?.checked && editingWire.wireId
      ? (getActiveSheet()?.wires || []).filter(w => w.wireId === editingWire.wireId)
      : [editingWire];
    targets.forEach(w => { if (hide) w.hideWireId = true; else delete w.hideWireId; });
    if (!hide) delete editingWire.hideWireId;
  }

  closeWireEditModal();
  renderComponents(openEditModal); // re-renders the current sheet; other sheets'
                                    // data is already updated and will show
                                    // correctly whenever the person switches to them
  scheduleAutosave();
}

// ---- Sheet text box modal (rich formatting: font, size, bold/italic/underline) ----
function setTextBoxStyleButtons(styles) {
  document.getElementById('tbBoldBtn')?.classList.toggle('btn-primary', !!styles.bold);
  document.getElementById('tbItalicBtn')?.classList.toggle('btn-primary', !!styles.italic);
  document.getElementById('tbUnderlineBtn')?.classList.toggle('btn-primary', !!styles.underline);
}

// Called when the Text tool places a new box (position already chosen by the click)
export function openTextBoxModalForNew(x, y) {
  editingTextBox = null;
  pendingNewTextPos = { x, y };
  const contentEl = document.getElementById('tbContent');
  if (contentEl) contentEl.value = '';
  const familyEl = document.getElementById('tbFontFamily');
  if (familyEl) familyEl.value = 'Arial, sans-serif';
  const sizeEl = document.getElementById('tbFontSize');
  if (sizeEl) sizeEl.value = 14;
  setTextBoxStyleButtons({ bold: false, italic: false, underline: false });
  const modal = document.getElementById('textBoxModal');
  if (modal) modal.style.display = 'flex';
}

// Called when double-clicking an existing text box to edit it
export function openTextBoxModalForEdit(textEl) {
  editingTextBox = textEl;
  pendingNewTextPos = null;
  const contentEl = document.getElementById('tbContent');
  if (contentEl) contentEl.value = textEl.text || '';
  const familyEl = document.getElementById('tbFontFamily');
  if (familyEl) familyEl.value = textEl.fontFamily || 'Arial, sans-serif';
  const sizeEl = document.getElementById('tbFontSize');
  if (sizeEl) sizeEl.value = textEl.fontSize || 14;
  setTextBoxStyleButtons({ bold: textEl.bold, italic: textEl.italic, underline: textEl.underline });
  const modal = document.getElementById('textBoxModal');
  if (modal) modal.style.display = 'flex';
}

export function closeTextBoxModal() {
  const modal = document.getElementById('textBoxModal');
  if (modal) modal.style.display = 'none';
  if (pendingNewTextPos) state.currentTool = 'select'; // was mid-placement — cancelling shouldn't leave the tool armed
  editingTextBox = null;
  pendingNewTextPos = null;
}

export function toggleTextBoxStyle(style) {
  const idByStyle = { bold: 'tbBoldBtn', italic: 'tbItalicBtn', underline: 'tbUnderlineBtn' };
  document.getElementById(idByStyle[style])?.classList.toggle('btn-primary');
}

export function saveTextBoxModal() {
  const content = (document.getElementById('tbContent')?.value || '').trim();
  if (!content) { closeTextBoxModal(); return; }

  const fontFamily = document.getElementById('tbFontFamily')?.value || 'Arial, sans-serif';
  const fontSize = parseInt(document.getElementById('tbFontSize')?.value, 10) || 14;
  const bold = document.getElementById('tbBoldBtn')?.classList.contains('btn-primary') || false;
  const italic = document.getElementById('tbItalicBtn')?.classList.contains('btn-primary') || false;
  const underline = document.getElementById('tbUnderlineBtn')?.classList.contains('btn-primary') || false;

  pushHistory();

  if (editingTextBox) {
    editingTextBox.text = content;
    editingTextBox.fontFamily = fontFamily;
    editingTextBox.fontSize = fontSize;
    editingTextBox.bold = bold;
    editingTextBox.italic = italic;
    editingTextBox.underline = underline;
  } else if (pendingNewTextPos) {
    const sheet = getActiveSheet();
    if (!sheet.texts) sheet.texts = [];
    sheet.texts.push({
      id: Date.now(),
      x: pendingNewTextPos.x, y: pendingNewTextPos.y,
      text: content, fontFamily, fontSize, bold, italic, underline, rotation: 0
    });
    state.currentTool = 'select';
  }

  closeTextBoxModal();
  renderComponents(openEditModal);
  scheduleAutosave();
}

export function saveComponentDetails() {
  if (!editingComponent) return;

  // A child contact whose parent offers contacts has to be assigned one: it takes its terminal numbers from it.
  {
    const wantsParent = !document.getElementById('editCompIsParent').checked && document.getElementById('editCompParentId').value;
    const refEl = document.getElementById('editCompContactRef');
    if (wantsParent && refEl && document.getElementById('contactAssignRow').style.display !== 'none' && refEl.value === '' && childContactKind(editingComponent.type)) {
      refEl.style.outline = '2px solid var(--danger, #dc2626)';
      refEl.focus();
      const hint = document.getElementById('contactAssignHint');
      if (hint) hint.textContent = 'Choose which contact of the parent this is.';
      return;
    }
  }

  pushHistory();
  editingComponent.label = document.getElementById('editCompLabel').value.trim();
  editingComponent.isParent = document.getElementById('editCompIsParent').checked;

  if (editingComponent.type === 'terminal') {
    editingComponent.fillColor = document.getElementById('editCompFillColor').value;
  }

  if (!editingComponent.isParent) {
    const parentVal = document.getElementById('editCompParentId').value;
    editingComponent.parentId = parentVal ? parentVal : null;
    editingComponent.contactNo = document.getElementById('editCompContactNo').value.trim();
    if (!(document.getElementById('editCompContactRef')?.value)) editingComponent.contactNo = '';   // no contact chosen: no number (one typed before contacts existed is kept while it stays chosen)
    delete editingComponent.contactRef;
    editingComponent.contactTerms = termsFor(childContactKind(editingComponent.type), editingComponent.contactNo);

    if (editingComponent.parentId) {
      const parent = findComponentById(editingComponent.parentId);
      // assigned one of the parent's contacts: its terminal numbers, and a link that follows later changes to them
      const refVal = document.getElementById('editCompContactRef')?.value || '';
      const taken = parent && refVal && refVal !== '__custom' ? childFieldsFor(parent, splitChoice(refVal)) : null;
      if (taken) { editingComponent.contactRef = taken.contactRef; editingComponent.contactNo = taken.contactNo; editingComponent.contactTerms = taken.contactTerms; }
      if (parent) {
        const contactSuffix = editingComponent.contactNo ? `.${editingComponent.contactNo}` : '';
        editingComponent.label = `${parent.label}${contactSuffix}`;
        document.getElementById('editCompLabel').value = editingComponent.label;
      }
    }
  } else {
    editingComponent.parentId = null;
    editingComponent.contactNo = '';
    delete editingComponent.contactRef; delete editingComponent.contactTerms;
    updateChildLabels(editingComponent);
  }
  // A contact block of a joined coil can be drawn linked to its partner on the other coil (the interlock symbol).
  {
    const wantId = editingComponent.parentId ? (document.getElementById('editCompLinkTo')?.value || '') : '';
    const prev = editingComponent.linkContactId;
    const sheetComps = getActiveSheet()?.components || [];
    const partner = wantId ? sheetComps.find(c => String(c.id) === String(wantId)) : null;
    if (prev !== undefined && prev !== null && (!partner || String(prev) !== String(partner.id))) {
      const old = sheetComps.find(c => String(c.id) === String(prev));
      if (old && String(old.linkContactId) === String(editingComponent.id)) delete old.linkContactId;
    }
    if (partner && String(partner.id) !== String(editingComponent.id)) {
      if (partner.linkContactId !== undefined && partner.linkContactId !== null && String(partner.linkContactId) !== String(editingComponent.id)) {
        const stale = sheetComps.find(c => String(c.id) === String(partner.linkContactId));
        if (stale && String(stale.linkContactId) === String(partner.id)) delete stale.linkContactId;
      }
      editingComponent.linkContactId = partner.id; partner.linkContactId = editingComponent.id;
    } else delete editingComponent.linkContactId;
  }
  // A coil mechanically joined to another (forward/reverse contactor) is the same physical device.
  const jointVal = editingComponent.isParent ? (document.getElementById('editCompJointTo')?.value || '') : '';
  const jointMain = jointVal ? findComponentById(jointVal) : null;
  if (jointMain && String(jointMain.id) !== String(editingComponent.id)) editingComponent.jointToId = jointMain.id; else delete editingComponent.jointToId;
  if (editingComponent.isParent && document.getElementById('editCompLinkChildren')?.checked) editingComponent.linkChildren = true; else delete editingComponent.linkChildren;   // dotted lines from a parent to its children on the sheet

  // Value / Make / Model / Description: a child's identity IS its parent's for
  // these purposes (see getEffectiveComponentDetails), so nothing independent
  // is stored on it — that avoids a stale copy ever drifting from the parent.
  // Auxiliary items are the same story in reverse: they only mean anything on
  // a part with its own independent BOM identity, so a child (which has none)
  // doesn't keep any it might be carrying from before it was parented.
  const ownDetails = !!editingComponent.parentId && ownsPartDetails(editingComponent, findComponentById(editingComponent.parentId));   // a push button's contact or lamp is a part of its own
  if ((editingComponent.parentId || editingComponent.jointToId) && !ownDetails) {
    editingComponent.value = '';
    editingComponent.make = '';
    editingComponent.modelNo = '';
    // a coil joined to another keeps its own description (Motor FWD / Motor REV); a contact has none of its own
    editingComponent.description = (!editingComponent.parentId && editingComponent.jointToId) ? document.getElementById('editCompDesc').value.trim() : '';
    if (editingComponent.parentId) {
      editingComponent.auxItems = [];
      delete editingComponent.contacts;
      delete editingComponent.selfContactRef; delete editingComponent.selfTerms;
    } else {   // a coil joined to another has its own contacts and aux items (each contactor carries its own blocks)
      editingComponent.auxItems = collectAuxItemsFromRows();
      if (editingComponent.isParent) editingComponent.contacts = collectContactRows(document.getElementById('ownContactsList')); else delete editingComponent.contacts;
      { const ch = editingComponent.isParent ? splitChoice(document.getElementById('editCompSelfContact')?.value || '') : null;
        const set = ch && uiContactSets().find(x => x.key === ch.set); const c = set && set.contacts.find(x => x.id === ch.id);
        if (c) { editingComponent.selfContactRef = { set: ch.set, id: ch.id }; editingComponent.selfTerms = termsFor(c.kind, c.terms); }
        else { delete editingComponent.selfContactRef; delete editingComponent.selfTerms; } }
      if (editingComponent.isParent) { syncChildContacts(editingComponent, state.sheets); updateChildLabels(editingComponent); }
    }
  } else {
    editingComponent.value = document.getElementById('editCompValue').value.trim();
    editingComponent.make = document.getElementById('editCompMake').value.trim();
    editingComponent.modelNo = document.getElementById('editCompModel').value.trim();
    editingComponent.description = document.getElementById('editCompDesc').value.trim();
    editingComponent.auxItems = collectAuxItemsFromRows();
    // the contacts a parent offers; only a parent has any (an auxiliary item's are kept inside the item)
    if (editingComponent.isParent) editingComponent.contacts = collectContactRows(document.getElementById('ownContactsList')); else delete editingComponent.contacts;
    { // the contact this parent's own symbol stands for (a push button's, taken from a contact block fitted to it)
      const selV = editingComponent.isParent ? (document.getElementById('editCompSelfContact')?.value || '') : '';
      const ch = selV ? splitChoice(selV) : null;
      const set = ch && uiContactSets().find(x => x.key === ch.set);
      const c = set && set.contacts.find(x => x.id === ch.id);
      if (c) { editingComponent.selfContactRef = { set: ch.set, id: ch.id }; editingComponent.selfTerms = termsFor(c.kind, c.terms); }
      else { delete editingComponent.selfContactRef; delete editingComponent.selfTerms; }
    }
    if (editingComponent.isParent) { syncChildContacts(editingComponent, state.sheets); updateChildLabels(editingComponent); }
  }

  // A child's own location field is read-only (inherits from its parent —
  // see refreshEditModalDerivedFields), so it's only actually SAVED here for
  // a parent or standalone component — a child's effective location is
  // worked out fresh from its parent every time, never stored on itself.
  if (!editingComponent.parentId && !editingComponent.jointToId) {
    const locVal = document.getElementById('editCompLocation').value;
    editingComponent.location = locVal || null;
  }

  const hiddenFields = [['editShowDesignator', 'designator'], ['editShowValue', 'value'], ['editShowModel', 'modelNo'], ['editShowDesc', 'description'], ['editShowRef', 'crossRef']]
    .filter(([id]) => { const el = document.getElementById(id); return el && !el.checked; }).map(([, key]) => key);
  if (hiddenFields.length) editingComponent.hiddenFields = hiddenFields; else delete editingComponent.hiddenFields;

  savePlcFunctionRows(editingComponent);
  const noteInput = document.getElementById('editCompNote');
  const noteDef = window.customSymbolDefinitions?.[editingComponent.type];
  if (noteInput && noteDef && (noteDef.plc || noteDef.drive)) {
    const note = noteInput.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (note) editingComponent.note = note; else delete editingComponent.note;
  }

  closeEditModal();
  renderComponents(openEditModal);
  scheduleAutosave();
}

// ---- the functions of one placed PLC module ----
// Shown in Edit Component Details for a PLC module only: every input and output with its function
// for THIS module on the sheet. The library module's functions are the starting point.
function renderPlcFunctionRows(comp) {
  const old = document.getElementById('editPlcFns');
  if (old) old.remove();
  const def = window.customSymbolDefinitions?.[comp.type];
  const isDrive = !!(def && def.drive);
  const channels = isDrive ? driveChannels(def).map(c => ({ address: c.name, fn: c.fn })) : (def && def.plc ? plcChannels(def) : []);
  if (!channels.length) return;
  const actions = document.querySelector('#editComponentModal .modal-actions');
  if (!actions) return;
  const suggestions = isDrive ? DRIVE_FUNCTION_SUGGESTIONS : PLC_FUNCTION_SUGGESTIONS, limit = isDrive ? DRIVE_LIMITS.fn : PLC_LIMITS.fn;
  const valueOf = (c) => (isDrive ? driveFunctionFor(comp, c.address, c.fn) : plcFunctionFor(comp, c.address, c.fn));
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const box = document.createElement('div');
  box.id = 'editPlcFns';
  box.innerHTML = `<label>${isDrive ? 'Control terminal functions' : 'Input and output functions'} <span style="font-weight:400; color:var(--text-muted); font-size:11px;">\u2014 for this ${isDrive ? 'drive' : 'module'} only; the library ${isDrive ? 'drive' : 'module'} is unchanged</span></label>
    <datalist id="plcFnList">${suggestions.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
    <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 8px; align-items:center; max-height:240px; overflow-y:auto; margin-bottom:8px;">
      ${channels.map(c => `<span style="font-size:12px; font-weight:600;">${esc(c.address)}</span><input type="text" list="plcFnList" data-plc-addr="${esc(c.address)}" data-plc-lib="${esc(c.fn)}" maxlength="${limit}" placeholder="Function" value="${esc(valueOf(c))}" style="margin:0;">`).join('')}
    </div>
    <button type="button" class="btn btn-ghost" style="width:100%; margin-bottom:8px;" onclick="resetPlcFunctionRows()">Reset to the library ${isDrive ? 'drive' : 'module'}'s functions</button>`;
  actions.parentNode.insertBefore(box, actions);
}

export function resetPlcFunctionRows() {
  document.querySelectorAll('#editPlcFns input[data-plc-addr]').forEach(i => { i.value = i.dataset.plcLib; });
}

function savePlcFunctionRows(comp) {
  const inputs = document.querySelectorAll('#editPlcFns input[data-plc-addr]');
  if (!inputs.length) return;
  const def = window.customSymbolDefinitions?.[comp.type];
  const fns = {};
  inputs.forEach(i => { fns[i.dataset.plcAddr] = i.value; });
  if (def && def.drive) {
    const kept = cleanDriveFns(def, fns);
    if (Object.keys(kept).length) comp.driveFns = kept; else delete comp.driveFns;
    return;
  }
  const kept = cleanPlcFns(def, fns);
  if (Object.keys(kept).length) comp.plcFns = kept; else delete comp.plcFns;
}

function updateChildLabels(parentComp) {
  state.sheets.forEach(sheet => {
    (sheet.components || []).forEach(child => {
      if (child.parentId && String(child.parentId) === String(parentComp.id)) {
        const contactSuffix = child.contactNo ? `.${child.contactNo}` : '';
        child.label = `${parentComp.label}${contactSuffix}`;
      }
    });
  });
}

export function findComponentById(id) {
  if (id === null || id === undefined || id === '') return null;
  
  for (let i = 0; i < state.sheets.length; i++) {
    const comp = (state.sheets[i].components || []).find(c => String(c.id) === String(id));
    if (comp) return { ...comp, sheetIndex: i };
  }
  return null;
}

export function getCrossReferenceData(comp) {
  if (comp.parentId) {
    const parent = findComponentById(comp.parentId);
    if (parent) {
      return { type: 'child', text: `Ref: ${getRefText(parent.x, parent.y, parent.sheetIndex)}` };
    }
  }

  if (comp.isParent) {
    const contacts = [];
    state.sheets.forEach((sheet, idx) => {
      (sheet.components || []).forEach(c => {
        if (c.parentId && String(c.parentId) === String(comp.id)) {
          const term = c.contactNo ? ` [${c.contactNo}]` : '';
          contacts.push({ text: `${getRefText(c.x, c.y, idx)}${term}`, symbolType: c.type });
        }
      });
    });
    return { type: 'parent', contacts: contacts };
  }

  return null;
}

export function toggleParentOptions(isParent) {
  const pRow = document.getElementById('parentRefRow');
  const cRow = document.getElementById('contactNoRow');
  if (pRow) pRow.style.display = isParent ? 'none' : 'block';
  if (cRow) cRow.style.display = isParent ? 'none' : 'block';
  const jRow = document.getElementById('jointRow');
  if (jRow) jRow.style.display = isParent ? 'block' : 'none';
  const lRow = document.getElementById('linkChildrenRow');
  if (lRow) lRow.style.display = isParent ? 'flex' : 'none';
  refreshEditModalDerivedFields();
}

// A component's Value / Make / Model / Description for every purpose OTHER
// than the edit modal's own inputs (the on-sheet label, the BOM, anywhere
// else): a child's own copies of these are never stored (see
// saveComponentDetails), so this is the one place that resolves them —
// straight from the parent for a child, or the component's own fields
// otherwise. Bound to window (like findComponentById beside it) so
// 3_schematic_engine.js can reach it without a circular import.
export function getEffectiveComponentDetails(comp) {
  if ((comp.parentId || comp.jointToId) && !(comp.parentId && ownsPartDetails(comp, findComponentById(comp.parentId)))) {   // (a push button's contacts keep their own)
    const parent = findComponentById(comp.parentId || comp.jointToId);
    // A coil joined to another has its own description (Motor FWD / Motor REV), falling back to the main coil's.
    if (parent) return { value: parent.value || '', make: parent.make || '', modelNo: parent.modelNo || '', description: (comp.jointToId && !comp.parentId && comp.description) ? comp.description : (parent.description || '') };
  }
  return { value: comp.value || '', make: comp.make || '', modelNo: comp.modelNo || '', description: comp.description || '' };
}

// Keeps the edit modal's Value / Make / Model / Description fields, and the
// Auxiliary Items section's visibility, in step with the Is Parent checkbox
// and the Parent Designation dropdown — called whenever either changes, and
// once from openEditModal. A component becomes a "child" (no independent
// part identity of its own) the moment a parent is selected and Is Parent is
// unchecked; for a child these fields show the PARENT's values, disabled, so
// there's never a separate copy to fall out of sync — see
// getEffectiveComponentDetails, which every other reader goes through.
export function refreshEditModalDerivedFields() {
  const isParentEl = document.getElementById('editCompIsParent');
  const parentSelect = document.getElementById('editCompParentId');
  const isParent = !!(isParentEl && isParentEl.checked);
  const parentIdVal = (parentSelect && parentSelect.value) || '';
  const jointVal = isParent ? ((document.getElementById('editCompJointTo') || {}).value || '') : '';
  const isChild = (!isParent && !!parentIdVal) || !!jointVal;   // a coil joined to another shares its part details just as a contact shares its coil's
  const sourceId = isParent ? jointVal : parentIdVal;

  // Auxiliary items (and the contacts a part offers) belong to a parent. A part that is not one but already carries auxiliary
  // items from before keeps them in view, so nothing is hidden on it without anyone seeing it go.
  const auxSection = document.getElementById('auxItemsSection');
  const hasOldAux = !!(editingComponent && (editingComponent.auxItems || []).length);
  if (auxSection) auxSection.style.display = ((isParent || (!isChild && hasOldAux)) ? 'block' : 'none');   // (a coil joined to another still offers its own contacts)
  const ownBlock = document.getElementById('ownContactsBlock');
  if (ownBlock) ownBlock.style.display = isParent ? 'block' : 'none';
  refreshSelfContact();
  { const ab = document.getElementById('auxItemsBlock'); if (ab) ab.style.display = (pushButtonEditing() && !(editingComponent && (editingComponent.auxItems || []).length)) ? 'none' : ''; }   // each contact of a push button is a component of its own, so no auxiliary items
  { const pb = pushButtonEditing(), vb = valveEditing(); const d = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
    d('ownBtnLamp', pb && !vb); d('ownBtnP3', !pb && !vb); d('ownBtnNo', !vb); d('ownBtnNc', !vb); d('ownBtnSol', vb);
    if (vb && editingComponent && document.getElementById('editCompIsParent')?.checked && !document.querySelector('#ownContactsList .contact-row')) {   // a new valve parent starts with the solenoids its symbol has
      const vdef = window.customSymbolDefinitions[editingComponent.type];
      suggestValveSolenoids(vdef).forEach(c => appendContactRow(document.getElementById('ownContactsList'), { id: newContactId(), kind: 'sol', terms: c.terms }));
    } }
  refreshLinkDropdown(isParent ? '' : parentIdVal);
  refreshContactAssign(isParent ? '' : parentIdVal);

  const valueEl = document.getElementById('editCompValue');
  const makeEl = document.getElementById('editCompMake');
  const modelEl = document.getElementById('editCompModel');
  const descEl = document.getElementById('editCompDesc');
  const locationEl = document.getElementById('editCompLocation');
  const fields = [valueEl, makeEl, modelEl, descEl];

  const wasInherited = !!(descEl && descEl.disabled);
  const ownDet = isChild && !isParent && !jointVal && ownsPartDetails({ parentId: sourceId }, findComponentById(sourceId));   // a push button's contacts and lamps have details of their own
  if (isChild && !ownDet) {
    const parent = findComponentById(sourceId);
    if (valueEl) valueEl.value = (parent && parent.value) || '';
    if (makeEl) makeEl.value = (parent && parent.make) || '';
    if (modelEl) modelEl.value = (parent && parent.modelNo) || '';
    if (jointVal) {
      // A joined coil keeps a description of its own (Motor FWD / Motor REV); the rest comes from the main coil.
      [valueEl, makeEl, modelEl].forEach(el => { if (el) { el.disabled = true; el.placeholder = 'Inherited from the main coil'; } });
      if (descEl) {
        if (wasInherited) descEl.value = (editingComponent && editingComponent.description) || '';
        descEl.disabled = false; descEl.placeholder = "Defaults to the main coil's description";
      }
    } else {
      if (descEl) descEl.value = (parent && parent.description) || '';
      fields.forEach(el => { if (el) { el.disabled = true; el.placeholder = 'Inherited from parent'; } });
    }
    // A child's own location follows its parent's too (see
    // getEffectiveLocationId) — shown here for clarity, but not editable
    // independently of it, same reasoning as Value/Make/Model/Description.
    if (locationEl) { populateLocationDropdown('editCompLocation', (parent && parent.location) || '', { includeNone: true, noneLabel: '-- Inherits from sheet --' }); locationEl.disabled = true; }
  } else {
    // Only restore each field's OWN value when it's actually coming OUT of
    // the disabled "inherited" state (the checkbox/dropdown were just
    // switched away from a parent) — never when it was already editable, or
    // an unrelated toggle would silently discard whatever was just typed.
    const wasDisabled = !!(valueEl && valueEl.disabled);
    if (wasDisabled && editingComponent) {
      if (valueEl) valueEl.value = editingComponent.value || '';
      if (makeEl) makeEl.value = editingComponent.make || '';
      if (modelEl) modelEl.value = editingComponent.modelNo || '';
      if (descEl) descEl.value = editingComponent.description || '';
    }
    fields.forEach(el => { if (el) { el.disabled = false; el.placeholder = ''; } });
    if (locationEl) {
      const wasLocationDisabled = locationEl.disabled;
      locationEl.disabled = isFreePlan(); // leaving "inherited" frees it up — unless Locations are not available at all
      populateLocationDropdown('editCompLocation', wasLocationDisabled ? ((editingComponent && editingComponent.location) || '') : locationEl.value, { includeNone: true, noneLabel: '-- Inherits from sheet --' });
    }
    if (ownDet && locationEl) {   // still on the button it belongs to, so its location follows the parent's
      const par = findComponentById(sourceId);
      populateLocationDropdown('editCompLocation', (par && par.location) || '', { includeNone: true, noneLabel: '-- Inherits from sheet --' }); locationEl.disabled = true;
    }
  }
  { const pl = document.getElementById('partsLibRow'); const mk = document.getElementById('editCompMake'); if (pl) pl.style.display = (mk && mk.disabled) ? 'none' : 'flex'; }   // not on a child, whose details are its parent's
}

let nextAuxItemRowId = 1;

// Rebuilds the Auxiliary Items list from a component's stored auxItems —
// called once each time the modal opens. Built with DOM calls rather than an
// HTML string so a Make/Model/Description value can never be read back as
// markup, matching the convention used for the custom-symbol list.
function renderAuxItemsRows(items) {
  const list = document.getElementById('auxItemsList');
  if (!list) return;
  list.innerHTML = '';
  (items || []).forEach(item => addAuxItemRow(item));
}

// Appends one blank (or prefilled, when restoring saved items) auxiliary-item
// row: Make, Model No., Description, Qty, and a remove button. Exported so
// the modal's "+ Add auxiliary item" button can call it directly.
export function addAuxItemRow(prefill) {
  const list = document.getElementById('auxItemsList');
  if (!list) return;

  // Two lines per item now that there are five fields: Type + Make on top,
  // Model No. + Description + Qty + remove below.
  const row = document.createElement('div');
  row.className = 'aux-item-row';
  row.style.cssText = 'display:flex; flex-direction:column; gap:4px; padding:6px; border:1px solid var(--border-light); border-radius:var(--radius-sm);';
  row.dataset.auxRowId = (prefill && prefill.id && String(prefill.id).startsWith('aux_')) ? String(prefill.id) : newAuxId();   // stable across edits: child contacts refer to it

  const field = (cls, placeholder, value, flex) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.placeholder = placeholder;
    input.value = value || '';
    input.style.cssText = `flex:${flex}; min-width:0;`;
    return input;
  };
  const type = field('aux-type', 'Type (e.g. Auxiliary Contact Block)', prefill?.type, 1);
  const make = field('aux-make', 'Make', prefill?.make, 1);
  const model = field('aux-model', 'Model No.', prefill?.modelNo, 1);
  const desc = field('aux-desc', 'Description', prefill?.description, 1.3);
  const qty = field('aux-qty', 'Qty', prefill?.qty ?? 1, '0 0 46px');
  qty.type = 'number';
  qty.min = '1';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon';
  removeBtn.title = 'Remove this auxiliary item';
  removeBtn.textContent = '\u2715';
  removeBtn.addEventListener('click', () => row.remove());

  const topLine = document.createElement('div');
  topLine.style.cssText = 'display:flex; gap:6px;';
  [type, make].forEach(el => topLine.appendChild(el));

  const bottomLine = document.createElement('div');
  bottomLine.style.cssText = 'display:flex; gap:6px; align-items:center;';
  const libBtn = document.createElement('button');   // fill Make / Model / Description from the parts library
  libBtn.type = 'button'; libBtn.className = 'btn btn-ghost'; libBtn.textContent = 'Library'; libBtn.title = 'Choose from the parts library';
  libBtn.style.cssText = 'padding:2px 8px; font-size:11px;';
  libBtn.addEventListener('click', () => { if (typeof window.openPartsPicker === 'function') window.openPartsPicker((p) => { if (p.category && !type.value.trim()) type.value = p.category; make.value = p.make; model.value = p.model_no; desc.value = p.description; applyAuxRowExtras(row, p.extra); }); });
  const saveLibBtn = document.createElement('button');   // keep this item, with its contacts, in the parts library
  saveLibBtn.type = 'button'; saveLibBtn.className = 'btn btn-ghost'; saveLibBtn.textContent = 'Save to library'; saveLibBtn.title = 'Save this item and its contacts to the parts library';
  saveLibBtn.style.cssText = 'padding:2px 8px; font-size:11px;';
  saveLibBtn.addEventListener('click', () => { if (typeof window.savePartEntry === 'function') window.savePartEntry({ category: type.value.trim(), make: make.value.trim(), model_no: model.value.trim(), description: desc.value.trim(), value: '', extra: collectAuxRowExtras(row) }); });
  if (document.getElementById('partsLibRow')?.children.length) { topLine.appendChild(libBtn); topLine.appendChild(saveLibBtn); }   // only where the library is offered
  [model, desc, qty, removeBtn].forEach(el => bottomLine.appendChild(el));

  row.appendChild(topLine);
  row.appendChild(bottomLine);

  // the contacts this item gives (a contact block: 2 x NO and 2 x NC), each with its terminal numbers
  const contactsBox = document.createElement('div');
  contactsBox.style.cssText = 'display:flex; flex-direction:column; gap:4px; padding-top:2px;';
  const cList = document.createElement('div');
  cList.className = 'aux-contacts';
  cList.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
  const cBar = document.createElement('div');
  cBar.style.cssText = 'display:flex; gap:6px; align-items:center; font-size:11px; color:var(--text-muted);';
  cBar.appendChild(document.createTextNode('Contacts on this item:'));
  (valveEditing() ? ['sol'] : pushButtonEditing() ? ['no', 'nc', 'lamp'] : ['no', 'nc', 'p3']).forEach(kind => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost'; b.style.cssText = 'padding:1px 8px; font-size:11px;';
    b.textContent = kind === 'sol' ? '+ Valve coil' : kind === 'p3' ? '+ 3-pole power' : kind === 'lamp' ? '+ Lamp' : `+ ${kindText(kind)}`;
    b.addEventListener('click', () => appendContactRow(cList, { id: newContactId(), kind, terms: suggestTermsFor(kind) }));
    cBar.appendChild(b);
  });
  (prefill?.contacts || []).forEach(c => appendContactRow(cList, c));
  contactsBox.appendChild(cBar);
  contactsBox.appendChild(cList);
  row.appendChild(contactsBox);
  list.appendChild(row);
}

// ---- the contacts a part offers (its own, and those of each auxiliary item) ----

// The next contact's position across the whole part, so the numbers run on: 13-14, 23-24, 33-34 ... then the block's 53-54...
function nextContactPosition() {
  return Array.from(document.querySelectorAll('#auxItemsSection .contact-row')).filter(r => r.dataset.kind !== 'p3' && r.dataset.kind !== 'lamp').length + 1;   // power contacts and lamps do not take a control position
}

// The contacts as they are in the dialog right now (own and each auxiliary item's), so one can be picked straight after being added.
function uiContactSets() {
  const sets = [];
  const own = collectContactRows(document.getElementById('ownContactsList'));
  if (own.length) sets.push({ key: 'own', name: 'This part', contacts: own });
  Array.from(document.getElementById('auxItemsList')?.children || []).forEach(row => {
    const contacts = collectContactRows(row.querySelector('.aux-contacts'));
    if (!contacts.length) return;
    const name = [row.querySelector('.aux-type')?.value.trim(), row.querySelector('.aux-model')?.value.trim()].filter(Boolean).join(' ') || row.querySelector('.aux-make')?.value.trim() || 'Auxiliary item';
    sets.push({ key: `aux:${row.dataset.auxRowId}`, name, contacts });
  });
  return sets;
}

// Is the part being edited a push button (its own symbol, or a PB designator)? It gets lamps and no 3-pole power contact.
function valveEditing() {
  const def = editingComponent && window.customSymbolDefinitions ? window.customSymbolDefinitions[editingComponent.type] : null;
  return isValveBody(editingComponent, def);
}
function pushButtonEditing() {
  const def = editingComponent && window.customSymbolDefinitions ? window.customSymbolDefinitions[editingComponent.type] : null;
  return isPushButtonParent(editingComponent, def);
}

// "This symbol is contact": offered on a parent whose symbol is a single contact (a push button), listing the part's contacts that no
// child has taken.
export function refreshSelfContact() {
  const row = document.getElementById('editCompSelfContact')?.closest('#selfContactRow'), sel = document.getElementById('editCompSelfContact');
  if (!row || !sel || !editingComponent) return;
  const def = window.customSymbolDefinitions ? window.customSymbolDefinitions[editingComponent.type] : null;
  const show = !!document.getElementById('editCompIsParent')?.checked && hasStandardContactPins(def) && !isValveBody(editingComponent, def);
  row.style.display = show ? 'block' : 'none';
  if (!show) return;
  const keep = sel.value || sel.dataset.initial || '';
  const used = contactUsage(editingComponent.id, state.sheets);
  sel.innerHTML = '';
  const add = (parentEl, value, text, disabled) => { const o = document.createElement('option'); o.value = value; o.textContent = text; if (disabled) o.disabled = true; parentEl.appendChild(o); };
  add(sel, '', '-- Not allocated --');
  uiContactSets().forEach(set => {
    const group = document.createElement('optgroup'); group.label = set.name;
    set.contacts.filter(c => (c.kind === 'no' || c.kind === 'nc') && (!def.pushButton || c.kind === def.pushButton)).forEach(c => {
      const v = choiceValue(set.key, c.id);
      const taken = (used.get(v) || []).some(u => String(u.comp.id) !== String(editingComponent.id));
      add(group, v, `${kindText(c.kind)}  ${c.terms}${taken ? '  (in use)' : ''}`, taken);
    });
    if (group.children.length) sel.appendChild(group);
  });
  if (keep && Array.from(sel.options).some(o => o.value === keep)) sel.value = keep;
}

// The terminal numbers offered for a new contact: a push button's are always 1-2 (NC), 3-4 (NO) and X1-X2 (lamp); anything else, 13-14, 23-24...
function suggestTermsFor(kind) {
  const def = editingComponent && window.customSymbolDefinitions ? window.customSymbolDefinitions[editingComponent.type] : null;
  if (kind !== 'p3' && isPushButtonParent(editingComponent, def)) {   // (a push button has no 3-pole contact)
    return suggestPushButtonTerminals(kind);
  }
  return suggestTerminals(kind, nextContactPosition());
}

function appendContactRow(listEl, contact) {
  if (!listEl) return;
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.dataset.contactId = contact.id || newContactId();
  row.dataset.kind = ['nc', 'p3', 'lamp', 'sol'].includes(contact.kind) ? contact.kind : 'no';
  row.style.cssText = 'display:flex; gap:6px; align-items:center;';
  const badge = document.createElement('span');
  badge.textContent = kindText(row.dataset.kind);
  badge.style.cssText = 'font-size:11px; font-weight:600; min-width:28px; text-align:center; padding:2px 4px; border:1px solid var(--border-light); border-radius:var(--radius-sm);';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'contact-terms'; input.placeholder = row.dataset.kind === 'nc' ? '21-22' : row.dataset.kind === 'p3' ? '1-2, 3-4, 5-6' : row.dataset.kind === 'lamp' ? 'X1-X2' : row.dataset.kind === 'sol' ? '14' : '13-14';
  input.value = contact.terms || '';
  input.style.cssText = row.dataset.kind === 'p3' ? 'width:150px; min-width:0;' : 'width:90px; min-width:0;';
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'btn-icon'; rm.title = 'Remove this contact'; rm.textContent = '\u2715';
  rm.addEventListener('click', () => row.remove());
  [badge, input, rm].forEach(el => row.appendChild(el));
  listEl.appendChild(row);
}

function collectContactRows(listEl) {
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll('.contact-row'))
    .map(r => ({ id: r.dataset.contactId, kind: ['nc', 'p3', 'lamp', 'sol'].includes(r.dataset.kind) ? r.dataset.kind : 'no', terms: r.querySelector('.contact-terms')?.value.trim() || '' }))
    .filter(c => c.terms);
}

function renderOwnContacts(list) {
  const el = document.getElementById('ownContactsList');
  if (!el) return;
  el.innerHTML = '';
  (list || []).forEach(c => appendContactRow(el, c));
}

export function addOwnContactRow(kind) {
  appendContactRow(document.getElementById('ownContactsList'), { id: newContactId(), kind, terms: suggestTermsFor(kind) });
}

// A child contact picks which of its parent's contacts it is; the choice supplies its terminal numbers. The contacts another
// child already has are greyed out. (A number typed before contacts existed is kept as it was, offered as the first choice.)
function refreshContactAssign(parentIdVal) {
  const row = document.getElementById('contactAssignRow'), select = document.getElementById('editCompContactRef');
  if (!row || !select || !editingComponent) return;
  const parent = parentIdVal ? findComponentById(parentIdVal) : null;
  if (!parent) { row.style.display = 'none'; select.innerHTML = ''; return; }
  const sets = contactSetsOf(parent);
  const kind = childContactKind(editingComponent.type);   // a child NO / NC / power symbol is only offered contacts of its own kind
  const keep = select.value || select.dataset.initial || '';
  const used = contactUsage(parent.id, state.sheets);
  select.innerHTML = '';
  const add = (parentEl, value, text, disabled) => { const o = document.createElement('option'); o.value = value; o.textContent = text; if (disabled) o.disabled = true; parentEl.appendChild(o); return o; };
  add(select, '', '-- Choose a contact --');
  const typed = (!editingComponent.contactRef && editingComponent.contactNo) ? String(editingComponent.contactNo) : '';
  if (typed) add(select, '__custom', `${typed}  (as typed)`);
  let offered = 0;
  sets.forEach(set => {
    const group = document.createElement('optgroup'); group.label = set.name;
    set.contacts.filter(c => !kind || c.kind === kind).forEach(c => {
      const v = choiceValue(set.key, c.id);
      const taken = (used.get(v) || []).some(u => String(u.comp.id) !== String(editingComponent.id));
      add(group, v, `${kindText(c.kind)}  ${c.terms}${taken ? '  (in use)' : ''}`, taken);
      offered++;
    });
    if (group.children.length) select.appendChild(group);
  });
  select.style.outline = '';
  row.style.display = 'block';
  const hint = document.getElementById('contactAssignHint');
  if (!offered) {
    select.disabled = !typed;
    if (hint) hint.textContent = sets.length ? 'This parent has no contact of this kind. Add one on the parent (Contacts).' : 'This parent has no contacts yet. Add them on the parent (Contacts).';
    select.value = typed ? '__custom' : '';
    return;
  }
  select.disabled = false;
  if (hint) hint.textContent = kind === 'sol' ? 'Which solenoid of the valve this coil operates (14, 12). The port is shown on the symbol.' : 'Which contact of the parent this is. Its terminal numbers are shown on the symbol.';
  const had = editingComponent.contactRef ? choiceValue(editingComponent.contactRef.set, editingComponent.contactRef.id) : '';
  const want = keep || had || (typed ? '__custom' : '');
  select.value = want;
  if (select.value !== want) select.value = '';
  onContactRefChange(true);
}

export function onContactRefChange(quiet) {
  const select = document.getElementById('editCompContactRef');
  const noInput = document.getElementById('editCompContactNo');
  if (!select) return;
  select.dataset.initial = select.value;
  select.style.outline = '';
  const parentIdVal = document.getElementById('editCompParentId').value;
  const parent = parentIdVal ? findComponentById(parentIdVal) : null;
  if (select.value && select.value !== '__custom' && parent) {
    const f = childFieldsFor(parent, splitChoice(select.value));
    if (f && noInput) noInput.value = f.contactNo;
  }
  if (!quiet && !select.value && parent) {
    const hint = document.getElementById('contactAssignHint');
    if (hint) hint.textContent = 'This parent offers contacts. Choose which one this is.';
  }
}


// ---- parts library: the aux items and contact assignments of a part, as plain data (no ids: new ones are made on use) ----
const slimContacts = (list) => (list || []).map(c => ({ kind: c.kind, terms: c.terms }));
export function collectPartExtras() {
  const isParent = !!document.getElementById('editCompIsParent')?.checked;
  const aux = collectAuxItemsFromRows();
  const own = isParent ? collectContactRows(document.getElementById('ownContactsList')) : [];
  const out = {};
  if (own.length) out.contacts = slimContacts(own);
  if (aux.length) out.auxItems = aux.map(a => ({ type: a.type, make: a.make, modelNo: a.modelNo, description: a.description, qty: a.qty, contacts: slimContacts(a.contacts) }));
  // the contact this part's own symbol stands for, kept by position
  const ch = isParent ? splitChoice(document.getElementById('editCompSelfContact')?.value || '') : null;
  if (ch) {
    if (ch.set === 'own') { const n = own.findIndex(c => c.id === ch.id); if (n >= 0) out.selfContact = { set: 'own', n }; }
    else { const ai = aux.findIndex(a => `aux:${a.id}` === ch.set); const n = ai >= 0 ? (aux[ai].contacts || []).findIndex(c => c.id === ch.id) : -1; if (ai >= 0 && n >= 0) out.selfContact = { set: 'aux', aux: ai, n }; }
  }
  return Object.keys(out).length ? out : null;
}
export function applyPartExtras(ex) {
  if (!ex) return;
  const fresh = (list) => (list || []).map(c => ({ id: newContactId(), kind: c.kind, terms: c.terms }));
  const ownEl = document.getElementById('ownContactsList');
  const list = document.getElementById('auxItemsList');
  const ownIds = [];
  if (ex.contacts && ownEl) { ownEl.innerHTML = ''; fresh(ex.contacts).forEach(c => { appendContactRow(ownEl, c); ownIds.push(c.id); }); }
  const auxIds = [];
  if (ex.auxItems && list) {
    list.innerHTML = '';
    ex.auxItems.forEach(a => { const id = newAuxId(); const contacts = fresh(a.contacts); addAuxItemRow({ ...a, id, contacts }); auxIds.push({ id, contacts }); });
  }
  const sc = document.getElementById('editCompSelfContact');
  if (sc) {
    const r = ex.selfContact;
    let v = '';
    if (r && r.set === 'own' && ownIds[r.n]) v = choiceValue('own', ownIds[r.n]);
    else if (r && r.set === 'aux' && auxIds[r.aux] && auxIds[r.aux].contacts[r.n]) v = choiceValue(`aux:${auxIds[r.aux].id}`, auxIds[r.aux].contacts[r.n].id);
    sc.dataset.initial = v; sc.value = '';
    refreshSelfContact();
  }
}
export function collectAuxRowExtras(row) {
  const c = collectContactRows(row.querySelector('.aux-contacts'));
  return c.length ? { contacts: slimContacts(c) } : null;
}
export function applyAuxRowExtras(row, ex) {
  const cl = row.querySelector('.aux-contacts');
  if (!cl || !ex || !ex.contacts || !ex.contacts.length) return;
  cl.innerHTML = '';
  ex.contacts.forEach(c => appendContactRow(cl, { id: newContactId(), kind: c.kind, terms: c.terms }));
}

// Reads the Auxiliary Items list back into plain data for saving. A row left
// completely blank (no Make, Model No. or Description typed) is dropped
// rather than saved as an empty BOM line.
function collectAuxItemsFromRows() {
  const list = document.getElementById('auxItemsList');
  if (!list) return [];
  return Array.from(list.children)
    .map(row => ({
      id: row.dataset.auxRowId,
      contacts: collectContactRows(row.querySelector('.aux-contacts')),
      type: row.querySelector('.aux-type')?.value.trim() || '',
      make: row.querySelector('.aux-make')?.value.trim() || '',
      modelNo: row.querySelector('.aux-model')?.value.trim() || '',
      description: row.querySelector('.aux-desc')?.value.trim() || '',
      qty: Math.max(1, parseInt(row.querySelector('.aux-qty')?.value, 10) || 1)
    }))
    .map(item => (item.contacts.length ? item : { ...item, contacts: undefined }))
    .filter(item => item.type || item.make || item.modelNo || item.description || (item.contacts && item.contacts.length));
}

// The coils a parent can be mechanically joined to: another parent that is not itself joined to something.
// A coil that others are already joined to stays the main one, so its own choice is switched off.
function populateJointDropdown(currentCompId, selectedId) {
  const select = document.getElementById('editCompJointTo');
  if (!select) return;
  select.innerHTML = '<option value="">-- None --</option>';
  let hasJoined = false;
  state.sheets.forEach(sheet => (sheet.components || []).forEach(c => { if (c.jointToId && String(c.jointToId) === String(currentCompId)) hasJoined = true; }));
  state.sheets.forEach((sheet, idx) => {
    (sheet.components || []).forEach(c => {
      if (String(c.id) === String(currentCompId) || !c.isParent || c.jointToId) return;
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `Sheet ${getSchematicSheetNumber(idx)}: ${c.label} (${c.modelNo || c.description || 'Coil'})`;
      if (selectedId !== undefined && selectedId !== null && String(c.id) === String(selectedId)) opt.selected = true;
      select.appendChild(opt);
    });
  });
  select.disabled = hasJoined;
  select.title = hasJoined ? 'Another coil is already joined to this one, so this is the main coil of the pair' : '';
}

// The contact blocks on this sheet this one can be drawn linked to: those of a coil joined to this contact's coil
// (the other coil of a forward/reverse pair). Hidden when there are none.
function refreshLinkDropdown(parentIdVal) {
  const row = document.getElementById('linkRow'), select = document.getElementById('editCompLinkTo');
  if (!row || !select || !editingComponent) return;
  const keep = select.value || select.dataset.initial || '';
  select.innerHTML = '<option value="">-- None --</option>';
  const coil = parentIdVal ? findComponentById(parentIdVal) : null;
  const sheetComps = getActiveSheet()?.components || [];
  const related = (otherCoil) => !!(coil && otherCoil && String(otherCoil.id) !== String(coil.id) &&
    ((coil.jointToId && String(coil.jointToId) === String(otherCoil.id)) || (otherCoil.jointToId && String(otherCoil.jointToId) === String(coil.id)) ||
     (coil.jointToId && otherCoil.jointToId && String(coil.jointToId) === String(otherCoil.jointToId))));
  let n = 0;
  sheetComps.forEach(c => {
    if (String(c.id) === String(editingComponent.id) || !c.parentId) return;
    const oc = findComponentById(c.parentId);
    if (!related(oc)) return;
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${oc.label}${c.contactNo ? '.' + c.contactNo : ''} (${c.type})`;
    select.appendChild(opt); n++;
  });
  select.value = keep;
  if (select.value !== keep) select.value = '';
  row.style.display = (parentIdVal && n > 0) ? 'block' : 'none';
}

function populateParentDropdown(currentCompId, selectedParentId) {
  const select = document.getElementById('editCompParentId');
  if (!select) return;

  select.innerHTML = '<option value="">-- None (Unassigned) --</option>';

  state.sheets.forEach((sheet, idx) => {
    (sheet.components || []).forEach(c => {
      if (c.id !== currentCompId && (c.isParent || (c.type && c.type.includes('coil')))) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `Sheet ${getSchematicSheetNumber(idx)}: ${c.label} (${c.description || 'Coil'})`;
        if (c.id === selectedParentId) opt.selected = true;
        select.appendChild(opt);
      }
    });
  });
}

// Bind cross-referencing lookups globally for engine access
window.findComponentById = findComponentById;
window.getCrossReferenceData = getCrossReferenceData;
window.getEffectiveComponentDetails = getEffectiveComponentDetails;
window.openWireEditModal = openWireEditModal;
window.openTextBoxModalForNew = openTextBoxModalForNew;
window.openTextBoxModalForEdit = openTextBoxModalForEdit;