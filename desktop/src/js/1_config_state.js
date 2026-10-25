// ==========================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================
import { DEFAULT_SYMBOL_LIBRARY } from './0_default_symbol_library.js';
import { freshDefaultTerminalModels } from './0_default_terminal_models.js';
import { freshDefaultCableLibrary } from './0_default_cables.js';

export const GRID_SIZE = 20;
export const todayStr = new Date().toISOString().split('T')[0];

export function snapToGrid(value, gridSize = GRID_SIZE) {
  return Math.round(value / gridSize) * gridSize;
}

// ISO Standard Page Configurations
export const SHEET_CONFIGS = {
  A4: { width: 1123, height: 794 },  
  A3: { width: 1587, height: 1123 }, 
  A2: { width: 2245, height: 1587 }  
};

// Global Custom Symbol Registry — a brand-new session (no autosave, no
// project loaded yet) starts from DEFAULT_SYMBOL_LIBRARY, which is currently
// empty on purpose: people add the Basic library themselves from Browse
// Libraries. Still a structuredClone, so that if starter symbols are ever put
// back, editing or deleting one can never mutate DEFAULT_SYMBOL_LIBRARY
// itself, which would otherwise leak into every later "start new project"
// within the same page session.
window.customSymbolDefinitions = window.customSymbolDefinitions || structuredClone(DEFAULT_SYMBOL_LIBRARY);

// ---- App-styled replacements for native alert()/confirm()/prompt() ----
// A single shared modal (#appDialogModal in index.php) handles all three —
// only one can be showing at a time, so every call site MUST await it
// rather than firing and forgetting, or a second call would silently steal
// the first one's resolution.
let dialogResolve = null;

function showDialog({ title, message, type, defaultValue, okText, cancelText }) {
  return new Promise((resolve) => {
    const titleEl = document.getElementById('appDialogTitle');
    const messageEl = document.getElementById('appDialogMessage');
    const inputEl = document.getElementById('appDialogInput');
    const cancelBtn = document.getElementById('appDialogCancelBtn');
    const okBtn = document.getElementById('appDialogOkBtn');
    const modal = document.getElementById('appDialogModal');

    if (!modal || !titleEl || !messageEl || !inputEl || !cancelBtn || !okBtn) {
      // Defensive fallback — should never trigger if the modal markup is present
      if (type === 'prompt') resolve(window.prompt(message, defaultValue || ''));
      else if (type === 'confirm') resolve(window.confirm(message));
      else { window.alert(message); resolve(undefined); }
      return;
    }

    dialogResolve = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;

    if (type === 'prompt') {
      inputEl.style.display = 'block';
      inputEl.value = defaultValue || '';
    } else {
      inputEl.style.display = 'none';
    }

    cancelBtn.style.display = (type === 'alert') ? 'none' : 'inline-flex';
    // Set on EVERY call (falling back to the defaults) — the one modal is reused,
    // so labels left over from a custom dialog would otherwise leak into the next.
    cancelBtn.textContent = cancelText || 'Cancel';
    okBtn.textContent = okText || (type === 'confirm' ? 'Confirm' : 'OK');

    modal.style.display = 'flex';
    if (type === 'prompt') setTimeout(() => inputEl.focus(), 0);
  });
}

function closeDialog(result) {
  const modal = document.getElementById('appDialogModal');
  if (modal) modal.style.display = 'none';
  if (dialogResolve) {
    dialogResolve(result);
    dialogResolve = null;
  }
}

// True for an account on the free plan with no trial running — what index.php
// hands the page as window.currentUser.plan is the plan the SERVER applies (a
// running trial already counts as 'pro'). Used where script would otherwise
// re-enable a control the page rendered as a Pro-only stub. It only keeps the
// page honest: the real boundary is the server (see projects/save.php), and an
// unknown plan is treated as not-free for that reason.
export function isFreePlan() {
  return window.currentUser?.plan === 'free';
}

// Sheet groups (Power, Control, PLC I/O ...) are a Pro feature. A Free account keeps any group names already in a
// project but sees the plain, flat tab bar and contents.
export function sheetGroupsOn() {
  return !isFreePlan();
}

// The group a sheet belongs to ('' for none).
export function sheetGroupOf(sheet) {
  return sheetGroupsOn() && sheet && typeof sheet.group === 'string' ? sheet.group : '';
}

// ---- sections (the portfolio tree) ----
// A sheet's `group` is the path of the section it sits in: 'Power', or 'Power/Motors' for a section inside another.
// A section can be up to three levels deep. Older projects only ever had one level, which is the same thing.
export const SECTION_MAX_DEPTH = 3;
export const cleanSectionName = (v) => String(v || '').replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 40);
export function cleanSectionPath(v) {
  return String(v || '').split('/').map(cleanSectionName).filter(Boolean).slice(0, SECTION_MAX_DEPTH).join('/');
}
export const cleanSectionList = (v) => Array.isArray(v) ? [...new Set(v.map(cleanSectionPath).filter(Boolean))] : [];
export const sectionDepth = (path) => path ? path.split('/').length : 0;
export const sectionParent = (path) => path.split('/').slice(0, -1).join('/');
export const sectionLeaf = (path) => path.split('/').pop();
// Is `path` the section `root` or something inside it?
export const inSection = (path, root) => !!path && (path === root || path.startsWith(root + '/'));

