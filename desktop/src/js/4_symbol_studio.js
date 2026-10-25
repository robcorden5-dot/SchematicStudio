// ==========================================
// 4. INTERACTIVE SYMBOL CREATOR STUDIO
// ==========================================
import { state, snapToGrid, pushHistory, scheduleAutosave, saveTextFile, normalizePathData, getDashArray, appAlert, appConfirm, appPrompt, pathTokens, SYMBOL_FONTS, symbolTextStyle, repairSymbolLibrary, getActiveSheet, getPrefixAndValue, nextLabelForType, isFreePlan } from './1_config_state.js';
import { ensureChildContactSymbols } from './39_contact_sets.js';
import { BUILTIN_LIBRARY } from './40_builtin_library.js';
import { snapComponentIntoWires } from './3_schematic_engine.js';
import { collectTerminalTableData, buildTerminalTableMatrix, buildTerminalTableGeometry, TERMINAL_TABLE_SYMBOL_PREFIX, listTerminalBlocks, countUnassignedTerminals } from './11_terminal_blocks.js';
export { compareDesignators } from './11_terminal_blocks.js';
import { stage } from './2_main_stage.js';
import { buildSymbolThumbnailSvg } from './9_symbol_thumbnails.js';

const STUDIO_SCALE = 0.5;
const INVERSE_STUDIO_SCALE = 1 / STUDIO_SCALE;

// Pins always snap to this fixed grid, regardless of zoom level — they're
// connection points, and need to land on a consistent grid so pins line up
// cleanly across symbols. Everything else uses this same grid below 1000%
// zoom and none at all from 1000% up — see getStudioSnapSize.
const PIN_SNAP_SIZE = 10;

// Arc drawing is click-based (center, then radius+start, then end angle) rather
// than a single drag like line/rect/circle, since an arc needs three degrees of
// freedom a single drag can't express. 0 = idle, 1 = center set (picking
// radius/start), 2 = radius+start set (picking end angle).
let arcPhase = 0;
let arcCenter = null;
let arcRadius = 0;
let arcStartAngle = 0;

function resetArcSequence() {
  arcPhase = 0;
  arcCenter = null;
  arcRadius = 0;
  arcStartAngle = 0;
  if (state.tempShape) { state.tempShape.destroy(); state.tempShape = null; }
}

// Everything snaps to the regular 10-unit grid (the same one pins use) at any
// zoom below 1000%, and snapping is OFF from 1000% up, where detail is placed
// freely by eye instead. Returns 0 for "don't snap" — see snapToStudioGrid.
// The threshold is compared on the same rounded percentage the zoom indicator
// displays, so whenever it reads 1000% or more snapping is off, and below that
// it's on — never a mismatch between what the screen says and what happens.
//
// Pins are unaffected either way: they always snap to PIN_SNAP_SIZE, at any
// zoom, because they're connection points and an off-grid pin wouldn't line
// up with the wires drawn to it on a sheet.
function getStudioSnapSize() {
  const scale = state.studioStage?.scaleX() || 1;
  const FREE_PLACEMENT_FROM_PERCENT = 1000;
  return Math.round(scale * 100) >= FREE_PLACEMENT_FROM_PERCENT ? 0 : PIN_SNAP_SIZE;
}

function getStudioOrigin() {
  const w = state.studioStage?.width() || 800;
  const h = state.studioStage?.height() || 500;
  return { x: w / 2, y: h / 2 };
}

// Snaps a world position to the studio's grid, anchored to the canvas ORIGIN
// rather than absolute zero. This is the actual fix for pins (and everything
// else) not lining up with the blue axis/"0" reference lines: those lines are
// drawn starting from the origin and stepping outward, but if the origin
// itself isn't already an exact multiple of the grid size (e.g. an odd canvas
// width), snapping to absolute zero can never land exactly back on them.
function snapToStudioGrid(worldX, worldY, gridSize) {
  // A grid size of 0 means "no snapping": the position is used exactly as
  // given, rounded only to 2 decimal places so saved coordinates stay tidy
  // instead of carrying long floating-point tails (0.01 of a world unit is
  // far below a single screen pixel, even at normal zoom).
  if (!gridSize) {
    return { x: Math.round(worldX * 100) / 100, y: Math.round(worldY * 100) / 100 };
  }
  const origin = getStudioOrigin();
  return {
    x: origin.x + snapToGrid(worldX - origin.x, gridSize),
    y: origin.y + snapToGrid(worldY - origin.y, gridSize)
  };
}

// ---- Studio-local undo/redo (separate from the document's undo/redo — this
// tracks in-progress symbol-drawing edits, which aren't part of the document
// until Save Symbol is clicked) ----
const MAX_STUDIO_HISTORY = 50;
let studioUndoStack = [];
let studioRedoStack = [];

function snapshotStudioElements() {
  return JSON.stringify(state.studioElements);
}

function pushStudioHistory() {
  studioUndoStack.push(snapshotStudioElements());
  if (studioUndoStack.length > MAX_STUDIO_HISTORY) studioUndoStack.shift();
  studioRedoStack = [];
  updateStudioUndoRedoButtons();
}

function clearStudioHistory() {
  studioUndoStack = [];
  studioRedoStack = [];
  updateStudioUndoRedoButtons();
}

export function undoStudio() {
  if (studioUndoStack.length === 0) return;
  studioRedoStack.push(snapshotStudioElements());
  state.studioElements = JSON.parse(studioUndoStack.pop());
  state.selectedStudioElementIndices = [];
  renderStudioLayer();
  updateStudioUndoRedoButtons();
}

export function redoStudio() {
  if (studioRedoStack.length === 0) return;
  studioUndoStack.push(snapshotStudioElements());
  state.studioElements = JSON.parse(studioRedoStack.pop());
  state.selectedStudioElementIndices = [];
  renderStudioLayer();
  updateStudioUndoRedoButtons();
}

function updateStudioUndoRedoButtons() {
  const u = document.getElementById('studioUndoBtn');
  const r = document.getElementById('studioRedoBtn');
  if (u) u.disabled = studioUndoStack.length === 0;
  if (r) r.disabled = studioRedoStack.length === 0;
}

// ---- Selection helpers (supports multi-select via rubber-band drag) ----
function isStudioElementSelected(index) {
  return state.selectedStudioElementIndices.includes(index);
}

// additive: shift-click toggles this index in/out of the current selection;
// otherwise a plain click replaces the selection with just this one element.
function selectStudioElement(index, additive) {
  if (additive) {
    const i = state.selectedStudioElementIndices.indexOf(index);
    if (i === -1) state.selectedStudioElementIndices = [...state.selectedStudioElementIndices, index];
    else state.selectedStudioElementIndices = state.selectedStudioElementIndices.filter(x => x !== index);
  } else {
    state.selectedStudioElementIndices = [index];
  }
}

// ---- Space-held-to-pan (freeing up plain drag for rubber-band select) ----
let isSpaceHeld = false;

function updateStudioStageDraggable() {
  if (state.studioStage) state.studioStage.draggable(isSpaceHeld && !state.currentStudioTool);
}

function isSymbolModalOpen() {
  const modal = document.getElementById('symbolModal');
  return !!modal && modal.style.display === 'flex';
}

// ---- Rubber-band multi-select ----
let rubberBandStart = null;
let rubberBandRect = null;

// Extracts every "control point" (segment endpoints) from a path element's
// rawPath — used to approximate whether a shape falls inside a rubber-band
// selection rectangle, since these are simple M/L/A paths with no curves
// besides circular arcs.
function extractPathPoints(rawPath) {
  const points = [];
  const tokens = rawPath.match(/[MLAZ][^MLAZ]*/g) || [];
  tokens.forEach(tok => {
    const cmd = tok[0];
    const nums = tok.slice(1).trim().split(/\s+/).filter(Boolean).map(Number);
    if ((cmd === 'M' || cmd === 'L') && nums.length >= 2) {
      points.push({ x: nums[0], y: nums[1] });
    } else if (cmd === 'A' && nums.length >= 7) {
      points.push({ x: nums[5], y: nums[6] });
    }
  });
  return points;
}

function elementIntersectsRect(el, rx1, ry1, rx2, ry2) {
  const inRect = (x, y) => x >= rx1 && x <= rx2 && y >= ry1 && y <= ry2;
  if (el.type === 'pin' || el.type === 'text') {
    return inRect(el.canvasX, el.canvasY);
  }
  if (el.type === 'path') {
    return extractPathPoints(el.rawPath).some(p => inRect(p.x, p.y));
  }
  return false;
}

// Rotates a raw SVG path 90° clockwise around (pivotX, pivotY). Radii,
// x-axis-rotation, and the arc flags are untouched — a pure 90° rotation (not
// a reflection) preserves a circular arc's sweep direction and shape exactly,
// just repositions it. Mirrors the existing transformSvgPath's token-walking
// approach for consistency.
function rotatePathAroundPoint(pathStr, pivotX, pivotY) {
  const tokens = pathTokens(pathStr);
  let result = [], currentCmd = '', coordIndex = 0;
  const rotate = (x, y) => ({ x: pivotX - (y - pivotY), y: pivotY + (x - pivotX) });

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      currentCmd = token; coordIndex = 0; result.push(token);
    } else {
      const val = parseFloat(token);
      if (currentCmd === 'A' && coordIndex <= 4) {
        result.push(val); // rx, ry, x-axis-rotation, large-arc-flag, sweep-flag unchanged
      } else if (currentCmd === 'A' && coordIndex === 5) {
        const pt = rotate(val, parseFloat(tokens[i + 1]));
        result.push(pt.x, pt.y); i++;
      } else if (currentCmd !== 'A' && coordIndex % 2 === 0) {
        const pt = rotate(val, parseFloat(tokens[i + 1]));
        result.push(pt.x, pt.y); i++;
      }
      coordIndex++;
    }
  }
  return result.join(' ');
}

// Rotates every currently-selected element 90° clockwise around the shared
// center of the whole selection — so rotating one line rotates around its own
// midpoint, and rotating several elements together rotates them as one group.
export function rotateSelectedStudioElements() {
  const indices = state.selectedStudioElementIndices;
  if (indices.length === 0) return;

  const allPoints = [];
  indices.forEach(i => {
    const el = state.studioElements[i];
    if (!el) return;
    if (el.type === 'pin' || el.type === 'text') allPoints.push({ x: el.canvasX, y: el.canvasY });
    else if (el.type === 'path') allPoints.push(...extractPathPoints(el.rawPath));
  });
  if (allPoints.length === 0) return;

  const pivotX = (Math.min(...allPoints.map(p => p.x)) + Math.max(...allPoints.map(p => p.x))) / 2;
  const pivotY = (Math.min(...allPoints.map(p => p.y)) + Math.max(...allPoints.map(p => p.y))) / 2;
  const origin = getStudioOrigin();

  pushStudioHistory();

  indices.forEach(i => {
    const el = state.studioElements[i];
    if (!el) return;

    if (el.type === 'pin' || el.type === 'text') {
      const rotX = pivotX - (el.canvasY - pivotY);
      const rotY = pivotY + (el.canvasX - pivotX);
      const snapSize = el.type === 'pin' ? PIN_SNAP_SIZE : getStudioSnapSize();
      const snapped = snapToStudioGrid(rotX, rotY, snapSize);
      el.canvasX = snapped.x; el.canvasY = snapped.y;
      el.relX = (snapped.x - origin.x) * STUDIO_SCALE;
      el.relY = (snapped.y - origin.y) * STUDIO_SCALE;
      el.rotation = ((el.rotation || 0) + 90) % 360; // reorients the marker itself, not just its position
    } else if (el.type === 'path') {
      el.rawPath = rotatePathAroundPoint(el.rawPath, pivotX, pivotY);
      el.d = convertRawPathToRelative(el.rawPath, origin.x, origin.y, STUDIO_SCALE);
    }
  });

  renderStudioLayer();
}

// ---- Cut / Copy / Paste ----
// An internal clipboard rather than the OS clipboard: these are structured
// shape objects (paths, pins, text with fonts/rotation), not text, so a plain
// in-memory buffer is far more robust than trying to serialize through the
// system clipboard.
let studioClipboard = [];

export function copySelectedStudioElements() {
  if (state.selectedStudioElementIndices.length === 0) return;
  studioClipboard = state.selectedStudioElementIndices
    .map(i => state.studioElements[i])
    .filter(Boolean)
    .map(el => JSON.parse(JSON.stringify(el)));
}

export function cutSelectedStudioElements() {
  if (state.selectedStudioElementIndices.length === 0) return;
  copySelectedStudioElements();
  deleteSelectedStudioElement(); // already handles multi-select + history + re-render
}

