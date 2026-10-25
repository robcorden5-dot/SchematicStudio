// ==========================================
// 18. CABLE LIBRARY (rules)
// ==========================================
// Pure logic for core colours and for the library of reusable cable definitions.
// No page access here, so it can be tested on its own; 19_cable_library_ui.js
// is the window and 7_cables.js uses the colours.
//
// A library entry: { id, name, cableType, coreCount, csa, description, coreColours: [code, ...] }
// coreColours holds one code per core (core 1 first), '' meaning "no colour".
import { CABLE_COLOURS, CABLE_COLOUR_ALIASES, STANDARD_COLOUR_SEQUENCE, STANDARD_COLOUR_SETS, DEFAULT_CABLES } from './0_default_cables.js';

export const CABLE_LIBRARY_FILE_FORMAT = 'schematicstudio-cable-library';
export const MAX_IMPORT_CABLES = 500;
export const MAX_CABLE_CORES = 120;
export const CABLE_NAME_MAX = 40;

const cleanText = (v) => (v === undefined || v === null ? '' : String(v)).replace(/\s+/g, ' ').trim();

export function colourInfo(code) {
  return CABLE_COLOURS.find(c => c.code === code) || null;
}

// "brown", "bn", "GN/YE" ... -> 'BRN', 'GRN/YEL'. '' for nothing, null if not a colour.
export function normaliseColourCode(raw) {
  const s = cleanText(raw).toUpperCase();
  if (!s) return '';
  if (colourInfo(s)) return s;
  if (CABLE_COLOUR_ALIASES[s]) return CABLE_COLOUR_ALIASES[s];
  return null;
}

// n codes in the usual order: the fixed sets for 2-5 cores, otherwise the running sequence.
export function standardCoreColours(n) {
  n = Math.max(0, Math.min(MAX_CABLE_CORES, Math.floor(Number(n) || 0)));
  if (STANDARD_COLOUR_SETS[n]) return STANDARD_COLOUR_SETS[n].slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < STANDARD_COLOUR_SEQUENCE.length ? STANDARD_COLOUR_SEQUENCE[i] : '');
  return out;
}

// A list of codes cut or padded to exactly n entries, unknown codes becoming ''.
export function fitColours(colours, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = Array.isArray(colours) ? normaliseColourCode(colours[i]) : '';
    out.push(c || '');
  }
  return out;
}

// The colour code of core `coreNo` (1-based) of a cable in a project: '' if none.
export function coreColourOf(cable, coreNo) {
  const c = cable && cable.coreColours ? cable.coreColours[coreNo] : '';
  return colourInfo(c) ? c : '';
}

// The cable's colours as a list for cores 1..coreCount.
export function cableColourList(cable) {
  const out = [];
  for (let i = 1; i <= (cable.coreCount || 0); i++) out.push(coreColourOf(cable, i));
  return out;
}

// Turns a list (core 1 first) into the {coreNo: code} map a project cable keeps.
export function coloursToMap(list) {
  const map = {};
  (list || []).forEach((c, i) => { if (colourInfo(c)) map[i + 1] = c; });
  return map;
}

// ---- entries ----
export function cleanCableEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const name = cleanText(item.name);
  const coreCount = Number(item.coreCount);
  if (!name || name.length > CABLE_NAME_MAX || !Number.isInteger(coreCount) || coreCount < 1 || coreCount > MAX_CABLE_CORES) return null;
  return {
    name,
    cableType: cleanText(item.cableType),
    coreCount,
    csa: cleanText(item.csa),
    description: cleanText(item.description),
    coreColours: fitColours(item.coreColours, coreCount)
  };
}

const sameContent = (a, b) =>
  a.coreCount === b.coreCount && cleanText(a.cableType) === cleanText(b.cableType) && cleanText(a.csa) === cleanText(b.csa) &&
  cleanText(a.description) === cleanText(b.description) &&
  fitColours(a.coreColours, a.coreCount).join('|') === fitColours(b.coreColours, b.coreCount).join('|');

function uniqueName(list, name) {
  const taken = new Set(list.map(m => m.name.toLowerCase()));
  let n = 2, candidate;
  do {
    const suffix = ` (${n++})`;
    candidate = name.slice(0, CABLE_NAME_MAX - suffix.length).trimEnd() + suffix;
  } while (taken.has(candidate.toLowerCase()));
  return candidate;
}