// ---- the letter(s) in front of automatic wire numbers (W105, C204) ----
// Set for the whole project in Project & title block, and optionally on a sheet to override it. Letters, '.', '_' and '-' only
// (never digits, which would run into the number), at most four.
export function cleanWirePrefix(v) {
  return String(v ?? '').replace(/[^A-Za-z._\-]/g, '').slice(0, 4);
}
export function wirePrefixOf(sheet) {
  const own = sheet && typeof sheet.wirePrefix === 'string' ? cleanWirePrefix(sheet.wirePrefix) : '';
  return own || cleanWirePrefix(state.projectInfo && state.projectInfo.wireIdPrefix);
}

// ---- review state, notes and the =function / +location reference of a sheet (Pro) ----
// Review state is the sheet's place in the checking process, separate from the "document status" text
// in the title block. '' means nobody has set one.
export const SHEET_REVIEW_STATES = [
  { id: '',         label: 'Not set',        colour: '' },
  { id: 'draft',    label: 'Draft',          colour: '#94a3b8' },
  { id: 'check',    label: 'Needs checking', colour: '#f59e0b' },
  { id: 'checked',  label: 'Checked',        colour: '#3b82f6' },
  { id: 'approved', label: 'Approved',       colour: '#22c55e' }
];
export function sheetReviewOf(sheet) {
  if (!sheetGroupsOn() || !sheet) return null;
  return SHEET_REVIEW_STATES.find(s => s.id && s.id === sheet.review) || null;
}

// The function aspect typed on a sheet, tidied to what follows an "=" ("P1", "PUMPS.1"). Anything else is dropped.
export function cleanFunctionTag(v) {
  return String(v ?? '').replace(/^[=\s]+/, '').replace(/[^A-Za-z0-9._\-]/g, '').toUpperCase().slice(0, 20);
}
// "=P1" for a sheet with a function, '' otherwise (and always '' on a Free account).
export function sheetFunctionOf(sheet) {
  if (!sheetGroupsOn() || !sheet) return '';
  const f = cleanFunctionTag(sheet.iecFunction);
  return f ? `=${f}` : '';
}
// "=P1+CP": the function, then the location the sheet is set to (the +abbreviation of its IEC location).
export function sheetReferenceOf(sheet) {
  if (!sheet) return '';
  const fn = sheetFunctionOf(sheet);
  const loc = sheetGroupsOn() && sheet.iecLocation ? findLocationById(sheet.iecLocation) : null;
  return fn + (loc && loc.abbreviation ? `+${loc.abbreviation}` : '');
}

export function appAlert(message, title = 'Notice') {
  return showDialog({ title, message, type: 'alert' });
}

export function appConfirm(message, title = 'Please confirm', { okText, cancelText } = {}) {
  return showDialog({ title, message, type: 'confirm', okText, cancelText });
}

export function appPrompt(message, defaultValue = '', title = 'Input needed') {
  return showDialog({ title, message, type: 'prompt', defaultValue });
}

// Bound directly to the modal's own buttons (see index.php)
export function handleDialogOk() {
  const inputEl = document.getElementById('appDialogInput');
  const isPromptVisible = inputEl && inputEl.style.display !== 'none';
  closeDialog(isPromptVisible ? inputEl.value : true);
}

export function handleDialogCancel() {
  const inputEl = document.getElementById('appDialogInput');
  const isPromptVisible = inputEl && inputEl.style.display !== 'none';
  closeDialog(isPromptVisible ? null : false);
}