// Pastes a small offset from the original, so a paste is visibly distinct
// rather than sitting exactly on top of what was copied — and selects the
// newly-pasted elements so they're immediately ready to drag into place.
export function pasteStudioClipboard() {
  if (studioClipboard.length === 0 || !state.studioStage) return;

  const originX = state.studioStage.width() / 2;
  const originY = state.studioStage.height() / 2;
  const offset = 20;

  pushStudioHistory();
  const newIndices = [];

  studioClipboard.forEach(clip => {
    const el = JSON.parse(JSON.stringify(clip));
    if (el.type === 'pin') delete el.name;   // two pins with the same name would be ambiguous in a report

    if (el.type === 'pin' || el.type === 'text') {
      el.canvasX += offset;
      el.canvasY += offset;
      el.relX = (el.canvasX - originX) * STUDIO_SCALE;
      el.relY = (el.canvasY - originY) * STUDIO_SCALE;
    } else if (el.type === 'path') {
      el.d = translateSvgPath(el.d, offset * STUDIO_SCALE, offset * STUDIO_SCALE);
      el.rawPath = translateSvgPath(el.rawPath, offset, offset);
    }

    state.studioElements.push(el);
    newIndices.push(state.studioElements.length - 1);
  });

  state.selectedStudioElementIndices = newIndices;
  renderStudioLayer();
}

// Registered once at module load (not per canvas-open, which would stack
// duplicate listeners) — guarded internally by isSymbolModalOpen().
window.addEventListener('keydown', (e) => {
  if (!isSymbolModalOpen()) return;

  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (['input', 'textarea', 'select'].includes(activeTag)) return; // typing in Name/Prefix/Value — don't hijack keys

  if (e.code === 'Space' && !isSpaceHeld) {
    isSpaceHeld = true;
    updateStudioStageDraggable();
    e.preventDefault();
    return;
  }

  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  if (ctrlOrCmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoStudio();
    return;
  }
  if (ctrlOrCmd && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    redoStudio();
    return;
  }

  if (ctrlOrCmd && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copySelectedStudioElements();
    return;
  }
  if (ctrlOrCmd && (e.key === 'x' || e.key === 'X')) {
    e.preventDefault();
    cutSelectedStudioElements();
    return;
  }
  if (ctrlOrCmd && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    pasteStudioClipboard();
    return;
  }

  if ((e.key === 'r' || e.key === 'R') && !ctrlOrCmd) {
    rotateSelectedStudioElements();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    isSpaceHeld = false;
    updateStudioStageDraggable();
  }
});

// Filters every symbol row in the sidebar — built-in and custom alike, since
// both share the same .symbol-item / .symbol-name markup — by whether the
// search box's text appears in its name or its title (the built-in supply
// symbols carry a longer description there, e.g. "3-phase + Neutral +
// Earth", that isn't in the short visible name but is still worth matching
// on). A section's own heading hides too when nothing in it matches, so
// filtering down to one result doesn't leave an empty "Built-in Symbols"
// title sitting above nothing.
export function filterSymbolSidebar() {
  const input = document.getElementById('symbolSearchInput');
  const query = (input?.value || '').trim().toLowerCase();
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || typeof sidebar.querySelectorAll !== 'function') return;

  let anyVisible = false;
  sidebar.querySelectorAll('.section').forEach(section => {
    let sectionHasMatch = false;

    // Custom Symbols nests one .symbol-library-section per library (My
    // Symbols, Basic, Siemens, ...) — each one's own header hides when
    // nothing inside IT matches, same idea as the outer section heading
    // below but one level further in, so a search doesn't leave an empty
    // "Siemens" title sitting above nothing.
    const libraryGroups = section.querySelectorAll('.symbol-library-section');
    if (libraryGroups.length) {
      libraryGroups.forEach(group => {
        let groupHasMatch = false;
        group.querySelectorAll('.symbol-item').forEach(item => {
          const name = (item.querySelector('.symbol-name')?.textContent || '').toLowerCase();
          const title = (item.getAttribute('title') || '').toLowerCase();
          const matches = !query || name.includes(query) || title.includes(query);
          item.style.display = matches ? '' : 'none';
          if (matches) { groupHasMatch = true; sectionHasMatch = true; anyVisible = true; }
        });
        group.style.display = (query && !groupHasMatch) ? 'none' : '';
      });
    } else {
      section.querySelectorAll('.symbol-item').forEach(item => {
        const name = (item.querySelector('.symbol-name')?.textContent || '').toLowerCase();
        const title = (item.getAttribute('title') || '').toLowerCase();
        const matches = !query || name.includes(query) || title.includes(query);
        item.style.display = matches ? '' : 'none';
        if (matches) { sectionHasMatch = true; anyVisible = true; }
      });
    }

    const heading = section.querySelector('h3');
    if (heading && sidebar.classList) sidebar.classList.toggle('sb-searching', !!query);
    if (heading) heading.style.display = (query && !sectionHasMatch) ? 'none' : '';
  });

  // The "no symbols yet" hint (see renderCustomSymbolsList) only makes sense
  // when nobody is searching — hide it for the duration of a search.
  sidebar.querySelectorAll('.symbol-empty-hint').forEach(h => { h.style.display = query ? 'none' : ''; });

  const empty = document.getElementById('symbolSearchEmpty');
  const emptyQuery = document.getElementById('symbolSearchEmptyQuery');
  if (empty) empty.style.display = (query && !anyVisible) ? 'block' : 'none';
  if (emptyQuery) emptyQuery.textContent = input?.value || '';
}

// The name shown for symbols with no library tag at all — anything made
// directly in the Symbol Studio before this grouping existed, or a symbol
// someone creates fresh without importing a named library first.
const UNTAGGED_LIBRARY_NAME = 'My Symbols';

// Groups customSymbolDefinitions by their own .library tag — "My Symbols"
// (untagged) first if there are any, then every imported/default library
// alphabetically by name. A plain Map, not an object, so library names that
// happen to collide with JS object-prototype properties (e.g. a library
// literally named "constructor") can never cause silently-wrong grouping.
function groupSymbolsByLibrary() {
  const groups = new Map();
  Object.keys(window.customSymbolDefinitions || {}).forEach(symKey => {
    const sym = window.customSymbolDefinitions[symKey];
    if (sym.hidden || sym.builtin) return; // built-in ones are listed under Built-in Symbols; hidden ones are generated straight onto a sheet rather than added to the library — see generateTerminalBlock
    const libName = sym.library || UNTAGGED_LIBRARY_NAME;
    if (!groups.has(libName)) groups.set(libName, []);
    groups.get(libName).push(symKey);
  });

  const names = Array.from(groups.keys()).sort((a, b) => {
    if (a === UNTAGGED_LIBRARY_NAME) return -1;
    if (b === UNTAGGED_LIBRARY_NAME) return 1;
    return a.localeCompare(b);
  });
  return names.map(name => ({ name, keys: groups.get(name) }));
}

// One row for a single symbol — unchanged in shape from before this was
// grouped, just factored out so each library section can build its own set
// of rows the same way.
function buildSymbolItemRow(symKey, sym, handleDragStartCallback, readOnly = false) {
  const name = String(sym.name ?? symKey);

  const item = document.createElement('div');
  item.className = 'symbol-item';
  item.draggable = true;
  item.dataset.symbolKey = symKey; // read by the large hover preview (9_symbol_thumbnails.js)
  item.title = name; // the full name, for when a long one is cut short in the row
  item.ondragstart = (ev) => handleDragStartCallback(ev, symKey);

  // A picture of the symbol beside its name. The row is built from DOM
  // calls, not one big HTML string: an imported library can carry any name or
  // key it likes, and neither should ever be read as markup.
  const main = document.createElement('div');
  main.className = 'symbol-item-main';
  const thumb = document.createElement('div');
  thumb.className = 'symbol-thumb';
  thumb.innerHTML = buildSymbolThumbnailSvg(sym.pathData, sym.pins); // numbers and checked path data only — see 9_symbol_thumbnails.js
  const label = document.createElement('span');
  label.className = 'symbol-name';
  label.textContent = name;
  if (sym.nameNote) {   // e.g. the built-in child contacts: the name, then a smaller italic (child)
    const note = document.createElement('span');
    note.className = 'symbol-name-note';
    note.textContent = String(sym.nameNote);
    label.appendChild(note);
    item.title = name + ' ' + sym.nameNote;
  }
  main.appendChild(thumb);
  main.appendChild(label);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex; gap:4px; flex:0 0 auto;';
  const makeButton = (text, colour, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `background:${colour}; color:#fff; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:10px;`;
    btn.addEventListener('click', onClick);
    return btn;
  };
  if (!readOnly) {
    actions.appendChild(makeButton('Edit', '#2563eb', (ev) => window.editCustomSymbol(ev, symKey)));
    actions.appendChild(makeButton('🗑', '#ef4444', (ev) => window.deleteCustomSymbol(ev, symKey)));
  }

  item.appendChild(main);
  if (!readOnly) item.appendChild(actions);
  return item;
}

// The order of the Built-in Symbols list: the parents (coils, switches), then the child contacts and lamps, then the built-in library
// in the order of its own file (grouped by kind of part).
const BUILTIN_LIB_ORDER = Object.keys(BUILTIN_LIBRARY);
function builtinRank(def, key) {
  if (def && def.extraBuiltin) return 2000 + BUILTIN_LIB_ORDER.indexOf(key);
  return def && def.parentCoil ? 0 : 1;
}

// ---- collapsible sidebar sections (Built-in Symbols, Custom Symbols, each built-in group) ----
const SB_KEY = 'ssSidebarExpanded';   // everything starts folded; this holds what the person has opened
const sbState = (() => { try { return new Set(JSON.parse(localStorage.getItem(SB_KEY) || '[]')); } catch (e) { return new Set(); } })();
const sbSave = () => { try { localStorage.setItem(SB_KEY, JSON.stringify(Array.from(sbState))); } catch (e) { /* storage unavailable: stays for this session */ } };
function sbToggle(key) { if (sbState.has(key)) sbState.delete(key); else sbState.add(key); sbSave(); }
function sbApply() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll(':scope > .section').forEach(sec => {
    const h = sec.querySelector(':scope > h3'); if (!h) return;
    const key = 'sec:' + h.textContent.replace(/[▾▸\s]+$/, '').replace(/^[▾▸\s]+/, '').trim();
    const off = !sbState.has(key);
    sec.classList.toggle('sb-collapsed', off);
    const ch = h.querySelector('.sb-chev'); if (ch) ch.textContent = off ? '▸' : '▾';
  });
  sidebar.querySelectorAll('#builtin-symbols-list > [data-grp]:not(.builtin-group-head)').forEach(r => r.classList.toggle('sb-grp-collapsed', !sbState.has('grp:' + r.dataset.grp)));
  sidebar.querySelectorAll('#builtin-symbols-list .builtin-group-head').forEach(h => { const ch = h.querySelector('.sb-chev'); if (ch) ch.textContent = sbState.has('grp:' + h.dataset.grp) ? '▾' : '▸'; });
  sidebar.querySelectorAll('.symbol-library-section').forEach(sec => { const open = sbState.has('lib:' + sec.dataset.lib); sec.classList.toggle('lib-collapsed', !open); const ch = sec.querySelector('.symbol-library-chevron'); if (ch) ch.textContent = open ? '▾' : '▸'; });
}
function sbInit() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.sbInit) return;
  sidebar.dataset.sbInit = '1';
  sidebar.querySelectorAll(':scope > .section > h3').forEach(h => {
    const base = h.textContent.trim();
    h.textContent = '';
    const ch = document.createElement('span'); ch.className = 'sb-chev'; ch.textContent = '▸';
    h.append(ch, document.createTextNode(' ' + base));
    h.classList.add('sb-head');
    h.title = 'Click to collapse or expand';
    h.addEventListener('click', () => { sbToggle('sec:' + base); sbApply(); });
  });
}