// Adds a new entry (the name must be free). Returns { ok, entry } or { ok:false, error }.
export function addCableEntry(list, fields) {
  const entry = cleanCableEntry(fields);
  if (!entry) return { ok: false, error: 'Give the cable a name (40 characters at most) and a core count from 1 to ' + MAX_CABLE_CORES + '.' };
  if (list.some(m => m.name.toLowerCase() === entry.name.toLowerCase())) return { ok: false, error: 'A cable called "' + entry.name + '" is already in the library.' };
  const id = list.reduce((mx, m) => Math.max(mx, Number(m.id) || 0), Date.now()) + 1;
  const full = { id, ...entry };
  list.push(full);
  return { ok: true, entry: full };
}

// Changes an existing entry. The name may stay the same but not match a different entry.
export function updateCableEntry(list, id, fields) {
  const target = list.find(m => String(m.id) === String(id));
  if (!target) return { ok: false, error: 'That cable is no longer in the library.' };
  const entry = cleanCableEntry(fields);
  if (!entry) return { ok: false, error: 'Give the cable a name (40 characters at most) and a core count from 1 to ' + MAX_CABLE_CORES + '.' };
  if (list.some(m => m !== target && m.name.toLowerCase() === entry.name.toLowerCase())) return { ok: false, error: 'A cable called "' + entry.name + '" is already in the library.' };
  Object.assign(target, entry);
  return { ok: true, entry: target };
}

export function deleteCableEntry(list, id) {
  const i = list.findIndex(m => String(m.id) === String(id));
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// ---- files ----
export function buildCableLibraryExport(list, libraryName) {
  return {
    format: CABLE_LIBRARY_FILE_FORMAT,
    version: 1,
    libraryName: cleanText(libraryName) || 'Cable library',
    cables: list.map(c => ({ name: c.name, cableType: c.cableType || '', coreCount: c.coreCount, csa: c.csa || '', description: c.description || '', coreColours: fitColours(c.coreColours, c.coreCount) }))
  };
}

export function parseCableLibraryFile(data) {
  const list = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray(data.cables) ? data.cables : null);
  if (!list) return { ok: false, error: 'That file does not contain cables.' };
  if (data && !Array.isArray(data) && data.format !== undefined && data.format !== CABLE_LIBRARY_FILE_FORMAT) return { ok: false, error: 'That file is not a cable library file.' };
  if (list.length > MAX_IMPORT_CABLES) return { ok: false, error: `That file has more than ${MAX_IMPORT_CABLES} cables, which is too many to import.` };
  const cables = [];
  let skipped = 0;
  const seen = new Set();
  list.forEach(item => {
    const e = cleanCableEntry(item);
    if (!e || seen.has(e.name.toLowerCase())) { skipped++; return; }
    seen.add(e.name.toLowerCase());
    cables.push(e);
  });
  return { ok: true, cables, skipped };
}

// Adds clean entries without ever changing one already there:
// same name and details -> nothing; same name, different details -> "Name (2)"; new name -> added.
export function mergeCableEntries(list, entries) {
  const result = { added: 0, renamed: 0, unchanged: 0 };
  entries.forEach(e => {
    const clash = list.find(x => x.name.toLowerCase() === e.name.toLowerCase());
    if (clash && sameContent(clash, e)) { result.unchanged++; return; }
    const out = addCableEntry(list, { ...e, name: clash ? uniqueName(list, e.name) : e.name });
    if (out.ok) { result.added++; if (clash) result.renamed++; }
  });
  return result;
}

export function addStandardCableEntries(list) {
  return mergeCableEntries(list, DEFAULT_CABLES.map(c => cleanCableEntry(c)).filter(Boolean));
}

export function describeMerge(result, skipped) {
  const parts = [];
  if (result.added) parts.push(`${result.added} added` + (result.renamed ? ` (${result.renamed} renamed because the name was taken)` : ''));
  if (result.unchanged) parts.push(`${result.unchanged} already there`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.length ? parts.join(', ') + '.' : 'Nothing to add.';
}

// ---- small HTML helpers shared by the cable windows ----
const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function colourSwatchHtml(code) {
  const info = colourInfo(code);
  if (!info) return '<span class="cable-swatch cable-swatch-none"></span>';
  const bg = info.hex2 ? `linear-gradient(90deg, ${info.hex} 50%, ${info.hex2} 50%)` : info.hex;
  return `<span class="cable-swatch" style="background:${bg};" title="${escAttr(info.name)}"></span>`;
}

export function colourOptionsHtml(selected) {
  return '<option value="">—</option>' + CABLE_COLOURS.map(c =>
    `<option value="${escAttr(c.code)}"${c.code === selected ? ' selected' : ''}>${escAttr(c.code)} · ${escAttr(c.name)}</option>`).join('');
}