export const state = {
  selectedComponentId: null,
  selectedTextId: null,
  selectedShapeId: null, // annotation shape (line / rectangle / ellipse) currently selected
  selectedTerminalLinkId: null, // a link between two terminals, currently selected
  selectedImageId: null, // an inserted image, currently selected
  crosshairEnabled: true, // light red guide lines through the pointer, to help line up new placements
  showWirePlcData: true, // false stops a sheet reference (Sh.4/C3) from also showing the PLC input or output the wire goes to
  showWireIds: true, // false hides the wire ID labels drawn on the wires (the IDs themselves are kept); saved with the drawing
  junctionStyle: 'dot', // 'dot' (the classic filled circle) or 'notch' (the through-wire hops toward the branch instead)
  junctionHopDirection: 'toward', // which way a 'notch' hop dips: 'toward' the branch (the original look) or 'away' from it
  arrowNoteStyle: { font: 'Arial, sans-serif', size: 12, bold: false, italic: false, underline: false, colour: '#0f172a', box: true }, // the look a new arrow note starts with: whatever was last saved
  arrowStyle: { head: 'end', headStyle: 'filled', headSize: 1, weight: 1 }, // what the next arrow is drawn with
  shapeStyle: 'solid',   // line style new shapes are drawn with; also what the ribbon dropdown shows when no shape is selected
  rubberBandComponentIds: [], // multi-selected via elastic-band drag, dragged/deleted as a group
  rubberBandTextIds: [],
  rubberBandWireIndices: [], // wires fully enclosed by the drag box — index into the active sheet's wires array, like selectedWireIndex
  rubberBandCableMarkerIds: [], // cable markers fully enclosed by the drag box — by id, like selectedCableMarkerId
  companyLogo: null, // data URL, shown in every sheet's title block
  cables: [], // portfolio-wide cable registry — { id, designator, cableType, coreCount, csa, coreWireIds: {1: wireId, ...}, coreColours: {1: 'BRN', ...} }
  selectedCableMarkerId: null,
  // Portfolio-wide IEC-style location registry — { id, abbreviation, description }.
  // A sheet's own sheet.iecLocation and a component's optional comp.location
  // both reference one of these by id (never the abbreviation directly, so
  // renaming an abbreviation later doesn't orphan anything that points at
  // it). See getEffectiveLocationId/getDisplayDesignator below for how a
  // component's displayed designator is actually worked out from this.
  locations: [],
  sections: [],          // section paths that hold no sheets yet (the portfolio tree) - see sheetGroupOf
  revisions: [],         // the drawing revision log - see 23_revision_data.js
  projectInfo: { legalOwner: '', projectNumber: '', customer: '', site: '', docPrefix: '', docPattern: '', docType: '', docStatus: '', language: '', refStyle: 'grid' },   // company / project level title block fields - see 25_title_block.js
  titleBlock: { templateId: 'standard' },   // which title block the drawings use
  panelFootprints: [],   // footprints imported from DXF drawings for the Panel Layout sheet - see 21_panel_data.js
  cableLibrary: freshDefaultCableLibrary(),   // reusable cable definitions (type, cores, CSA, core colours) - see 18_cable_library.js; a brand-new project starts with the standard set
  terminalModels: freshDefaultTerminalModels(),   // terminal types defined once and used wherever they appear (see 11_terminal_blocks.js); a brand-new project starts with the standard set
  selectedWireIndex: null, // BUGFIX: must default to null, not undefined — otherwise
                            // `state.selectedWireIndex !== null` is true on load and the
                            // very first Delete/Backspace press deletes sheet.wires[0].
  wireCounter: 1,           // BUGFIX: was previously unset, producing wireId "undefined" then "NaN"
  activeSheetIndex: 0,
  currentTool: 'select',
  activeWirePoints: [], // [x1, y1, x2, y2, ...]
  tempWireLine: null,
  pinHighlightCircle: null,
  sheets: [
    { 
      id: 1, size: 'A3', orientation: 'landscape', 
      title: '', description: '', 
      author: '', approvedBy: '', createdDate: todayStr, location: '',
      rev: '1.0', components: [], wires: [], texts: [], shapes: [], cableMarkers: [], images: []
    }
  ],
  // --- Symbol Studio State Variables ---
  studioStage: null,
  studioLayer: null,
  currentStudioTool: 'line',
  studioElements: [],
  isDrawing: false,
  tempShape: null,
  startPos: { x: 0, y: 0 },
  selectedStudioElementIndices: [], // indices into state.studioElements currently selected (0, 1, or many)
  editingSymbolKey: null,
  currentLineStyle: 'solid' // default dash style applied to newly-drawn studio shapes
};

export function getActiveSheet() {
  return state.sheets[state.activeSheetIndex];
}