export function renderCustomSymbolsList(handleDragStartCallback) {
  sbInit();
  const list = document.getElementById('custom-symbols-list');
  if (!list) return;
  list.innerHTML = '';
  ensureChildContactSymbols();   // the built-in coils and child contacts are always on offer
  const builtinList = document.getElementById('builtin-symbols-list');
  if (builtinList) {
    builtinList.innerHTML = '';
    let lastGroup = null;
    Object.keys(window.customSymbolDefinitions || {}).filter(k => window.customSymbolDefinitions[k].builtin && !window.customSymbolDefinitions[k].legacy)
      .sort((a, b) => builtinRank(window.customSymbolDefinitions[a], a) - builtinRank(window.customSymbolDefinitions[b], b))
      .forEach(k => {
        const def = window.customSymbolDefinitions[k];
        if (def.extraBuiltin && def.group !== lastGroup) {   // the built-in library is listed under a small heading for each kind of part
          lastGroup = def.group;
          const head = document.createElement('div');
          head.className = 'builtin-group-head';
          head.dataset.grp = def.group;
          const gch = document.createElement('span'); gch.className = 'sb-chev'; gch.textContent = '▸';
          head.append(gch, document.createTextNode(' ' + def.group));
          head.title = 'Click to collapse or expand';
          head.addEventListener('click', () => { sbToggle('grp:' + head.dataset.grp); sbApply(); });
          builtinList.appendChild(head);
        }
        const row = buildSymbolItemRow(k, def, handleDragStartCallback, true);
        if (def.extraBuiltin && def.group) row.dataset.grp = def.group;
        builtinList.appendChild(row);
      });
    sbApply();
  }

  const libraryGroups = groupSymbolsByLibrary();
  libraryGroups.forEach(({ name, keys }) => {
    const section = document.createElement('div');
    section.className = 'symbol-library-section';

    const header = document.createElement('h4');
    header.className = 'symbol-library-header';
    const chevron = document.createElement('span');
    chevron.className = 'symbol-library-chevron';
    chevron.textContent = '▸';
    header.appendChild(chevron);
    header.appendChild(document.createTextNode(' ' + name + ' '));
    const count = document.createElement('span');
    count.className = 'symbol-library-count';
    count.textContent = '(' + keys.length + ')';
    header.appendChild(count);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'symbol-library-items';
    keys.forEach(symKey => itemsEl.appendChild(buildSymbolItemRow(symKey, window.customSymbolDefinitions[symKey], handleDragStartCallback)));

    // Collapsed purely in the DOM for this session — not remembered across
    // reloads, same as the rest of the sidebar's transient UI state.
    section.dataset.lib = name;
    header.onclick = () => { sbToggle('lib:' + name); sbApply(); };

    section.appendChild(header);
    section.appendChild(itemsEl);
    list.appendChild(section);
  });
  sbApply();

  // A brand-new session starts with no symbols on purpose (see
  // 0_default_symbol_library.js) — say where they come from, rather than
  // leave a new person looking at an empty box with no clue what to do.
  if (libraryGroups.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'symbol-empty-hint';
    // window.currentUser.plan is the plan the server actually applies (a running
    // trial counts as 'pro'). A free account can't browse libraries, so
    // pointing it at Browse Libraries would send it to a greyed-out button.
    hint.textContent = isFreePlan()
      ? 'Symbol libraries are included with the free trial and Pro.'
      : 'No symbols yet \u2014 click Browse Libraries to add the Basic library.';
    list.appendChild(hint);
  }

  filterSymbolSidebar(); // re-apply any active search — a fresh row starts visible by default, which would silently break a filter already in place
}

export function openSymbolCreator() {
  const modal = document.getElementById('symbolModal');
  if (modal) modal.style.display = 'flex';

  if (state.studioStage) {
    state.studioStage.destroy();
    state.studioStage = null;
  }

  state.studioElements = [];
  state.selectedStudioElementIndices = [];
  state.editingSymbolKey = null;
  clearStudioHistory();

  // Nothing chosen yet: every symbol has to be saved into a library, picked
  // on purpose each time (see saveCustomSymbol).
  pendingLibraryNames = [];
  populateSymbolLibraryDropdown('');

  setTimeout(() => initStudioCanvas(), 50);
}

export function closeSymbolCreator() {
  const modal = document.getElementById('symbolModal');
  if (modal) modal.style.display = 'none';
  isSpaceHeld = false;
  rubberBandStart = null;
  rubberBandRect = null;
  resetArcSequence();
}

export function initStudioCanvas() {
  const container = document.getElementById('studioCanvasContainer');
  const width = container ? Math.floor(container.clientWidth || 800) : 800;
  const height = container ? Math.floor(container.clientHeight || 500) : 500;

  state.studioStage = new Konva.Stage({
    container: 'studioCanvasContainer',
    width: width,
    height: height
  });

  state.studioLayer = new Konva.Layer();
  state.studioStage.add(state.studioLayer);

  // Pan by holding Space and dragging — plain drag on empty canvas is
  // reserved for rubber-band multi-select instead (see handleStudioMouseDown).
  updateStudioStageDraggable();

  state.studioStage.on('mousedown touchstart', handleStudioMouseDown);
  state.studioStage.on('mousemove touchmove', handleStudioMouseMove);
  state.studioStage.on('mouseup touchend', handleStudioMouseUp);

  state.studioStage.on('wheel', (e) => {
    e.evt.preventDefault();
    const oldScale = state.studioStage.scaleX();
    const pointer = state.studioStage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - state.studioStage.x()) / oldScale,
      y: (pointer.y - state.studioStage.y()) / oldScale
    };

    let newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
    newScale = Math.max(0.2, Math.min(15, newScale)); // generous zoom-in range for fine detail work

    state.studioStage.scale({ x: newScale, y: newScale });
    state.studioStage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale
    });
    rescaleStudioHandles();
    state.studioStage.batchDraw();
    updateStudioZoomIndicator();
  });

  // Catch Right-Clicks globally on the canvas container
  const stageContainer = state.studioStage.container();

  stageContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Stop native browser menu
    e.stopPropagation();

    // CANCEL/DESELECT: Clear current tool and clean up temporary shapes
    state.currentStudioTool = null;
    state.isDrawing = false;

    if (state.tempShape) {
      state.tempShape.destroy();
      state.tempShape = null;
    }

    renderStudioLayer();
    return false;
  });

  renderStudioLayer();
  updateStudioZoomIndicator();
}

export function setStudioTool(toolName) {
  if (state.currentStudioTool === toolName) {
    state.currentStudioTool = null;
  } else {
    state.currentStudioTool = toolName;
  }

  resetArcSequence(); // switching tools cancels any arc in progress

  // Update Cursor
  const isWire = state.currentStudioTool === 'wire';
  const targetCursor = isWire ? 'crosshair' : 'default';

  const container = state.studioStage?.container();
  if (container) {
    container.style.cursor = targetCursor;
    // Apply explicitly to canvas elements to override Konva's inline styles
    container.querySelectorAll('canvas').forEach(c => {
      c.style.setProperty('cursor', targetCursor, 'important');
    });
  }

  updateStudioStageDraggable();

  renderStudioLayer();
}

export function setStudioLineStyle(style) {
  if (!['solid', 'dashed', 'dotted'].includes(style)) return;

  // Restyle every currently-selected path element directly.
  const pathIndices = state.selectedStudioElementIndices.filter(i => state.studioElements[i]?.type === 'path');
  if (pathIndices.length > 0) {
    pushStudioHistory();
    pathIndices.forEach(i => { state.studioElements[i].dash = style; });
  }

  // Also set it as the default for the next shape drawn.
  state.currentLineStyle = style;
  renderStudioLayer();
}

export function clearStudioCanvas() {
  if (state.studioElements.length > 0) pushStudioHistory();
  state.studioElements = [];
  state.selectedStudioElementIndices = [];
  renderStudioLayer();
}

// Name kept exactly as-is (bound in 2_main_stage.js's Delete/Backspace handler)
// — internally now removes every currently-selected element, not just one.
export function deleteSelectedStudioElement() {
  if (state.selectedStudioElementIndices.length === 0) return;
  pushStudioHistory();
  const toRemove = new Set(state.selectedStudioElementIndices);
  state.studioElements = state.studioElements.filter((_, i) => !toRemove.has(i));
  state.selectedStudioElementIndices = [];
  renderStudioLayer();
}

export function editCustomSymbol(e, symKey) {
  if (e) e.stopPropagation();

  const sym = window.customSymbolDefinitions[symKey];
  if (!sym) return;

  // A PLC module is made in its own dialog, not drawn by hand.
  if (sym.plc && typeof window.openPlcModuleCreator === 'function') { window.openPlcModuleCreator(symKey); return; }
  if (sym.drive && typeof window.openDriveCreator === 'function') { window.openDriveCreator(symKey); return; }

  openSymbolCreator();
  // Set AFTER opening: openSymbolCreator() starts a fresh symbol, so it clears
  // the editing key — setting it first (as this used to) meant Save never
  // actually knew which symbol was being edited and could only guess from
  // the name.
  state.editingSymbolKey = symKey;

  setTimeout(() => {
    const nameInput = document.getElementById('symName');
    const prefixInput = document.getElementById('symPrefix');
    const valueInput = document.getElementById('symValue');
    populateSymbolLibraryDropdown(libraryKeyOf(sym)); // starts on the library it is already in

    if (nameInput) nameInput.value = sym.name || '';
    if (prefixInput) prefixInput.value = sym.prefix || '';
    if (valueInput) valueInput.value = sym.value || '';

    const originX = state.studioStage.width() / 2;
    const originY = state.studioStage.height() / 2;

    state.studioElements = [];

    if (sym.pathData) {
      normalizePathData(sym.pathData).forEach(seg => {
        state.studioElements.push({
          type: 'path',
          d: seg.d,
          rawPath: convertRelativeToRawPath(seg.d, originX, originY, INVERSE_STUDIO_SCALE),
          dash: seg.dash || 'solid'
        });
      });
    }

    (sym.pins || []).forEach(p => {
      state.studioElements.push({
        type: 'pin',
        canvasX: originX + (p.relX * INVERSE_STUDIO_SCALE),
        canvasY: originY + (p.relY * INVERSE_STUDIO_SCALE),
        relX: p.relX, relY: p.relY,
        rotation: p.rotation || 0,
        ...(p.name ? { name: String(p.name) } : {}),
        ...(Number.isFinite(p.nameDx) && Number.isFinite(p.nameDy) ? { nameOffX: p.nameDx * INVERSE_STUDIO_SCALE, nameOffY: p.nameDy * INVERSE_STUDIO_SCALE } : {})
      });
    });

    (sym.texts || []).forEach(t => {
      state.studioElements.push({
        type: 'text', text: t.text,
        canvasX: originX + (t.relX * INVERSE_STUDIO_SCALE),
        canvasY: originY + (t.relY * INVERSE_STUDIO_SCALE),
        relX: t.relX, relY: t.relY, fontSize: t.fontSize || 12,
        fontFamily: t.fontFamily, bold: !!t.bold, italic: !!t.italic, underline: !!t.underline,
        rotation: t.rotation || 0
      });
    });

    state.selectedStudioElementIndices = [];
    renderStudioLayer();
    clearStudioHistory(); // undo shouldn't reach back before this edit session started
  }, 100);
}

export function convertRelativeToRawPath(relativePath, originX, originY, scale) {
  const tokens = pathTokens(relativePath);
  let result = [];
  let currentCmd = '';
  let coordIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      currentCmd = token;
      coordIndex = 0;
      result.push(token);
    } else {
      const raw = parseFloat(token);
      const val = raw * scale;
      if (currentCmd === 'A') {
        // Only the radii and the end point are lengths. The x-axis rotation and the
        // two arc flags (0 or 1) are not — scaling them turned a flag of 1 into 2, then
        // 4, ... each time a symbol was opened for editing, which is not valid SVG.
        if (coordIndex === 0 || coordIndex === 1) result.push(val);
        else if (coordIndex >= 2 && coordIndex <= 4) result.push(raw);
        else if (coordIndex === 5) result.push(val + originX);
        else if (coordIndex === 6) result.push(val + originY);
      } else {
        result.push(coordIndex % 2 === 0 ? val + originX : val + originY);
      }
      coordIndex++;
    }
  }
  return result.join(' ');
}