// Shared by handleDrop (new component, 5_portfolio_sheets.js) and
// duplicateSelectedComponent (3_schematic_engine.js). Lives here, rather than in
// either of those modules, so neither has to import from the other.
// Converts a world (x, y) coordinate into a zone reference like "3D", mirroring
// renderSheetBorder's page-size and margin math exactly (3_schematic_engine.js) —
// not sheet.gridLeft/gridRight/width/height, none of which are ever actually set
// on a sheet object. Lives here, rather than in 5_portfolio_sheets.js or
// 3_schematic_engine.js, so both of those can import it without one importing
// the other.
// Splits SVG path data into command letters and numbers. A number may carry an
// exponent (1.5e-14) — JavaScript prints very small values that way, e.g. the
// leftovers of subtracting two nearly equal floats — and the letter-or-digits
// splitting this replaces read that "e" as a path command, corrupting whatever
// followed it.
const PATH_TOKEN_SOURCE = String.raw`[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
export function pathTokens(d) {
  return String(d ?? '').match(new RegExp(PATH_TOKEN_SOURCE, 'g')) || [];
}

// An SVG arc is  A rx ry x-axis-rotation large-arc-flag sweep-flag x y  — and
// the two flags must be exactly 0 or 1. Older versions of the Symbol Studio
// multiplied them by the studio scale each time a symbol was opened for editing
// (1 became 2, then 4...). Konva tolerates that, but browsers reject it as an
// SVG path. A flag only ever went from 1 up by powers of two, so any non-zero
// value means it was 1 — the repair gets the original back exactly. Only the
// offending numbers are touched; everything else in the string stays as it was.
export function repairArcFlags(d) {
  if (typeof d !== 'string' || !/[Aa]/.test(d)) return d;
  const re = new RegExp(PATH_TOKEN_SOURCE, 'g');
  let out = '', last = 0, cmd = '', param = 0, changed = false, m;
  while ((m = re.exec(d))) {
    const tok = m[0];
    if (/^[A-Za-z]$/.test(tok)) { cmd = tok; param = 0; continue; }
    if ((cmd === 'A' || cmd === 'a') && (param % 7 === 3 || param % 7 === 4)) {
      const fixed = Number(tok) === 0 ? '0' : '1';
      if (tok !== fixed) { out += d.slice(last, m.index) + fixed; last = m.index + tok.length; changed = true; }
    }
    param++;
  }
  return changed ? out + d.slice(last) : d;
}

// Repairs the arcs of every symbol in a library (in place); returns how many
// path segments needed it. Called wherever a library enters the app.
export function repairSymbolLibrary(symbols) {
  let repaired = 0;
  Object.values(symbols || {}).forEach(sym => {
    if (!sym) return;
    if (typeof sym.pathData === 'string') {
      const fixed = repairArcFlags(sym.pathData);
      if (fixed !== sym.pathData) { sym.pathData = fixed; repaired++; }
    } else if (Array.isArray(sym.pathData)) {
      sym.pathData.forEach(seg => {
        if (!seg || typeof seg.d !== 'string') return;
        const fixed = repairArcFlags(seg.d);
        if (fixed !== seg.d) { seg.d = fixed; repaired++; }
      });
    }
  });
  if (repaired) console.info(`[Schematic Editor] repaired ${repaired} arc(s) with invalid flags in custom symbols`);
  return repaired;
}

export function getDashArray(style) {
  if (style === 'dashed') return [8, 6];
  if (style === 'dotted') return [2, 4];
  if (style === 'dashdashline') return [8, 4, 8, 4, 20, 4]; // two short dashes then a long one — same pattern cable-assigned wires use
  return []; // solid
}

// A symbol's pathData is an array of { d, dash } segments — one per originally
// drawn line/rect/circle, each with its own dash style. Older saved symbols (and
// anything imported from before this existed) stored it as one flat string
// instead, always solid, with no per-segment styling. This upgrades either
// shape into the same array form, splitting a legacy string back into its
// original segments (every one starts with "M" and never uses another capital
// M within it) so old symbols get the same per-segment editing and, from here
// on, dash-style support retroactively.
export function normalizePathData(pathData) {
  if (Array.isArray(pathData)) return pathData;
  if (typeof pathData === 'string' && pathData.trim()) {
    const segments = pathData.match(/M[^M]*/g) || [pathData];
    return segments.map(s => ({ d: s.trim(), dash: 'solid' })).filter(seg => seg.d);
  }
  return [];
}

// ---- Cross-reference style ----
// 'grid' (the default): sheet number and grid square, written Sh.3/B4 (IEC style).
// 'lines': sequential line numbers down the margin, the sheet number followed by a two-digit line (sheet 3, line 12
// is written 312), the way ladder diagrams are usually referenced.
export const LINE_PITCH = 40;   // height of one numbered line, in sheet units (two grid squares)

export function getRefStyle() {
  return state.projectInfo && state.projectInfo.refStyle === 'lines' ? 'lines' : 'grid';
}

// A sheet can carry its lines in one column (1..n down the page) or two side by side: the left half numbered
// 1..n and the right half n+1..2n, so a wide sheet holds two ladders and keeps unique line numbers.
export function getLineColumns(sheet) {
  return sheet && Number(sheet.lineColumns) === 2 ? 2 : 1;
}

// The number of lines in one column.
export function getLineCount(sheet) {
  const config = SHEET_CONFIGS[sheet && sheet.size] || SHEET_CONFIGS.A3;
  const pageHeight = sheet && sheet.orientation === 'landscape' ? config.height : config.width;
  const cap = getLineColumns(sheet) === 2 ? 49 : 99;   // the line is written as two digits after the sheet number
  return Math.max(1, Math.min(cap, Math.floor((pageHeight - 80) / LINE_PITCH)));
}

// The width of a sheet in sheet units.
export function getSheetWidth(sheet) {
  const config = SHEET_CONFIGS[sheet && sheet.size] || SHEET_CONFIGS.A3;
  return sheet && sheet.orientation === 'landscape' ? config.width : config.height;
}

// The line (1-based) at a position on a sheet. On a two-column sheet the right half continues the numbering.
export function getLineAt(sheet, y, x) {
  const n = getLineCount(sheet);
  const line = Math.max(1, Math.min(n, Math.floor((y - 40) / LINE_PITCH) + 1));
  return getLineColumns(sheet) === 2 && Number(x) > getSheetWidth(sheet) / 2 ? n + line : line;
}

// The reference number for a line on a schematic sheet: sheet 3, line 12 -> 312.
export function lineReference(sheetNum, line) {
  return (Number(sheetNum) || 0) * 100 + line;
}

// Where something at (x, y) on sheet `sheetIndex` is, written in the project's reference style: 'Sh.3/B4' or '312'.
export function getRefText(x, y, sheetIndex = state.activeSheetIndex) {
  const sheet = state.sheets[sheetIndex] || getActiveSheet();
  const num = getSchematicSheetNumber(sheetIndex);
  if (getRefStyle() === 'lines' && sheet && num !== null) return String(lineReference(num, getLineAt(sheet, y, x)));
  const fn = sheetFunctionOf(sheet);   // a sheet with a function reads "=P1 Sh.3/B2"
  return `${fn ? fn + ' ' : ''}Sh.${num}/${getGridLocation(x, y, sheetIndex)}`;
}

// The same without the 'Sh.' prefix, for tables that give the sheet in its own column: 'B4', or '312' for line numbers.
export function getRefShort(x, y, sheetIndex = state.activeSheetIndex) {
  const sheet = state.sheets[sheetIndex] || getActiveSheet();
  const num = getSchematicSheetNumber(sheetIndex);
  if (getRefStyle() === 'lines' && sheet && num !== null) return String(lineReference(num, getLineAt(sheet, y, x)));
  return getGridLocation(x, y, sheetIndex);
}

export function getGridLocation(x, y, sheetIndex = state.activeSheetIndex) {
  const sheet = state.sheets[sheetIndex] || getActiveSheet();
  if (!sheet) return '??';

  const config = SHEET_CONFIGS[sheet.size] || SHEET_CONFIGS.A3;
  const isLandscape = sheet.orientation === 'landscape';
  const pageWidth = isLandscape ? config.width : config.height;
  const pageHeight = isLandscape ? config.height : config.width;
  const margin = 40;

  const gridLeft = margin;
  const gridTop = margin;
  const gridRight = pageWidth - margin;
  const gridBottom = pageHeight - margin;

  const cols = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];

  const gridWidth = gridRight - gridLeft;
  const gridHeight = gridBottom - gridTop;

  const relX = x - gridLeft;
  const relY = y - gridTop;

  const colIdx = Math.floor((relX / gridWidth) * cols.length);
  const rowIdx = Math.floor((relY / gridHeight) * rows.length);

  const safeColIdx = Math.max(0, Math.min(cols.length - 1, colIdx));
  const safeRowIdx = Math.max(0, Math.min(rows.length - 1, rowIdx));

  return `${cols[safeColIdx]}${rows[safeRowIdx]}`;
}

// Text inside a symbol: its look is stored on each text as fontFamily (one of the
// SYMBOL_FONTS values), bold, italic and underline. Anything missing or not on the
// list falls back to the plain sans-serif every symbol used before, so older
// symbols draw exactly as they did.
export const SYMBOL_FONTS = [
  { label: 'Sans-serif', value: 'sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Segoe UI', value: "'Segoe UI', sans-serif" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" }
];
export function symbolFontFamily(v) { return SYMBOL_FONTS.some(f => f.value === v) ? v : 'sans-serif'; }
// The Konva properties for a symbol text's font (size and colour stay the caller's).
export function symbolTextStyle(t) {
  const fontStyle = `${t?.italic ? 'italic ' : ''}${t?.bold ? 'bold' : ''}`.trim() || 'normal';
  return { fontFamily: symbolFontFamily(t?.fontFamily), fontStyle, textDecoration: t?.underline ? 'underline' : '' };
}
// The same, for SVG attributes (thumbnails).
export function symbolTextSvgAttrs(t) {
  return ` font-family="${symbolFontFamily(t?.fontFamily).replace(/"/g, "'")}"${t?.bold ? ' font-weight="bold"' : ''}${t?.italic ? ' font-style="italic"' : ''}${t?.underline ? ' text-decoration="underline"' : ''}`;
}

// The single source of truth for a component type's pin layout. Every place
// that needs a component's pins — wire snapping, healing/connection detection,
// and on-sheet rendering — reads from here instead of its own copy, so adding a
// new built-in type only ever needs updating in one place.
// A placed symbol can be mirrored (comp.flipX / comp.flipY): applied to its drawing and pin positions before it is rotated.
export const flipSX = (comp) => (comp && comp.flipX ? -1 : 1);
export const flipSY = (comp) => (comp && comp.flipY ? -1 : 1);

export function getPinsForType(type) {
  if (type === 'resistor' || type === 'capacitor') return [{ relX: 0, relY: 10 }, { relX: 80, relY: 10 }]; // no longer offered in the sidebar, kept for older saved projects
  if (type === 'gnd') return [{ relX: 20, relY: 0 }];
  if (type === 'terminal') return [{ relX: 0, relY: 0 }];
  if (type === 'supply_3n_pe') return [{ relX: 20, relY: 0 }, { relX: 20, relY: 20 }, { relX: 20, relY: 40 }, { relX: 20, relY: 60 }, { relX: 20, relY: 80 }];
  if (type === 'supply_1n_pe') return [{ relX: 20, relY: 0 }, { relX: 20, relY: 20 }, { relX: 20, relY: 40 }];
  if (type === 'supply_3_pe') return [{ relX: 20, relY: 0 }, { relX: 20, relY: 20 }, { relX: 20, relY: 40 }, { relX: 20, relY: 60 }];
  if (window.customSymbolDefinitions?.[type]) return window.customSymbolDefinitions[type].pins || [];
  return [];
}