export // ---- text properties dialog ----
// Double-clicking a text (or placing a new one) opens this. Resolves with the
// chosen { text, fontSize, fontFamily, bold, italic, underline, rotation }, or
// null if cancelled. Built on first use so it needs no markup in the page.
let symbolTextDialogEl = null;
export function openSymbolTextDialog(initial, title = 'Text') {
  return new Promise(resolve => {
    if (!symbolTextDialogEl) {
      const m = document.createElement('div');
      m.className = 'modal-overlay';
      m.style.zIndex = '1090';
      m.innerHTML = `
      <div class="modal-card" style="width: 440px; max-width: 92vw;">
        <div class="modal-header"><h3 id="stdTitle">Text</h3><button type="button" class="btn-icon" id="stdClose">&#10005;</button></div>
        <label for="stdText">Text</label>
        <textarea id="stdText" rows="3" maxlength="200" style="width:100%; box-sizing:border-box; resize:vertical;"></textarea>
        <div class="modal-row">
          <div><label for="stdFont">Font</label><select id="stdFont">${SYMBOL_FONTS.map(f => `<option value="${f.value.replace(/"/g, '&quot;')}">${f.label}</option>`).join('')}</select></div>
          <div><label for="stdSize">Size</label><input type="number" id="stdSize" min="4" max="96" step="1"></div>
        </div>
        <div class="modal-row">
          <div><label>Style</label>
            <div class="toolbar-group">
              <button type="button" class="btn btn-ghost" id="stdBold" style="font-weight:700;">B</button>
              <button type="button" class="btn btn-ghost" id="stdItalic" style="font-style:italic;">I</button>
              <button type="button" class="btn btn-ghost" id="stdUnderline" style="text-decoration:underline;">U</button>
            </div></div>
          <div><label for="stdRot">Angle</label><input type="number" id="stdRot" min="-360" max="360" step="15"></div>
        </div>
        <div class="modal-hint">Size is in the studio's own units (12 is the usual size). Enter or Ctrl+Enter to save.</div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button type="button" class="btn btn-ghost" id="stdCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="stdOk">OK</button>
        </div>
      </div>`;
      document.body.appendChild(m);
      symbolTextDialogEl = m;
    }
    const m = symbolTextDialogEl, q = id => m.querySelector('#' + id);
    const fmt = { bold: !!initial.bold, italic: !!initial.italic, underline: !!initial.underline };
    q('stdTitle').textContent = title;
    q('stdText').value = initial.text ?? '';
    q('stdFont').value = initial.fontFamily || 'sans-serif';
    if (q('stdFont').value !== (initial.fontFamily || 'sans-serif')) q('stdFont').value = 'sans-serif';
    q('stdSize').value = initial.fontSize || 12;
    q('stdRot').value = initial.rotation || 0;
    const paint = () => [['stdBold', 'bold'], ['stdItalic', 'italic'], ['stdUnderline', 'underline']].forEach(([id, k]) => { q(id).classList.toggle('btn-primary', fmt[k]); q(id).classList.toggle('btn-ghost', !fmt[k]); });
    const toggles = [['stdBold', 'bold'], ['stdItalic', 'italic'], ['stdUnderline', 'underline']].map(([id, k]) => { const h = () => { fmt[k] = !fmt[k]; paint(); }; q(id).addEventListener('click', h); return [id, h]; });
    paint();
    const done = (value) => {
      m.style.display = 'none';
      toggles.forEach(([id, h]) => q(id).removeEventListener('click', h));
      q('stdOk').onclick = q('stdCancel').onclick = q('stdClose').onclick = null;
      m.onkeydown = null;
      resolve(value);
    };
    const accept = () => {
      const text = q('stdText').value;
      if (!text.trim()) { q('stdText').focus(); return; }
      const size = Math.min(96, Math.max(4, Math.round(Number(q('stdSize').value)) || 12));
      const rot = Number(q('stdRot').value);
      done({ text, fontSize: size, fontFamily: q('stdFont').value, ...fmt, rotation: Number.isFinite(rot) ? rot : 0 });
    };
    q('stdOk').onclick = accept;
    q('stdCancel').onclick = q('stdClose').onclick = () => done(null);
    m.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.tagName !== 'TEXTAREA')) { e.preventDefault(); e.stopPropagation(); accept(); }
    };
    m.style.display = 'flex';
    q('stdText').focus(); q('stdText').select();
  });
}

let lastStudioTextClick = { el: null, time: 0 };
// A pin's own name (U, V, W, PE, A1 ...). Shown in the cable report and the wire marker list instead of the pin's number.
const cleanPinName = (v) => String(v ?? '').trim().slice(0, 12);

async function editStudioPinName(el) {
  const answer = await appPrompt('Name this pin, the way it is marked on the device (for example U, V, W, PE, A1 or DI5). Leave it empty to clear the name.', el.name || '', 'Pin name');
  if (answer === null || answer === undefined) return;
  const name = cleanPinName(answer);
  if ((el.name || '') === name) return;
  pushStudioHistory();
  if (name) el.name = name; else delete el.name;
  renderStudioLayer();
}

async function editStudioText(el) {
  const result = await openSymbolTextDialog(el, 'Edit Text');
  if (result) {
    pushStudioHistory();
    Object.assign(el, result);
    renderStudioLayer();
  }
}

function renderStudioLayer() {
  if (!state.studioLayer) return;
  state.studioLayer.destroyChildren();

  const w = state.studioStage.width();
  const h = state.studioStage.height();
  const originX = w / 2;
  const originY = h / 2;

  // Drawn well beyond the canvas's nominal size (not just w/h) so zooming in or
  // panning around doesn't run past the grid into blank space.
  const gridPad = Math.max(w, h) * 2;
  const gridLeft = -gridPad, gridRight = w + gridPad;
  const gridTop = -gridPad, gridBottom = h + gridPad;

  for (let x = originX; x >= gridLeft; x -= 20) {
    state.studioLayer.add(new Konva.Line({ points: [x, gridTop, x, gridBottom], stroke: '#f1f5f9', strokeWidth: 1 }));
  }
  for (let x = originX; x <= gridRight; x += 20) {
    state.studioLayer.add(new Konva.Line({ points: [x, gridTop, x, gridBottom], stroke: '#f1f5f9', strokeWidth: 1 }));
  }
  for (let y = originY; y >= gridTop; y -= 20) {
    state.studioLayer.add(new Konva.Line({ points: [gridLeft, y, gridRight, y], stroke: '#f1f5f9', strokeWidth: 1 }));
  }
  for (let y = originY; y <= gridBottom; y += 20) {
    state.studioLayer.add(new Konva.Line({ points: [gridLeft, y, gridRight, y], stroke: '#f1f5f9', strokeWidth: 1 }));
  }
  state.studioLayer.add(new Konva.Line({ points: [originX, gridTop, originX, gridBottom], stroke: '#38bdf8', strokeWidth: 1.5, dash: [4, 4] }));
  state.studioLayer.add(new Konva.Line({ points: [gridLeft, originY, gridRight, originY], stroke: '#38bdf8', strokeWidth: 1.5, dash: [4, 4] }));

  const tr = new Konva.Transformer({
    rotateEnabled: false, borderStroke: '#38bdf8',
    anchorFill: '#38bdf8', anchorSize: 8, ignoreStroke: true
  });
  state.studioLayer.add(tr);

  // Endpoint handles / the transform box only make sense for a single
  // selected element — with several selected, just highlight them.
  const singleSelectedIndex = state.selectedStudioElementIndices.length === 1
    ? state.selectedStudioElementIndices[0] : null;

  state.studioElements.forEach((el, index) => {
    if (el.type === 'path') {
      const isSelected = isStudioElementSelected(index);
      const pathShape = new Konva.Path({
        data: el.rawPath,
        stroke: isSelected ? '#2563eb' : '#0f172a',
        strokeWidth: isSelected ? 2.5 : 1.5,
        dash: getDashArray(el.dash || 'solid'), draggable: true
      });

      pathShape.on('click tap', (ev) => {
        if (ev.evt && ev.evt.button === 2) return; // ignore right clicks
        ev.cancelBubble = true;
        selectStudioElement(index, ev.evt.shiftKey);
        state.currentStudioTool = null;
        renderStudioLayer();
      });

      // Double-click to change this line's style
      pathShape.on('dblclick dbltap', async (ev) => {
        ev.cancelBubble = true;
        const currentStyle = el.dash || 'solid';
        const newStyle = await appPrompt('Select line style (solid, dashed, dotted):', currentStyle, 'Line Style');
        if (newStyle && ['solid', 'dashed', 'dotted'].includes(newStyle.toLowerCase())) {
          pushStudioHistory();
          el.dash = newStyle.toLowerCase();
          renderStudioLayer();
        }
      });

      pathShape.on('dragstart', () => pushStudioHistory());

      pathShape.on('dragend', () => {
        const dx = pathShape.x();
        const dy = pathShape.y();
        pathShape.position({ x: 0, y: 0 });
        applyGroupDelta(index, dx, dy, originX, originY);
        renderStudioLayer();
      });

      pathShape.on('transformend', () => {
        const transform = pathShape.getTransform();

        el.rawPath = transformSvgPath(el.rawPath, transform);
        el.d = convertRawPathToRelative(el.rawPath, originX, originY, STUDIO_SCALE);

        pathShape.scaleX(1);
        pathShape.scaleY(1);
        pathShape.position({ x: 0, y: 0 });

        renderStudioLayer();
      });

      state.studioLayer.add(pathShape);

      if (index === singleSelectedIndex) {
        const lineCoords = parseLineCoords(el.rawPath);
        if (lineCoords) {
          addEndpointHandle(lineCoords.x1, lineCoords.y1, (newX, newY) => {
            updateLineEndpoints(index, newX, newY, lineCoords.x2, lineCoords.y2, originX, originY);
          });
          addEndpointHandle(lineCoords.x2, lineCoords.y2, (newX, newY) => {
            updateLineEndpoints(index, lineCoords.x1, lineCoords.y1, newX, newY, originX, originY);
          });
        } else {
          tr.nodes([pathShape]);
        }
      }
    } else if (el.type === 'pin') {
      const isSelected = isStudioElementSelected(index);
      const pinShape = new Konva.Line({
        x: el.canvasX, y: el.canvasY,
        points: [-6, 0, 6, 0], // local to the shape's own x/y, so rotation below pivots correctly
        rotation: el.rotation || 0,
        stroke: isSelected ? '#2563eb' : '#000000',
        strokeWidth: isSelected ? 2.5 : 1.5,
        hitStrokeWidth: 20, // generous invisible hit area — the line itself stays thin
        draggable: true
      });

      pinShape.on('click tap', (ev) => {
        ev.cancelBubble = true;
        // two clicks on the same pin in quick succession name it (a click redraws the layer, so a browser double-click never arrives)
        const now = Date.now();
        const isDouble = lastStudioTextClick.el === el && now - lastStudioTextClick.time < 450;
        lastStudioTextClick = isDouble ? { el: null, time: 0 } : { el, time: now };
        if (isDouble) { editStudioPinName(el); return; }
        tr.nodes([]);
        selectStudioElement(index, ev.evt.shiftKey);
        state.currentStudioTool = null;
        renderStudioLayer();
      });

      pinShape.on('dragstart', () => pushStudioHistory());

      pinShape.on('dragend', () => {
        // x()/y() are the shape's own absolute position (see above), so the
        // delta is simply how far that moved from where it was rendered.
        const dx = pinShape.x() - el.canvasX;
        const dy = pinShape.y() - el.canvasY;
        applyGroupDelta(index, dx, dy, originX, originY);
        renderStudioLayer();
      });

      state.studioLayer.add(pinShape);
      if (el.name) {                       // the pin's name, shown beside it while editing (not part of the symbol's artwork); drag it to reposition
        const offX = Number.isFinite(el.nameOffX) ? el.nameOffX : 8, offY = Number.isFinite(el.nameOffY) ? el.nameOffY : -14;
        const nameText = new Konva.Text({ x: el.canvasX + offX, y: el.canvasY + offY, text: el.name, fontSize: 11, fontStyle: 'bold', fill: '#0369a1', draggable: true });
        nameText.on('mouseenter', () => { const c = state.studioStage && state.studioStage.container(); if (c) c.style.cursor = 'move'; });
        nameText.on('mouseleave', () => { const c = state.studioStage && state.studioStage.container(); if (c) c.style.cursor = ''; });
        nameText.on('dragstart', (ev) => { ev.cancelBubble = true; pushStudioHistory(); });
        nameText.on('dragend', (ev) => {
          ev.cancelBubble = true;
          el.nameOffX = Math.round(nameText.x() - el.canvasX); el.nameOffY = Math.round(nameText.y() - el.canvasY);
          renderStudioLayer();
        });
        nameText.on('dblclick dbltap', (ev) => {               // double-click puts the name back beside its pin
          ev.cancelBubble = true;
          pushStudioHistory(); delete el.nameOffX; delete el.nameOffY; renderStudioLayer();
        });
        state.studioLayer.add(nameText);
      }
    } else if (el.type === 'text') {
      const isSelected = isStudioElementSelected(index);
      const textShape = new Konva.Text({
        x: el.canvasX, y: el.canvasY, text: el.text,
        fontSize: el.fontSize || 12, ...symbolTextStyle(el),
        fill: isSelected ? '#2563eb' : '#0f172a',
        rotation: el.rotation || 0, draggable: true
      });

      textShape.on('click tap', (ev) => {
        ev.cancelBubble = true;
        // A click redraws the layer, which throws this node away before the browser's
        // own double-click can reach it, so a double-click is spotted here instead:
        // two clicks on the same text within a short time.
        const now = Date.now();
        const isDouble = lastStudioTextClick.el === el && now - lastStudioTextClick.time < 450;
        lastStudioTextClick = isDouble ? { el: null, time: 0 } : { el, time: now };
        if (isDouble) { editStudioText(el); return; }
        tr.nodes([]);
        selectStudioElement(index, ev.evt.shiftKey);
        state.currentStudioTool = null;
        renderStudioLayer();
      });

      textShape.on('dblclick dbltap', (ev) => {
        ev.cancelBubble = true;
        editStudioText(el);
      });

      textShape.on('dragstart', () => pushStudioHistory());

      textShape.on('dragend', () => {
        const dx = textShape.x() - el.canvasX;
        const dy = textShape.y() - el.canvasY;
        applyGroupDelta(index, dx, dy, originX, originY);
        renderStudioLayer();
      });

      state.studioLayer.add(textShape);
    }
  });

  state.studioLayer.draw();
}

// Moves every currently-selected element by the same (dx, dy) — used so
// dragging any one element in a multi-selection moves the whole group
// together. If the dragged element isn't part of a multi-selection, this
// just moves that one element, same as before multi-select existed.
function applyGroupDelta(draggedIndex, dx, dy, originX, originY) {
  if (dx === 0 && dy === 0) return;
  const fineSnap = getStudioSnapSize();
  const indices = (state.selectedStudioElementIndices.length > 1 && state.selectedStudioElementIndices.includes(draggedIndex))
    ? state.selectedStudioElementIndices
    : [draggedIndex];

  indices.forEach(i => {
    const el = state.studioElements[i];
    if (!el) return;
    if (el.type === 'pin' || el.type === 'text') {
      const snapSize = el.type === 'pin' ? PIN_SNAP_SIZE : fineSnap;
      const snapped = snapToStudioGrid(el.canvasX + dx, el.canvasY + dy, snapSize);
      const newX = snapped.x, newY = snapped.y;
      el.canvasX = newX; el.canvasY = newY;
      el.relX = (newX - originX) * STUDIO_SCALE;
      el.relY = (newY - originY) * STUDIO_SCALE;
    } else if (el.type === 'path') {
      el.d = translateSvgPath(el.d, dx * STUDIO_SCALE, dy * STUDIO_SCALE);
      el.rawPath = translateSvgPath(el.rawPath, dx, dy);
    }
  });
}

function parseLineCoords(rawPath) {
  const numbers = pathTokens(rawPath).filter(t => !/^[A-Za-z]$/.test(t));
  if (numbers.length !== 4) return null;
  return { x1: parseFloat(numbers[0]), y1: parseFloat(numbers[1]), x2: parseFloat(numbers[2]), y2: parseFloat(numbers[3]) };
}

// The blue endpoint dots on a selected line. They live in drawing units, so
// without this they'd grow with the zoom — 5 units is a 5px dot at 100% but a
// 50px blob at 1000%, hiding the very detail you zoomed in to work on. The
// size is divided by the zoom (never below 1, so at or below 100% they're
// exactly as before) which keeps them the same small size on screen however
// far in you go.
const ENDPOINT_HANDLE_RADIUS = 5;
const ENDPOINT_HANDLE_STROKE = 1.5;
const ENDPOINT_HANDLE_NAME = 'studioEndpointHandle';

function getEndpointHandleSizing() {
  const scale = state.studioStage?.scaleX() || 1;
  const k = 1 / Math.max(1, scale);
  return { radius: ENDPOINT_HANDLE_RADIUS * k, strokeWidth: ENDPOINT_HANDLE_STROKE * k };
}

// Zooming doesn't rebuild the layer (only the stage's scale changes), so any
// handles already on screen have to be resized in place when it does.
function rescaleStudioHandles() {
  if (!state.studioLayer) return;
  const sizing = getEndpointHandleSizing();
  state.studioLayer.getChildren(n => n.hasName && n.hasName(ENDPOINT_HANDLE_NAME))
    .forEach(h => h.setAttrs(sizing));
}

function addEndpointHandle(x, y, onDragCallback) {
  const { radius, strokeWidth } = getEndpointHandleSizing();
  const handle = new Konva.Circle({
    x: x, y: y, radius, fill: '#2563eb', stroke: '#ffffff', strokeWidth, draggable: true,
    name: ENDPOINT_HANDLE_NAME
  });
  handle.on('dragstart', () => pushStudioHistory());
  handle.on('dragend', () => {
    const snapped = snapToStudioGrid(handle.x(), handle.y(), getStudioSnapSize());
    onDragCallback(snapped.x, snapped.y);
  });
  state.studioLayer.add(handle);
}

function updateLineEndpoints(index, x1, y1, x2, y2, originX, originY) {
  const sx = (x1 - originX) * STUDIO_SCALE, sy = (y1 - originY) * STUDIO_SCALE;
  const ex = (x2 - originX) * STUDIO_SCALE, ey = (y2 - originY) * STUDIO_SCALE;

  state.studioElements[index].rawPath = `M ${x1} ${y1} L ${x2} ${y2}`;
  state.studioElements[index].d = `M ${sx} ${sy} L ${ex} ${ey}`;

  renderStudioLayer();
}

function transformSvgPath(pathStr, transform) {
  const tokens = pathTokens(pathStr);
  let result = [];
  let currentCmd = '';
  let coordIndex = 0;

  const scaleX = Math.hypot(transform.m[0], transform.m[1]);
  const scaleY = Math.hypot(transform.m[2], transform.m[3]);
  const avgScale = (scaleX + scaleY) / 2;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      currentCmd = token; coordIndex = 0; result.push(token);
    } else {
      let val = parseFloat(token);
      if (currentCmd === 'A') {
        if (coordIndex === 0 || coordIndex === 1) result.push(val * avgScale);
        else if (coordIndex === 5) {
          const pt = transform.point({ x: val, y: parseFloat(tokens[i + 1]) });
          result.push(pt.x, pt.y); i++;
        } else result.push(val);
      } else if (coordIndex % 2 === 0) {
        const pt = transform.point({ x: val, y: parseFloat(tokens[i + 1]) });
        result.push(pt.x, pt.y); i++;
      }
      coordIndex++;
    }
  }
  return result.join(' ');
}

export function convertRawPathToRelative(rawPath, originX, originY, scale) {
  const tokens = pathTokens(rawPath);
  let result = [];
  let currentCmd = '';
  let coordIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      currentCmd = token; coordIndex = 0; result.push(token);
    } else {
      let val = parseFloat(token);
      if (currentCmd === 'A') {
        if (coordIndex === 0 || coordIndex === 1) result.push(val * scale);
        else if (coordIndex === 5) result.push((val - originX) * scale);
        else if (coordIndex === 6) result.push((val - originY) * scale);
        else result.push(val);
      } else {
        result.push(coordIndex % 2 === 0 ? (val - originX) * scale : (val - originY) * scale);
      }
      coordIndex++;
    }
  }
  return result.join(' ');
}

function translateSvgPath(pathStr, dx, dy) {
  const tokens = pathTokens(pathStr);
  let result = [];
  let currentCmd = '';
  let coordIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      currentCmd = token; coordIndex = 0; result.push(token);
    } else {
      let val = parseFloat(token);
      if (currentCmd === 'A') {
        if (coordIndex === 5) val += dx;
        if (coordIndex === 6) val += dy;
      } else {
        if (coordIndex % 2 === 0) val += dx; else val += dy;
      }
      result.push(val);
      coordIndex++;
    }
  }
  return result.join(' ');
}

// Converts the studio stage's raw pointer position into world coordinates,
// undoing the current zoom/pan transform — needed everywhere drawing math
// reads the pointer, now that the stage can be scaled and panned.
function updateStudioZoomIndicator() {
  const el = document.getElementById('studioZoomIndicator');
  if (!el || !state.studioStage) return;
  el.textContent = `${Math.round(state.studioStage.scaleX() * 100)}%`;
}

export function resetStudioView() {
  if (!state.studioStage) return;
  state.studioStage.scale({ x: 1, y: 1 });
  state.studioStage.position({ x: 0, y: 0 });
  rescaleStudioHandles();
  state.studioStage.batchDraw();
  updateStudioZoomIndicator();
}

function getStudioWorldPos() {
  const pos = state.studioStage.getPointerPosition();
  if (!pos) return null;
  const scale = state.studioStage.scaleX();
  return {
    x: (pos.x - state.studioStage.x()) / scale,
    y: (pos.y - state.studioStage.y()) / scale
  };
}

async function handleStudioMouseDown(e) {
  if (e.target !== state.studioStage) return;

  const pos = getStudioWorldPos();
  if (!pos) { renderStudioLayer(); return; }

  const snapSize = getStudioSnapSize();
  const snapped = snapToStudioGrid(pos.x, pos.y, snapSize);
  const snapX = snapped.x, snapY = snapped.y;

  if (state.currentStudioTool === 'pin') {
    const originX = state.studioStage.width() / 2;
    const originY = state.studioStage.height() / 2;
    const pinSnapped = snapToStudioGrid(pos.x, pos.y, PIN_SNAP_SIZE);
    const pinX = pinSnapped.x, pinY = pinSnapped.y;

    pushStudioHistory();
    state.studioElements.push({
      type: 'pin', canvasX: pinX, canvasY: pinY,
      relX: (pinX - originX) * STUDIO_SCALE, relY: (pinY - originY) * STUDIO_SCALE
    });
    state.selectedStudioElementIndices = [];
    renderStudioLayer(); return;
  }

  if (state.currentStudioTool === 'text') {
    const added = await openSymbolTextDialog({ text: '1', fontSize: 12, rotation: 0 }, 'Add Text');
    if (added) {
      const originX = state.studioStage.width() / 2;
      const originY = state.studioStage.height() / 2;

      pushStudioHistory();
      state.studioElements.push({
        type: 'text', text: added.text, canvasX: snapX, canvasY: snapY,
        relX: (snapX - originX) * STUDIO_SCALE, relY: (snapY - originY) * STUDIO_SCALE, fontSize: added.fontSize, rotation: added.rotation,
        fontFamily: added.fontFamily, bold: added.bold, italic: added.italic, underline: added.underline
      });
      state.currentStudioTool = null;
      state.selectedStudioElementIndices = [];
      renderStudioLayer();
    }
    return;
  }

  if (state.currentStudioTool === 'arc') {
    handleArcClick(snapX, snapY);
    return;
  }

  if (['line', 'rect', 'circle'].includes(state.currentStudioTool)) {
    state.isDrawing = true;
    state.startPos = { x: snapX, y: snapY };

    if (state.currentStudioTool === 'line') {
      state.tempShape = new Konva.Line({ points: [state.startPos.x, state.startPos.y, state.startPos.x, state.startPos.y], stroke: '#2563eb', strokeWidth: 1 });
    } else if (state.currentStudioTool === 'rect') {
      state.tempShape = new Konva.Rect({ x: state.startPos.x, y: state.startPos.y, width: 0, height: 0, stroke: '#2563eb', strokeWidth: 1 });
    } else if (state.currentStudioTool === 'circle') {
      state.tempShape = new Konva.Circle({ x: state.startPos.x, y: state.startPos.y, radius: 0, stroke: '#2563eb', strokeWidth: 1 });
    }

    if (state.tempShape) state.studioLayer.add(state.tempShape);
    return;
  }

  // No tool active and not panning (space not held): start a rubber-band
  // multi-select drag on empty canvas instead of just deselecting.
  if (!isSpaceHeld) {
    state.selectedStudioElementIndices = [];
    renderStudioLayer(); // clear the old selection highlight before adding the band

    rubberBandStart = { x: pos.x, y: pos.y };
    rubberBandRect = new Konva.Rect({
      x: pos.x, y: pos.y, width: 0, height: 0,
      fill: 'rgba(37, 99, 235, 0.12)', stroke: '#2563eb', strokeWidth: 1, dash: [4, 4], listening: false
    });
    state.studioLayer.add(rubberBandRect);
    state.studioLayer.batchDraw();
  }
}

function handleStudioMouseMove() {
  if (state.currentStudioTool === 'arc' && arcPhase > 0) {
    const pos = getStudioWorldPos();
    if (!pos) return;
    const snapped = snapToStudioGrid(pos.x, pos.y, getStudioSnapSize());
    renderArcPreview(snapped.x, snapped.y);
    return;
  }

  if (rubberBandStart && rubberBandRect) {
    const pos = getStudioWorldPos();
    if (!pos) return;
    rubberBandRect.position({
      x: Math.min(rubberBandStart.x, pos.x),
      y: Math.min(rubberBandStart.y, pos.y)
    });
    rubberBandRect.size({
      width: Math.abs(pos.x - rubberBandStart.x),
      height: Math.abs(pos.y - rubberBandStart.y)
    });
    state.studioLayer.batchDraw();
    return;
  }

  if (!state.isDrawing || !state.tempShape) return;
  const pos = getStudioWorldPos();
  if (!pos) return;

  const snapped = snapToStudioGrid(pos.x, pos.y, getStudioSnapSize());
  const curX = snapped.x, curY = snapped.y;

  if (state.currentStudioTool === 'line') {
    state.tempShape.points([state.startPos.x, state.startPos.y, curX, curY]);
  } else if (state.currentStudioTool === 'rect') {
    state.tempShape.width(curX - state.startPos.x);
    state.tempShape.height(curY - state.startPos.y);
  } else if (state.currentStudioTool === 'circle') {
    const rad = Math.sqrt(Math.pow(curX - state.startPos.x, 2) + Math.pow(curY - state.startPos.y, 2));
    state.tempShape.radius(rad);
  }
  state.studioLayer.batchDraw();
}

function handleStudioMouseUp() {
  if (rubberBandStart && rubberBandRect) {
    const rx1 = rubberBandRect.x(), ry1 = rubberBandRect.y();
    const rx2 = rx1 + rubberBandRect.width(), ry2 = ry1 + rubberBandRect.height();

    // Only treat this as a selection drag if it covered meaningful area — a
    // near-zero-size drag is just a click on empty canvas (already deselected
    // everything at mousedown).
    if (rubberBandRect.width() > 3 || rubberBandRect.height() > 3) {
      const selected = [];
      state.studioElements.forEach((el, i) => {
        if (elementIntersectsRect(el, rx1, ry1, rx2, ry2)) selected.push(i);
      });
      state.selectedStudioElementIndices = selected;
    }

    rubberBandRect.destroy();
    rubberBandRect = null;
    rubberBandStart = null;
    renderStudioLayer();
    return;
  }

  if (!state.isDrawing) return;
  state.isDrawing = false;

  const pos = getStudioWorldPos();
  if (!pos) return;

  const finalSnapped = snapToStudioGrid(pos.x, pos.y, getStudioSnapSize());
  const curX = finalSnapped.x, curY = finalSnapped.y;

  const dist = Math.hypot(curX - state.startPos.x, curY - state.startPos.y);
  if (dist < 2) {
    if (state.tempShape) state.tempShape.destroy();
    state.tempShape = null; return;
  }

  const originX = state.studioStage.width() / 2;
  const originY = state.studioStage.height() / 2;

  let relativePath = "", rawPath = "";

  const sx = (state.startPos.x - originX) * STUDIO_SCALE, sy = (state.startPos.y - originY) * STUDIO_SCALE;
  const ex = (curX - originX) * STUDIO_SCALE, ey = (curY - originY) * STUDIO_SCALE;

  if (state.currentStudioTool === 'line') {
    relativePath = `M ${sx} ${sy} L ${ex} ${ey}`;
    rawPath = `M ${state.startPos.x} ${state.startPos.y} L ${curX} ${curY}`;
  } else if (state.currentStudioTool === 'rect') {
    const w = (curX - state.startPos.x) * STUDIO_SCALE, h = (curY - state.startPos.y) * STUDIO_SCALE;
    const rawW = curX - state.startPos.x, rawH = curY - state.startPos.y;

    relativePath = `M ${sx} ${sy} L ${sx + w} ${sy} L ${sx + w} ${sy + h} L ${sx} ${sy + h} Z`;
    rawPath = `M ${state.startPos.x} ${state.startPos.y} L ${state.startPos.x + rawW} ${state.startPos.y} L ${state.startPos.x + rawW} ${state.startPos.y + rawH} L ${state.startPos.x} ${state.startPos.y + rawH} Z`;
  } else if (state.currentStudioTool === 'circle') {
    const r = Math.sqrt(Math.pow(curX - state.startPos.x, 2) + Math.pow(curY - state.startPos.y, 2)) * STUDIO_SCALE;
    const rawR = Math.sqrt(Math.pow(curX - state.startPos.x, 2) + Math.pow(curY - state.startPos.y, 2));

    relativePath = `M ${sx - r} ${sy} A ${r} ${r} 0 1 0 ${sx + r} ${sy} A ${r} ${r} 0 1 0 ${sx - r} ${sy}`;
    rawPath = `M ${state.startPos.x - rawR} ${state.startPos.y} A ${rawR} ${rawR} 0 1 0 ${state.startPos.x + rawR} ${state.startPos.y} A ${rawR} ${rawR} 0 1 0 ${state.startPos.x - rawR} ${state.startPos.y}`;
  }

  if (relativePath && rawPath) {
    pushStudioHistory();
    state.studioElements.push({ type: 'path', d: relativePath, rawPath: rawPath, dash: state.currentLineStyle || 'solid' });
  }

  if (state.tempShape) { state.tempShape.destroy(); state.tempShape = null; }
  renderStudioLayer();
}

// Advances the 3-click arc sequence: center -> radius+start angle -> end angle.
function handleArcClick(x, y) {
  if (arcPhase === 0) {
    arcCenter = { x, y };
    arcPhase = 1;
    return;
  }

  if (arcPhase === 1) {
    const dx = x - arcCenter.x, dy = y - arcCenter.y;
    const radius = Math.hypot(dx, dy);
    if (radius < 2) { resetArcSequence(); renderStudioLayer(); return; } // too small — cancel
    arcRadius = radius;
    arcStartAngle = Math.atan2(dy, dx);
    arcPhase = 2;
    return;
  }

  // arcPhase === 2: this click sets the end angle and finalizes the arc.
  const dx = x - arcCenter.x, dy = y - arcCenter.y;
  const endAngle = Math.atan2(dy, dx);
  finalizeArc(arcCenter, arcRadius, arcStartAngle, endAngle);
  resetArcSequence();
}

function renderArcPreview(curX, curY) {
  if (state.tempShape) { state.tempShape.destroy(); state.tempShape = null; }

  if (arcPhase === 1) {
    // Dashed radius guide from the center to the cursor.
    state.tempShape = new Konva.Line({
      points: [arcCenter.x, arcCenter.y, curX, curY],
      stroke: '#2563eb', strokeWidth: 1, dash: [4, 4]
    });
  } else if (arcPhase === 2) {
    const endAngle = Math.atan2(curY - arcCenter.y, curX - arcCenter.x);
    const center = arcCenter, radius = arcRadius, startAngle = arcStartAngle;
    state.tempShape = new Konva.Shape({
      stroke: '#2563eb', strokeWidth: 1,
      sceneFunc: (ctx, shape) => {
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, startAngle, endAngle, false);
        ctx.strokeShape(shape);
      }
    });
  }

  if (state.tempShape) state.studioLayer.add(state.tempShape);
  state.studioLayer.batchDraw();
}

// Builds the arc's SVG path (an elliptical-arc "A" command) from its center,
// radius, and start/end angles, matching the clockwise sweep direction used in
// the live preview (Canvas 2D's ctx.arc with anticlockwise=false corresponds
// directly to SVG's sweep-flag=1, since both use a Y-down coordinate system).
function finalizeArc(center, radius, startAngle, endAngle) {
  const originX = state.studioStage.width() / 2;
  const originY = state.studioStage.height() / 2;

  const startX = center.x + radius * Math.cos(startAngle);
  const startY = center.y + radius * Math.sin(startAngle);
  const endX = center.x + radius * Math.cos(endAngle);
  const endY = center.y + radius * Math.sin(endAngle);

  let sweep = endAngle - startAngle;
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  const largeArcFlag = sweep > Math.PI ? 1 : 0;
  const sweepFlag = 1;

  const rawPath = `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;

  const relStartX = (startX - originX) * STUDIO_SCALE, relStartY = (startY - originY) * STUDIO_SCALE;
  const relEndX = (endX - originX) * STUDIO_SCALE, relEndY = (endY - originY) * STUDIO_SCALE;
  const relRadius = radius * STUDIO_SCALE;
  const relativePath = `M ${relStartX} ${relStartY} A ${relRadius} ${relRadius} 0 ${largeArcFlag} ${sweepFlag} ${relEndX} ${relEndY}`;

  pushStudioHistory();
  state.studioElements.push({ type: 'path', d: relativePath, rawPath, dash: state.currentLineStyle || 'solid' });
  renderStudioLayer();
}

// ---- Which library a symbol is saved into ----
//
// Every symbol made in the Symbol Studio belongs to a library, chosen on
// purpose each time it is saved, so a person's symbols stay organised in the
// sidebar instead of piling up in one undifferentiated list. The choices are
// the libraries already in the project — imported ones included: adding to or
// amending your own copy of Basic is fine, the original file on the server is
// never touched — plus "+ New library…".

const NEW_LIBRARY_SENTINEL = '__new_library__';
const MAX_LIBRARY_NAME_LENGTH = 60;

// Library names started in this studio session that no saved symbol uses yet.
// Kept so they stay selectable until the symbol is actually saved — a library
// only exists in the sidebar once it has something in it.
let pendingLibraryNames = [];

// The library a symbol sits in; the original, untagged ones are "My Symbols".
function libraryKeyOf(symbol) {
  return symbol.library || UNTAGGED_LIBRARY_NAME;
}

function cleanLibraryName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

// Every library name that can be picked: those with visible symbols in them
// (hidden, auto-generated terminal blocks never count), plus any started this
// session. "My Symbols" first, as in the sidebar, then alphabetical.
function getSelectableLibraryNames() {
  const names = new Set();
  Object.values(window.customSymbolDefinitions || {}).forEach(sym => {
    if (!sym.hidden) names.add(libraryKeyOf(sym));
  });
  pendingLibraryNames.forEach(n => names.add(n));
  return sortLibraryNames(names);
}

// "My Symbols" first, as in the sidebar, then everything else alphabetically.
function sortLibraryNames(names) {
  return Array.from(names).sort((a, b) => {
    if (a === UNTAGGED_LIBRARY_NAME) return -1;
    if (b === UNTAGGED_LIBRARY_NAME) return 1;
    return a.localeCompare(b);
  });
}

// Rebuilds the "Library" dropdown in the Symbol Creator. currentLibrary is
// the one to show as chosen; '' leaves it on the "Choose a library…" prompt.
export function populateSymbolLibraryDropdown(currentLibrary) {
  const select = document.getElementById('symLibrary');
  if (!select) return;
  select.innerHTML = '';

  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Choose a library…';
  prompt.disabled = true; // a starting point, not an answer
  select.appendChild(prompt);

  // Names go in as text, never as markup: a library can be called anything.
  getSelectableLibraryNames().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = NEW_LIBRARY_SENTINEL;
  newOpt.textContent = '+ New library…';
  select.appendChild(newOpt);

  select.value = currentLibrary || '';
}

// Wired to the dropdown's onchange. Picking an existing library needs nothing
// more; "+ New library…" asks for a name and then selects it — or, if that is
// cancelled, puts the dropdown back to what it was, never leaving the
// "+ New library…" entry itself selected.
export async function handleSymbolLibraryChange(selectEl, previousValue) {
  if (!selectEl || selectEl.value !== NEW_LIBRARY_SENTINEL) return;

  const revertTo = previousValue && previousValue !== NEW_LIBRARY_SENTINEL ? previousValue : '';
  const typed = await appPrompt('Name the new library — for example a manufacturer, or the kind of equipment its symbols are for:', '', 'New library');
  const name = cleanLibraryName(typed);

  if (!name) { populateSymbolLibraryDropdown(revertTo); return; } // cancelled, or left blank
  if (name.length > MAX_LIBRARY_NAME_LENGTH) {
    await appAlert(`Library names can be up to ${MAX_LIBRARY_NAME_LENGTH} characters.`);
    populateSymbolLibraryDropdown(revertTo);
    return;
  }

  // An existing library in a different capitalisation is the same library —
  // pick that one rather than create a near-duplicate beside it. "My Symbols"
  // is likewise always the one library for the older, untagged symbols.
  const existing = getSelectableLibraryNames().find(n => n.toLowerCase() === name.toLowerCase());
  const chosen = existing
    || (name.toLowerCase() === UNTAGGED_LIBRARY_NAME.toLowerCase() ? UNTAGGED_LIBRARY_NAME : name);
  if (!getSelectableLibraryNames().includes(chosen)) pendingLibraryNames.push(chosen);
  populateSymbolLibraryDropdown(chosen);
}

export async function saveCustomSymbol(renderSymbolsListCallback, renderComponentsCallback) {
  const nameInput = document.getElementById('symName');
  const prefixInput = document.getElementById('symPrefix');
  const valueInput = document.getElementById('symValue');
  const librarySelect = document.getElementById('symLibrary');

  const name = nameInput ? nameInput.value.trim() : '';
  const prefix = (prefixInput && prefixInput.value.trim()) || 'U';
  const value = (valueInput && valueInput.value.trim()) || 'CUSTOM';

  if (!name) { await appAlert("Please enter a symbol name."); return; }

  // Every symbol has to be saved into a library, chosen on purpose.
  const chosenLibrary = librarySelect ? librarySelect.value : '';
  if (!chosenLibrary || chosenLibrary === NEW_LIBRARY_SENTINEL) {
    await appAlert('Please choose which library to save this symbol to, or pick "+ New library…" to start one. Libraries keep your symbols organised in the sidebar.');
    if (librarySelect && typeof librarySelect.focus === 'function') librarySelect.focus();
    return;
  }
  // "My Symbols" is the name for the original, untagged symbols, so choosing
  // it stores no tag at all — exactly as such symbols always have been (see
  // exportSymbolLibrary, which treats untagged symbols specially).
  const libraryTag = chosenLibrary === UNTAGGED_LIBRARY_NAME ? null : chosenLibrary;

  const pathSegments = state.studioElements
    .filter(e => e.type === 'path')
    .map(e => ({ d: e.d, dash: e.dash || 'solid' }));
  const pinCoords = state.studioElements.filter(e => e.type === 'pin').map((p, idx) => ({ id: `${idx + 1}`, relX: p.relX, relY: p.relY, rotation: p.rotation || 0, ...(cleanPinName(p.name) ? { name: cleanPinName(p.name) } : {}), ...(cleanPinName(p.name) && Number.isFinite(p.nameOffX) && Number.isFinite(p.nameOffY) ? { nameDx: p.nameOffX * STUDIO_SCALE, nameDy: p.nameOffY * STUDIO_SCALE } : {}) }));
  const textElements = state.studioElements.filter(e => e.type === 'text').map(t => ({ text: t.text, relX: t.relX, relY: t.relY, fontSize: t.fontSize || 12, rotation: t.rotation || 0, ...(t.fontFamily && t.fontFamily !== 'sans-serif' ? { fontFamily: t.fontFamily } : {}), ...(t.bold ? { bold: true } : {}), ...(t.italic ? { italic: true } : {}), ...(t.underline ? { underline: true } : {}) }));

  const defs = window.customSymbolDefinitions;
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(defs, k);
  const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const sourceKey = state.editingSymbolKey;
  const source = sourceKey ? defs[sourceKey] : null;

  // Editing a symbol and keeping its name updates THAT symbol, in place (and
  // may move it to a different library). Anything else — a brand-new symbol,
  // or an edit saved under a new name — is a new symbol, and a new symbol
  // never overwrites anything.
  const updatingInPlace = !!source && sameName(name, source.name);

  // Two symbols with the same name in one library would be impossible to tell
  // apart in the sidebar. (The same name in DIFFERENT libraries is fine —
  // Siemens and ABB each having a "Contactor" is the whole point of libraries.)
  const clash = Object.entries(defs).find(([key, sym]) =>
    !sym.hidden && !(updatingInPlace && key === sourceKey)
    && libraryKeyOf(sym) === (libraryTag || UNTAGGED_LIBRARY_NAME) && sameName(sym.name, name));
  if (clash) {
    await appAlert(`"${chosenLibrary}" already has a symbol called "${name}". Choose a different name, or find that symbol in the sidebar and use Edit to change it.`);
    return;
  }

  let symKey;
  if (updatingInPlace) {
    symKey = sourceKey;
  } else {
    // The key used to be just the name, which silently replaced whatever
    // already had it — now a symbol of the same name in another library would
    // be destroyed. Never overwrite: if the key is taken, make it unique.
    const base = `custom_${name.toLowerCase().replace(/\s+/g, '_')}`;
    symKey = base;
    if (hasKey(symKey)) {
      const slug = chosenLibrary.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'library';
      symKey = `${base}__${slug}`;
      for (let n = 2; hasKey(symKey); n++) symKey = `${base}__${slug}_${n}`;
    }
  }

  pushHistory();
  // An in-place edit starts from what was already there, so anything about the
  // symbol this form doesn't touch is kept rather than silently dropped.
  const definition = {
    ...(updatingInPlace ? source : {}),
    name: name, prefix: prefix, value: value,
    pathData: pathSegments, pins: pinCoords, texts: textElements
  };
  if (libraryTag) definition.library = libraryTag; else delete definition.library;
  defs[symKey] = definition;

  state.editingSymbolKey = null;
  pendingLibraryNames = [];
  if (renderSymbolsListCallback) renderSymbolsListCallback();
  if (renderComponentsCallback) renderComponentsCallback();
  scheduleAutosave();

  if (nameInput) nameInput.value = '';
  if (prefixInput) prefixInput.value = '';
  if (valueInput) valueInput.value = '';

  clearStudioCanvas();
  closeSymbolCreator();
}

export function openTerminalBlockModal() {
  const modal = document.getElementById('terminalBlockModal');
  if (modal) modal.style.display = 'flex';
  toggleTerminalBlockMode();
}

export function closeTerminalBlockModal() {
  const modal = document.getElementById('terminalBlockModal');
  if (modal) modal.style.display = 'none';
}

export function toggleTerminalBlockMode() {
  const isTable = document.getElementById('tbMode')?.value !== 'sequential';
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? 'block' : 'none'; };
  show('tbTableFields', isTable);
  show('tbNameFields', !isTable);
  show('tbSequentialFields', !isTable);
  const footer = document.getElementById('tbFooterHint');
  if (footer) footer.textContent = isTable
    ? 'Places the table on the current sheet, ready to move. It is a snapshot of the wire IDs as they are now: generate it again after changing terminals or wires.'
    : 'Adds a new symbol to your Custom Symbols list \u2014 drag it onto a sheet like any other, or edit it further in the Symbol Studio.';
  if (isTable) populateTerminalBlockOptions();
}