// The artwork of the built-in symbols — the ones not drawn in the Symbol Studio.
// One table, read by both the sheet renderer and the sidebar thumbnails, so a
// symbol looks the same in the sidebar as it does once placed. (`texts` are the
// labels drawn beside a symbol; terminals draw no artwork of their own.)
export const BUILTIN_SYMBOL_GEOMETRY = {
  resistor: { pathData: "M 0 10 L 10 10 L 15 0 L 25 20 L 35 0 L 45 20 L 55 0 L 65 20 L 70 10 L 80 10" }, // no longer offered in the sidebar, kept for older saved projects
  capacitor: { pathData: "M 0 10 L 35 10 M 35 0 L 35 20 M 45 0 L 45 20 M 45 10 L 80 10" },               // ditto
  gnd: { pathData: "M 20 0 L 20 15 M 5 15 L 35 15 M 10 22 L 30 22 M 15 29 L 25 29" },
  supply_3n_pe: {
    pathData: "M 0 0 L 20 0 M 0 20 L 20 20 M 0 40 L 20 40 M 0 60 L 20 60 M 0 80 L 20 80",
    texts: [
      { text: 'L1', relX: -22, relY: -6, fontSize: 16 }, { text: 'L2', relX: -22, relY: 14, fontSize: 16 },
      { text: 'L3', relX: -22, relY: 34, fontSize: 16 }, { text: 'N', relX: -22, relY: 54, fontSize: 16 },
      { text: 'PE', relX: -22, relY: 74, fontSize: 16 }
    ]
  },
  supply_1n_pe: {
    pathData: "M 0 0 L 20 0 M 0 20 L 20 20 M 0 40 L 20 40",
    texts: [
      { text: 'L', relX: -22, relY: -6, fontSize: 16 }, { text: 'N', relX: -22, relY: 14, fontSize: 16 },
      { text: 'PE', relX: -22, relY: 34, fontSize: 16 }
    ]
  },
  supply_3_pe: {
    pathData: "M 0 0 L 20 0 M 0 20 L 20 20 M 0 40 L 20 40 M 0 60 L 20 60",
    texts: [
      { text: 'L1', relX: -22, relY: -6, fontSize: 16 }, { text: 'L2', relX: -22, relY: 14, fontSize: 16 },
      { text: 'L3', relX: -22, relY: 34, fontSize: 16 }, { text: 'PE', relX: -22, relY: 54, fontSize: 16 }
    ]
  }
};

// The label (L1, N, PE, etc.) for each pin of a supply symbol, in the same
// order as getPinsForType returns its pins — used so a wire connected to a
// given pin can inherit that pin's label as its own wire ID.
export function getPinLabelsForType(type) {
  if (type === 'supply_3n_pe') return ['L1', 'L2', 'L3', 'N', 'PE'];
  if (type === 'supply_1n_pe') return ['L', 'N', 'PE'];
  if (type === 'supply_3_pe') return ['L1', 'L2', 'L3', 'PE'];
  return null;
}

export function getPrefixAndValue(type) {
  if (type === 'resistor') return { prefix: 'R', value: '10k' }; // no longer offered in the sidebar, kept for older saved projects
  if (type === 'capacitor') return { prefix: 'C', value: '100nF' }; // ditto
  if (type === 'gnd') return { prefix: 'GND', value: '0V' };
  if (type === 'terminal') return { prefix: 'X', value: '' };
  if (type === 'supply_3n_pe') return { prefix: 'SUP', value: '400V 50Hz' };
  if (type === 'supply_1n_pe') return { prefix: 'SUP', value: '230V 50Hz' };
  if (type === 'supply_3_pe') return { prefix: 'SUP', value: '400V 50Hz' };
  if (window.customSymbolDefinitions[type]) {
    return {
      prefix: window.customSymbolDefinitions[type].prefix || 'K',
      value: window.customSymbolDefinitions[type].value || 'CUSTOM'
    };
  }
  return { prefix: 'R', value: '10k' };
}

export function getPageType(sheet) {
  return sheet?.pageType || 'schematic';
}

// The 1-based number a schematic sheet shows as "Sheet X of Y" — counting
// only schematic-type sheets, so title/contents pages never take a number.
// Returns null for a title/contents page, since those aren't numbered at all.
export function getSchematicSheetNumber(rawIndex) {
  const sheet = state.sheets[rawIndex];
  if (!sheet || getPageType(sheet) !== 'schematic') return null;
  let num = 0;
  for (let i = 0; i <= rawIndex; i++) {
    if (getPageType(state.sheets[i]) === 'schematic') num++;
  }
  return num;
}

export function getTotalSchematicSheets() {
  return state.sheets.filter(s => getPageType(s) === 'schematic').length;
}

// ---- IEC-style locations ----

// Compared as strings throughout, not with strict equality — an HTML
// <select>'s own value is always a string even when it was set from a
// number (every location id here is Date.now(), a number), so a raw ===
// against a freshly-read select.value would silently never match even
// for the exact same location. Matches the same String(a) === String(b)
// convention already used for component parentId comparisons elsewhere.
export function findLocationById(id) {
  if (!id && id !== 0) return null;
  return state.locations.find(l => String(l.id) === String(id)) || null;
}

// A component's effective location: its own explicit override if it has
// one; otherwise its parent's (a child contact physically lives wherever
// its parent coil/relay does — the same inheritance Value/Make/Model/
// Description already use); otherwise the sheet's own default. null means
// nothing has ever been assigned at any level.
export function getEffectiveLocationId(comp, sheet) {
  if (comp.location) return comp.location;
  if (comp.parentId && typeof window.findComponentById === 'function') {
    const parent = window.findComponentById(comp.parentId);
    if (parent && parent.location) return parent.location;
  }
  if (comp.jointToId && typeof window.findComponentById === 'function') {   // a coil joined to another is the same physical device
    const main = window.findComponentById(comp.jointToId);
    if (main && main.location) return main.location;
  }
  return sheet?.iecLocation || null;
}

// The designator text actually shown for a component — plain (e.g. "K1")
// when its effective location matches the sheet's own prevailing one, or
// prefixed (e.g. "+CP-K1") when it genuinely departs from it. `label` is
// passed in rather than read from comp.label directly, since the canvas
// already resolves a child component's own displayed label from its
// parent before this is applied — the location prefix layers on top of
// whatever that resolution already produced, not a fresh read of comp.label.
export function getDisplayDesignator(label, comp, sheet) {
  const effectiveId = getEffectiveLocationId(comp, sheet);
  const sheetId = sheet?.iecLocation || null;
  if (!effectiveId || String(effectiveId) === String(sheetId)) return label;
  const loc = findLocationById(effectiveId);
  if (!loc || !loc.abbreviation) return label;
  return `+${loc.abbreviation}-${label}`;
}

// Same idea as the schematic-sheet numbering above, but for BOM pages: a
// portfolio can have more than one, one after another, when the parts list
// is too long to fit on a single page (see renderBOMPageContent's own
// pagination). Returns null for anything that isn't itself a BOM page.
export function getBOMPageNumber(rawIndex) {
  const sheet = state.sheets[rawIndex];
  if (!sheet || getPageType(sheet) !== 'bom') return null;
  let num = 0;
  for (let i = 0; i <= rawIndex; i++) {
    if (getPageType(state.sheets[i]) === 'bom') num++;
  }
  return num;
}

export function getTotalBOMPages() {
  return state.sheets.filter(s => getPageType(s) === 'bom').length;
}

// The same for PLC I/O schedule pages (pageType 'plcio'): one or more, one after another, when the list is too long for one.
export function getPlcIoPageNumber(rawIndex) {
  const sheet = state.sheets[rawIndex];
  if (!sheet || getPageType(sheet) !== 'plcio') return null;
  let num = 0;
  for (let i = 0; i <= rawIndex; i++) if (getPageType(state.sheets[i]) === 'plcio') num++;
  return num;
}
export function getTotalPlcIoPages() {
  return state.sheets.filter(s => getPageType(s) === 'plcio').length;
}

export function nextCableDesignator() {
  const used = new Set((state.cables || []).map(c => c.designator));
  let n = 1;
  while (used.has(`W${n}`)) n++;
  return `W${n}`;
}

// The designator for a new component: "<sheet#><prefix><n>", e.g. 1Q3.
//
// n carries on from every component on the sheet that shares the PREFIX,
// whatever type each one is. Two different symbols that both use "Q" share
// one run of numbers (1Q1 1Q2, then 1Q3 1Q4) — each type used to count from
// 1 on its own, so the second type was handed designators the first already
// had.
//
// It is one more than the HIGHEST number already in use for that prefix on
// the sheet, not a count of how many there are: counting repeats a number
// that is still in use as soon as one is deleted from the middle (1Q1 1Q2
// 1Q3, delete 1Q1, and "count + 1" hands out a second 1Q3). Highest + 1 is
// the same thing whenever nothing has been deleted, and never repeats one.
//
// A parent's contacts ("1K1.13") and labels edited into something that isn't
// a number ("MAIN") don't match the pattern, so they never affect it.
export function nextLabelForType(sheet, type) {
  const currentSheetNum = getSchematicSheetNumber(state.activeSheetIndex) || (state.activeSheetIndex + 1);
  const { prefix } = getPrefixAndValue(type);
  if (type === 'terminal') return `${currentSheetNum}${prefix}`; // e.g. "1X" — the terminal row/block, not a per-instance number

  // Any sheet number in front (labels typed by hand may leave it off), then
  // the prefix taken literally, then the number — and nothing after it.
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelPattern = new RegExp(`^\\d*${escapedPrefix}(\\d+)$`);

  let highest = 0;
  (sheet.components || []).forEach(c => {
    if (getPrefixAndValue(c.type).prefix !== prefix) return;
    const m = labelPattern.exec(String(c.label ?? ''));
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  });
  return `${currentSheetNum}${prefix}${highest + 1}`;
}

export function setTool(tool, renderCallback) {
  state.currentTool = tool;
  state.selectedComponentId = null; 
  state.rubberBandComponentIds = [];
  state.rubberBandTextIds = [];
  state.rubberBandWireIndices = [];
  state.rubberBandCableMarkerIds = [];
  state.selectedCableMarkerId = null;
  state.selectedShapeId = null;
  state.selectedImageId = null;
  state.selectedTerminalLinkId = null;
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
}

// ==========================================
// AUTOSAVE (debounced save to the signed-in user's own account)
// ==========================================
// Used to persist to localStorage — a single key shared by the whole
// browser, not the logged-in account, so one person's in-progress work
// could resurface in someone else's session on a shared or previously-used
// browser, and a brand-new signup could be offered a stale "restore?"
// prompt for a project that was never theirs. Saving to the server instead
// (via window.autosaveToServer, defined in 8_projects.js — called this way
// rather than imported directly, since that module already imports FROM
// this one) ties every autosave to whoever is actually logged in, the same
// way an explicit Save already does.
let autosaveTimer = null;