// Rebuilds the "Terminal block" dropdown from the terminals that are on the
// sheets right now, so it is always current when the modal is opened (or the
// table mode is re-selected) \u2014 never stale from an earlier session or an edit
// made since. The current choice is kept if it is still a valid one; otherwise
// it goes back to "All blocks". Also says how many terminals have no block yet
// and so cannot be in the table.
function populateTerminalBlockOptions() {
  const select = document.getElementById('tbDesignator');
  if (!select) return;
  const previous = select.value;
  const blocks = listTerminalBlocks();

  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = ''; all.textContent = 'All blocks';
  select.appendChild(all);
  blocks.forEach(block => {
    const opt = document.createElement('option');
    opt.value = block.key;
    opt.textContent = `${block.displayName}  (${block.terminals.length})`;
    select.appendChild(opt);
  });
  select.value = blocks.some(b => b.key === previous) ? previous : '';

  const unassigned = countUnassignedTerminals();
  const info = document.getElementById('tbUnassignedInfo');
  if (info) {
    info.style.display = unassigned > 0 ? 'block' : 'none';
    info.textContent = unassigned > 0
      ? `${unassigned} terminal${unassigned === 1 ? ' has' : 's have'} no block and position yet, so ${unassigned === 1 ? 'it is' : 'they are'} left out. Double-click a terminal to assign it.`
      : '';
  }
}

// Generates a custom symbol representing a terminal strip: a single rail with a
// short tick and a pin at each terminal, numbered sequentially. Saved through
// the same customSymbolDefinitions schema as a hand-drawn symbol, so it's
// draggable onto a sheet immediately and fully editable afterward in the
// Studio (including fine-tuning with zoom) exactly like any other symbol.
export async function generateTerminalBlock(renderSymbolsListCallback, renderComponentsCallback) {
  const nameInput = document.getElementById('tbName');
  const prefixInput = document.getElementById('tbPrefix');
  const modeInput = document.getElementById('tbMode');

  const mode = modeInput?.value === 'sequential' ? 'sequential' : 'table';
  let name = (nameInput?.value.trim()) || 'Terminal Block';
  let prefix = (prefixInput?.value.trim()) || 'X';

  let pathSegments, pins, texts, symbolValue, tableSize = null, tableSpec = null;

  if (mode === 'table') {
    const chosenBlock = document.getElementById('tbDesignator')?.value || '';
    // Reads the wire IDs from every sheet as they are right now.
    const { blocks, unassigned } = collectTerminalTableData(chosenBlock);

    if (blocks.length === 0) {
      if (chosenBlock) {
        await appAlert('That terminal block no longer has any terminals.\n\nIt may have been renamed or removed since this dialog opened \u2014 choose another block, or "All blocks".');
      } else {
        await appAlert('No terminals have been assigned to a terminal block yet.\n\nPlace terminals with the Terminal tool (it asks which block and position each one is), or double-click a terminal already on a sheet to assign it \u2014 then generate again.' +
          (unassigned ? `\n\n(${unassigned} terminal${unassigned === 1 ? ' is' : 's are'} waiting to be assigned.)` : ''));
      }
      return;
    }
    tableSpec = {
      blockKey: chosenBlock,
      order: document.getElementById('tbOrder')?.value === 'desc' ? 'desc' : 'asc',
      orientation: document.getElementById('tbLayout')?.value === 'horizontal' ? 'horizontal' : 'vertical',
      dest: document.getElementById('tbDest') ? !!document.getElementById('tbDest').checked : true,
      swap: !!(document.getElementById('tbSwap') && document.getElementById('tbSwap').checked)
    };
    const built = buildTerminalTableGeometry(buildTerminalTableMatrix(blocks, tableSpec));
    pathSegments = built.pathSegments; pins = built.pins; texts = built.texts;
    tableSize = { width: built.width, height: built.height };
    name = 'Terminal Table';
    prefix = 'TERMTBL';
    // A single space, not empty: a component's Value is auto-drawn on the
    // sheet above whatever it's placed on, and left genuinely empty (''),
    // the placement code falls back to showing the word "CUSTOM" instead —
    // fine for a hand-drawn symbol with no value set, but exactly the kind
    // of clutter this generator is trying to avoid. A lone space is a real,
    // "truthy" value (so that fallback never kicks in) that renders as
    // nothing visible.
    symbolValue = ' ';
  } else {
    const countInput = document.getElementById('tbCount');
    const startInput = document.getElementById('tbStart');
    const spacingInput = document.getElementById('tbSpacing');
    const orientationInput = document.getElementById('tbOrientation');
    const count = Math.max(1, Math.min(100, parseInt(countInput?.value, 10) || 10));
    const startNum = parseInt(startInput?.value, 10);
    const startNumber = Number.isFinite(startNum) ? startNum : 1;
    const spacing = Math.max(10, parseInt(spacingInput?.value, 10) || 20);
    const orientation = orientationInput?.value === 'horizontal' ? 'horizontal' : 'vertical';
    const terminalIds = Array.from({ length: count }, (_, i) => `${startNumber + i}`);

    const tickLength = 15;
    const totalSpan = (count - 1) * spacing;
    const halfSpan = totalSpan / 2;
    pathSegments = []; pins = []; texts = [];

    if (orientation === 'vertical') {
      pathSegments.push({ d: `M 0 ${-halfSpan} L 0 ${halfSpan}`, dash: 'solid' });
      terminalIds.forEach((termId, i) => {
        const y = -halfSpan + i * spacing;
        pathSegments.push({ d: `M 0 ${y} L ${tickLength} ${y}`, dash: 'solid' });
        pins.push({ id: termId, relX: tickLength, relY: y });
        texts.push({ text: termId, relX: tickLength + 4, relY: y - 8, fontSize: 10 });
      });
    } else {
      pathSegments.push({ d: `M ${-halfSpan} 0 L ${halfSpan} 0`, dash: 'solid' });
      terminalIds.forEach((termId, i) => {
        const x = -halfSpan + i * spacing;
        pathSegments.push({ d: `M ${x} 0 L ${x} ${tickLength}`, dash: 'solid' });
        pins.push({ id: termId, relX: x, relY: tickLength });
        texts.push({ text: termId, relX: x - 4, relY: tickLength + 10, fontSize: 10 });
      });
    }
    symbolValue = `${count}-way`;
  }

  // A table is documentation: its key marks it so the sheet draws no designator
  // for it and the BOM does not count it as a part.
  const symKey = mode === 'table' ? `${TERMINAL_TABLE_SYMBOL_PREFIX}${Date.now()}` : `custom_terminal_${Date.now()}`;

  pushHistory();
  window.customSymbolDefinitions[symKey] = {
    name, prefix, value: symbolValue,
    pathData: pathSegments, pins, texts,
    tableSpec: tableSpec || undefined,
    hidden: mode === 'table' // placed straight onto the sheet below, not kept as a reusable library entry
  };

  if (mode === 'table') {
    // Straight onto the active sheet, centred in whatever's currently in
    // view and selected, ready to reposition — the same placement Insert
    // Image uses, rather than requiring a drag from the sidebar for
    // something just generated fresh from the portfolio's own data.
    const sheet = getActiveSheet();
    if (sheet) {
      if (!sheet.components) sheet.components = [];
      const scale = stage.scaleX() || 1;
      const viewCenterX = (stage.width() / 2 - stage.x()) / scale;
      const viewCenterY = (stage.height() / 2 - stage.y()) / scale;
      const { value: compValue } = getPrefixAndValue(symKey);
      const compId = Date.now() + 1; // distinct from symKey's own timestamp
      const newComp = {
        id: compId, type: symKey, label: nextLabelForType(sheet, symKey), value: compValue,
        modelNo: '', make: '', description: '',
        // its centre, not its corner, goes at the centre of the view
        x: snapToGrid(viewCenterX - tableSize.width / 2), y: snapToGrid(viewCenterY - tableSize.height / 2), rotation: 0
      };
      sheet.components.push(newComp);
      state.selectedComponentId = compId;
    }
  }

  if (renderSymbolsListCallback) renderSymbolsListCallback();
  if (renderComponentsCallback) renderComponentsCallback();
  scheduleAutosave();
  closeTerminalBlockModal();
}