// The symbols to save with a project. The built-in library (fuses, breakers, motors...) is added to every project by the site itself,
// so only the ones a sheet actually uses are saved; the rest come back by themselves the next time the project is opened.
export function symbolsForSave() {
  const defs = window.customSymbolDefinitions || {};
  const used = new Set();
  (state.sheets || []).forEach(sh => (sh.components || []).forEach(c => used.add(c.type)));
  const out = {};
  Object.keys(defs).forEach(k => { if (defs[k] && defs[k].extraBuiltin && !used.has(k)) return; out[k] = defs[k]; });
  return out;
}

export function buildPortfolioSnapshot() {
  const projectInput = document.getElementById('projectNameInput');
  return {
    version: '1.0',
    savedAt: new Date().toISOString(),
    projectName: projectInput ? projectInput.value : '',
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
    junctionStyle: state.junctionStyle,               // a drawing-wide look, so it is saved with the drawing —
    junctionHopDirection: state.junctionHopDirection, // otherwise it went back to Dot every time a project was reopened
    sheets: state.sheets
  };
}

// Debounced: call this after any state-mutating action. Rapid-fire calls (e.g. during
// a drag) collapse into a single write ~700ms after the last one.
export function scheduleAutosave(delay = 700) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  if (typeof window.refreshTerminalTablesSoon === 'function') window.refreshTerminalTablesSoon();   // terminal tables follow the wiring
  autosaveTimer = setTimeout(() => {
    if (typeof window.autosaveToServer === 'function') window.autosaveToServer();
  }, delay);
}

// ==========================================
// UNDO / REDO (whole-state snapshot history)
// ==========================================
// Scope: covers structural, discrete actions — add/move/delete/rotate/duplicate a
// component, add/delete a wire, add/delete a sheet, create/delete/import a symbol,
// and saved component-detail edits. It intentionally does NOT snapshot every
// keystroke while typing in the sheet title/description/etc. fields, since that
// would make undo step back one character at a time.
const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let isRestoringHistory = false;

function snapshotForHistory() {
  return JSON.stringify({ sheets: state.sheets, customSymbols: window.customSymbolDefinitions, cables: state.cables, sections: state.sections });
}

// Call BEFORE a mutation, to save the pre-mutation state onto the undo stack.
export function pushHistory() {
  if (isRestoringHistory) return;
  undoStack.push(snapshotForHistory());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

function applyHistorySnapshot(json) {
  isRestoringHistory = true;
  const data = JSON.parse(json);
  state.sheets = data.sheets;
  repairSymbolLibrary(data.customSymbols);
  window.customSymbolDefinitions = data.customSymbols;
  state.cables = data.cables || [];
  state.sections = data.sections || [];
  if (state.activeSheetIndex >= state.sheets.length) {
    state.activeSheetIndex = Math.max(0, state.sheets.length - 1);
  }
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  isRestoringHistory = false;
}

export function undo(renderCallback) {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotForHistory());
  applyHistorySnapshot(undoStack.pop());
  if (typeof renderCallback === 'function') renderCallback();
  updateUndoRedoButtons();
  scheduleAutosave();
}

export function redo(renderCallback) {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotForHistory());
  applyHistorySnapshot(redoStack.pop());
  if (typeof renderCallback === 'function') renderCallback();
  updateUndoRedoButtons();
  scheduleAutosave();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// ==========================================
// FILE SAVING (native "Save As" where supported)
// ==========================================
// Saves text content to a file. Prefers the File System Access API's native Save
// As dialog — lets the person choose the folder and filename — where the browser
// supports it (Chrome, Edge, Opera). Falls back to a normal browser download
// (Firefox, Safari, or if the dialog itself fails for some other reason) so
// saving always works everywhere, just without the folder picker on those
// browsers. Must be called directly from a user gesture (e.g. a button's
// onclick) — that's already how every caller of this function is wired up.
const SAVE_FALLBACK_NOTICE_KEY = 'schematicEditor.saveFallbackNoticeDismissed';

// Shows a small explanatory banner the first time a save falls back to a plain
// download, so it's clear why the folder picker didn't appear — rather than the
// person just wondering, silently, every time. Dismissing it (or having seen it
// once already) suppresses it for good via localStorage.
function notifySaveFallback() {
  try {
    if (localStorage.getItem(SAVE_FALLBACK_NOTICE_KEY)) return;
  } catch (err) { /* ignore — if storage is blocked, just show it each time */ }
  const notice = document.getElementById('saveFallbackNotice');
  if (notice) notice.style.display = 'block';
}

export function dismissSaveFallbackNotice() {
  const notice = document.getElementById('saveFallbackNotice');
  if (notice) notice.style.display = 'none';
  try { localStorage.setItem(SAVE_FALLBACK_NOTICE_KEY, '1'); } catch (err) { /* ignore */ }
}

export async function saveTextFile(content, suggestedName, mimeType, typeDescription) {
  if (window.showSaveFilePicker) {
    try {
      const dotIndex = suggestedName.lastIndexOf('.');
      const ext = dotIndex >= 0 ? suggestedName.slice(dotIndex) : '';
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: typeDescription, accept: { [mimeType]: [ext] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false; // person cancelled the dialog — don't also download
      console.warn('Save dialog failed, falling back to direct download:', err);
      notifySaveFallback();
      // fall through to the download fallback below
    }
  } else {
    notifySaveFallback();
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