// Terminal tables made with this version remember what they were made from (their block, order, layout and whether they show
// origin / destination), so they can be rebuilt from the sheets as they are now. Tables from an earlier version stay as drawn.
// Returns how many changed.
export function refreshTerminalTables() {
  const defs = window.customSymbolDefinitions || {};
  let changed = 0;
  Object.keys(defs).forEach(key => {
    const def = defs[key];
    if (!def || !def.tableSpec || !String(key).startsWith(TERMINAL_TABLE_SYMBOL_PREFIX)) return;
    const spec = def.tableSpec;
    const { blocks } = collectTerminalTableData(spec.blockKey || '');
    if (!blocks.length) return;   // the block is gone: leave the table as it was
    const built = buildTerminalTableGeometry(buildTerminalTableMatrix(blocks, spec));
    const before = JSON.stringify([def.pathData, def.texts]);
    if (before === JSON.stringify([built.pathSegments, built.texts])) return;
    def.pathData = built.pathSegments; def.pins = built.pins; def.texts = built.texts;
    changed++;
  });
  return changed;
}
let tableRefreshTimer = null;
// After an edit: rebuild the tables once things have settled, and redraw only if one actually changed.
export function refreshTerminalTablesSoon() {
  const defs = window.customSymbolDefinitions || {};
  if (!Object.keys(defs).some(k => defs[k] && defs[k].tableSpec)) return;
  if (tableRefreshTimer) clearTimeout(tableRefreshTimer);
  tableRefreshTimer = setTimeout(() => {
    tableRefreshTimer = null;
    try { if (refreshTerminalTables() > 0 && typeof window.refreshCanvas === 'function') window.refreshCanvas(); } catch (err) { /* a table that cannot be rebuilt stays as drawn */ }
  }, 900);
}
window.refreshTerminalTables = refreshTerminalTables;
window.refreshTerminalTablesSoon = refreshTerminalTablesSoon;

export function deleteCustomSymbol(e, symKey, renderSymbolsListCallback, renderComponentsCallback) {
  if (e) e.stopPropagation();
  pushHistory();
  if (delete window.customSymbolDefinitions[symKey]) {
    if (renderSymbolsListCallback) renderSymbolsListCallback();
    if (renderComponentsCallback) renderComponentsCallback();
    scheduleAutosave();
  }
}

// ---- Export Library: say WHICH library to export ----
//
// Export Library opens a small picker listing the libraries in the project
// (with how many symbols each holds); Export then writes exactly that one
// library to a file and nothing else — so exporting "Siemens" can never
// bundle in, or relabel, someone else's Basic or ABB symbols.

// How many visible symbols each library holds. Hidden, auto-generated
// terminal block symbols (see generateTerminalBlock) are specific to one
// project's own wiring and never belong in a shared library, so they are not
// counted — and never exported.
function countSymbolsByLibrary() {
  const counts = new Map();
  Object.values(window.customSymbolDefinitions || {}).forEach(sym => {
    if (sym.hidden) return;
    const lib = libraryKeyOf(sym);
    counts.set(lib, (counts.get(lib) || 0) + 1);
  });
  return counts;
}

// Opens the picker. (Still called exportSymbolLibrary because that is what
// the Export Library button has always called.)
export async function exportSymbolLibrary() {
  const counts = countSymbolsByLibrary();
  if (counts.size === 0) {
    await appAlert("No custom symbols to export!"); return;
  }

  const modal = document.getElementById('exportLibraryModal');
  const select = document.getElementById('exportLibrarySelect');
  if (!modal || !select) return;

  select.innerHTML = '';
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Choose a library…';
  prompt.disabled = true; // a starting point, not an answer
  select.appendChild(prompt);

  // Names go in as text, never as markup: a library can be called anything.
  const names = sortLibraryNames(counts.keys());
  names.forEach(name => {
    const n = counts.get(name);
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${n} symbol${n === 1 ? '' : 's'})`;
    select.appendChild(opt);
  });

  // With only one library there is nothing to decide, so it is already chosen.
  select.value = names.length === 1 ? names[0] : '';
  modal.style.display = 'flex';
}

export function closeExportLibraryModal() {
  const modal = document.getElementById('exportLibraryModal');
  if (modal) modal.style.display = 'none';
}

// The picker's Export button.
export async function confirmExportLibrary() {
  const select = document.getElementById('exportLibrarySelect');
  const chosen = select ? select.value : '';
  if (!chosen) {
    await appAlert('Please choose which library to export.');
    if (select && typeof select.focus === 'function') select.focus();
    return;
  }

  // The older, untagged symbols ("My Symbols") have no library name of their
  // own to export under, so ask for one. Everything else is exported under
  // the name it already has.
  let exportName = chosen;
  if (chosen === UNTAGGED_LIBRARY_NAME) {
    const typed = await appPrompt('These symbols are not in a named library yet. What should the exported library be called? (It is shown as its own section when someone imports it.)', '', 'Name this library');
    if (typed === null) return; // cancelled — the picker stays open to choose again
    exportName = cleanLibraryName(typed);
    if (!exportName) { await appAlert('A library needs a name.'); return; }
    if (exportName.length > MAX_LIBRARY_NAME_LENGTH) {
      await appAlert(`Library names can be up to ${MAX_LIBRARY_NAME_LENGTH} characters.`);
      return;
    }
  }

  const symbols = {};
  Object.entries(window.customSymbolDefinitions).forEach(([key, sym]) => {
    if (sym.hidden) return;
    if (libraryKeyOf(sym) !== chosen) return;
    symbols[key] = { ...sym, library: exportName };
  });

  if (Object.keys(symbols).length === 0) {
    await appAlert(`"${chosen}" has no symbols to export.`);
    return;
  }

  const libraryData = {
    type: "SymbolLibrary", version: "1.1",
    libraryName: exportName,
    exportedAt: new Date().toISOString(),
    symbols
  };

  const jsonStr = JSON.stringify(libraryData, null, 2);
  const safeFilename = exportName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'symbol_library';
  await saveTextFile(jsonStr, `${safeFilename}.json`, 'application/json', 'Symbol Library (JSON)');
  closeExportLibraryModal();
}

// Merges an imported set of symbols into customSymbolDefinitions. A symbol that
// arrives with no .library tag of its own (older export files, from before
// libraries were named) is tagged with fallbackLibraryName so it still gets a
// sensible section instead of silently joining "My Symbols".
//
// When a key is already taken:
//   - by a symbol in a DIFFERENT library (two independently-authored libraries
//     can both derive "custom_relay" from a symbol named "Relay"): the newcomer
//     is always kept under a renamed key, never dropped or merged into the
//     wrong symbol.
//   - by the SAME symbol of the SAME library (the library is being loaded
//     again): sameLibrary decides - 'overwrite' replaces it with the incoming
//     version (placed instances follow, as they are drawn from the definition),
//     'skip' leaves the existing one alone, and 'rename' (the old behaviour)
//     keeps both under a renamed key.
// Returns { added, replaced, skipped, renamed }.
export function mergeImportedSymbols(importedSymbols, fallbackLibraryName, sameLibrary = 'rename') {
  const result = { added: 0, replaced: 0, skipped: 0, renamed: 0 };
  const librarySlug = String(fallbackLibraryName || 'library').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'library';
  const has = key => Object.prototype.hasOwnProperty.call(window.customSymbolDefinitions, key);

  Object.keys(importedSymbols).forEach(symKey => {
    const sym = importedSymbols[symKey];
    if (!sym.library) sym.library = fallbackLibraryName || 'Imported';

    let targetKey = symKey;
    if (has(targetKey)) {
      const existing = window.customSymbolDefinitions[targetKey];
      if (!existing.hidden && libraryKeyOf(existing) === libraryKeyOf(sym) && sameLibrary !== 'rename') {
        if (sameLibrary === 'skip') { result.skipped++; return; }
        window.customSymbolDefinitions[targetKey] = sym;
        result.replaced++;
        return;
      }
      let suffix = 2;
      let candidate = `${symKey}__${librarySlug}`;
      while (has(candidate)) {
        candidate = `${symKey}__${librarySlug}_${suffix}`;
        suffix++;
      }
      targetKey = candidate;
      result.renamed++;
    } else {
      result.added++;
    }
    window.customSymbolDefinitions[targetKey] = sym;
  });

  return result;
}

// How many of the incoming symbols are already in the project as the same symbol of the same library.
function countSameLibraryMatches(importedSymbols, fallbackLibraryName) {
  let n = 0;
  Object.keys(importedSymbols).forEach(symKey => {
    const sym = importedSymbols[symKey];
    const existing = window.customSymbolDefinitions[symKey];
    if (!existing || existing.hidden || !sym) return;
    const incomingLibrary = sym.library || fallbackLibraryName || 'Imported';
    if (libraryKeyOf(existing) === incomingLibrary) n++;
  });
  return n;
}

// Shared by Browse Libraries and Import from file. Loading a library that is already in the project asks what to do
// with the symbols that are already there, rather than quietly adding a second copy of each one.
// Returns the summary text to show, or null if nothing was changed.
async function applyImportedLibrary(importedSymbols, libraryName, renderSymbolsListCallback, renderComponentsCallback) {
  repairSymbolLibrary(importedSymbols); // libraries exported by older versions can carry damaged arcs
  const total = Object.keys(importedSymbols).length;
  const matches = countSameLibraryMatches(importedSymbols, libraryName);

  let mode = 'rename';
  if (matches > 0) {
    const overwrite = await appConfirm(
      `"${libraryName}" is already in this project: ${matches} of its ${total} symbol${total === 1 ? '' : 's'} ${matches === 1 ? 'is' : 'are'} here already.\n\n` +
      `Overwrite ${matches === 1 ? 'it' : 'those ' + matches} with the version you are loading? Any of them already placed on your sheets will change to match, and edits you made to ${matches === 1 ? 'it' : 'them'} will be lost. Your other symbols are not touched.\n\n` +
      `Choose "Keep mine" to leave ${matches === 1 ? 'it' : 'them'} as ${matches === 1 ? 'it is' : 'they are'} and only add what is missing.`,
      'Library already loaded', { okText: 'Overwrite', cancelText: 'Keep mine' });
    mode = overwrite ? 'overwrite' : 'skip';
  }

  pushHistory();
  const r = mergeImportedSymbols(importedSymbols, libraryName, mode);
  if (renderSymbolsListCallback) renderSymbolsListCallback();
  if (r.replaced > 0 && renderComponentsCallback) renderComponentsCallback(); // placed symbols are drawn from the definition
  scheduleAutosave();

  const parts = [];
  if (r.added) parts.push(`${r.added} added`);
  if (r.replaced) parts.push(`${r.replaced} overwritten`);
  if (r.skipped) parts.push(`${r.skipped} already here, kept as they were`);
  if (r.renamed) parts.push(`${r.renamed} with a name clash kept as separate entries rather than overwriting what was already there`);
  return parts.length ? `"${libraryName}" imported: ${parts.join(', ')}.` : `"${libraryName}" was already up to date.`;
}

// ---- Browse Libraries: fetches the catalog from symbol-libraries/list.php
// (every .json file the account owner has dropped in that folder on the
// server) and lets the person pick one to import with a single click,
// rather than needing the file downloaded and fed through the file-upload
// Import button by hand. ----

export async function openBrowseLibrariesModal(renderSymbolsListCallback, renderComponentsCallback) {
  const modal = document.getElementById('browseLibrariesModal');
  const listEl = document.getElementById('browseLibrariesList');
  if (!modal || !listEl) return;
  modal.style.display = 'flex';
  listEl.innerHTML = '<p class="modal-hint">Loading…</p>';

  let data;
  let noAccessMessage = null;
  try {
    const res = await fetch('/symbol-libraries/list.php', { headers: { 'X-CSRF-Token': window.csrfToken || '' }, credentials: 'same-origin' });
    data = await res.json();
    // Libraries are a free-trial / Pro feature and the server enforces that.
    // An account without access gets a plain-language reason back, which is
    // worth showing as it is — "could not load, try again" would suggest
    // something was broken when nothing is.
    if (res.status === 403 && data?.error === 'libraries_pro') {
      noAccessMessage = data.message;
      throw new Error('libraries_pro');
    }
    if (!res.ok || !data?.success) throw new Error(data?.message || `HTTP ${res.status}`);
  } catch (err) {
    if (noAccessMessage) {
      // The message comes from the server, so it goes in as text, never as markup.
      listEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'modal-hint';
      p.textContent = noAccessMessage;
      listEl.appendChild(p);
    } else {
      listEl.innerHTML = '<p class="modal-hint">Could not load the library list. Please try again.</p>';
    }
    return;
  }

  if (!data.libraries.length) {
    listEl.innerHTML = '<p class="modal-hint">No libraries available yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  data.libraries.forEach(lib => {
    const row = document.createElement('div');
    row.className = 'browse-library-row';
    const label = document.createElement('div');
    label.textContent = `${lib.libraryName} (${lib.symbolCount} symbol${lib.symbolCount === 1 ? '' : 's'})`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Import';
    btn.onclick = () => importLibraryFromCatalog(lib.filename, lib.libraryName, btn, renderSymbolsListCallback, renderComponentsCallback);
    row.appendChild(label);
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

export function closeBrowseLibrariesModal() {
  const modal = document.getElementById('browseLibrariesModal');
  if (modal) modal.style.display = 'none';
}

async function importLibraryFromCatalog(filename, libraryName, btnEl, renderSymbolsListCallback, renderComponentsCallback) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Importing…'; }
  try {
    // Through get.php, which checks the account's plan — the .json files
    // themselves can't be fetched directly.
    const res = await fetch('/symbol-libraries/get.php?file=' + encodeURIComponent(filename), { credentials: 'same-origin' });
    const data = await res.json();
    // An error reply is a small JSON object too (success: false, message) —
    // without this check it would be mistaken for a library and "imported".
    if (!res.ok) {
      await appAlert(data?.message || 'Could not import that library.');
      return;
    }
    const importedSymbols = data.symbols || data;
    if (typeof importedSymbols !== 'object') {
      await appAlert('That library file looks invalid.');
      return;
    }

    const summary = await applyImportedLibrary(importedSymbols, data.libraryName || libraryName, renderSymbolsListCallback, renderComponentsCallback);
    closeBrowseLibrariesModal();
    await appAlert(summary);
  } catch (err) {
    await appAlert('Could not import that library: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Import'; }
  }
}

export function importSymbolLibrary(event, renderSymbolsListCallback, renderComponentsCallback) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      const importedSymbols = data.symbols || data;

      if (typeof importedSymbols !== 'object') {
        await appAlert("Invalid symbol library format."); return;
      }

      // Falls back to the file's own name (minus .json) when the file predates
      // libraryName being included at all, so it still gets a sensible section.
      const fallbackName = data.libraryName || file.name.replace(/\.json$/i, '');
      const summary = await applyImportedLibrary(importedSymbols, fallbackName, renderSymbolsListCallback, renderComponentsCallback);
      await appAlert(summary);
    } catch (err) {
      await appAlert("Error reading symbol file: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}