// ==========================================
// 11. TERMINAL BLOCKS
// ==========================================
// A terminal is one physical screw on a terminal block (a DIN-rail strip). Each
// one stores which block it belongs to and its position on it:
//
//   comp.label        the block's designator, e.g. "X1" or "TB2"
//   comp.position     its place on that block: a whole number, 1 and up
//   comp.terminalKind 'pe' for a protective-earth terminal; absent = standard
//   comp.location     optional: the location the block is in, when that is not
//                     the sheet's own (same override every component has)
//   comp.locationLabel what the label on the sheet shows (the name is from when it
//                     only controlled the location; saved projects use it):
//                     'show' = always put the location ("+MP-") on it, even when
//                     it is the sheet's own; 'hide' = never; 'position' = hide the
//                     location AND the block, leaving only the position;
//                     absent = automatic (the location only where it differs from
//                     the sheet's). For closely placed terminals.
//   (comp.hideLocation: true was how 'hide' was stored briefly; still read as 'hide')
//   comp.level        which level this symbol is, on a terminal with more than one
//                     (a double- or triple-level terminal is drawn once per level,
//                     each at the same block and position: X1:5.1, X1:5.2). Absent = 1
//   comp.levels       how many levels the terminal has, when it has no model
//   comp.modelId      a terminal MODEL (see below) it is an example of; the model
//                     then says how many levels it has, and its part details
//   comp.wireIds      the wire ID(s) connected to it, saved on the terminal
//   comp.side         'internal' or 'external': which side of the block this connection is on - the panel side or the field
//                     side. A physical terminal has both, so one screw (a position and level) can carry one internal symbol
//                     AND one external symbol. Absent = automatic (see terminalSideOf: decided from the location of what the
//                     wire goes to, else internal). "Pack connections" (43_terminal_sides.js) uses it to pair them up.
//
// A block is not stored anywhere on its own: it exists as long as a terminal
// belongs to it, identified by its designator AND its location (so +MP-X1 and
// +CP-X1 are two different blocks, as they would be on a real panel).
//
// This module is data and geometry only — no drawing, no DOM — so it can be
// tested on its own. The modal lives in 12_terminal_modal.js, and the terminal
// tool and its symbol in 3_schematic_engine.js.

import { DEFAULT_TERMINAL_MODELS } from './0_default_terminal_models.js';
import { state, findLocationById, getEffectiveLocationId, getDisplayDesignator } from './1_config_state.js';

export const TERMINAL_KIND_PE = 'pe';
export const MAX_TERMINAL_POSITION = 999;
export const BLOCK_DESCRIPTION_MAX = 40;   // a block's description, e.g. "Motor feeds" - short enough to fit a table column
export const BLOCK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/; // no ":" or spaces: the position is shown after a ":"

// Splits a designator into alternating text/number chunks ("X10" -> ["X", 10])
// and compares chunk by chunk — numeric chunks as numbers, text chunks as
// strings — so a list of designators reads X1, X2, ... X10, not the plain
// string order X1, X10, X2.
export function compareDesignators(a, b) {
  const chunk = s => (String(s).match(/\d+|\D+/g) || []);
  const ca = chunk(a), cb = chunk(b);
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const xa = ca[i], xb = cb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa), nb = /^\d+$/.test(xb);
    if (na && nb) { const d = parseInt(xa, 10) - parseInt(xb, 10); if (d) return d; }
    else if (xa !== xb) return xa < xb ? -1 : 1;
  }
  return 0;
}

// ---- what counts as a terminal, and an assigned one ----

export function isTerminal(comp) { return !!comp && comp.type === 'terminal'; }
export function isPETerminal(comp) { return isTerminal(comp) && comp.terminalKind === TERMINAL_KIND_PE; }

// Assigned = it has a block (its label) AND a position. A terminal placed
// before this existed has a default label like "1X" and no position: it is
// left exactly as it was until someone assigns it.
export function isAssignedTerminal(comp) {
  return isTerminal(comp) && String(comp.label || '').trim() !== '' && Number.isInteger(comp.position) && comp.position >= 1;
}

// ---- sides: which way a connection faces ----
// A real terminal has two connection points per level: one for the wire coming from inside the panel and one for the wire
// going out to the field. Drawn terminals follow that: a slot (position and level) may hold an internal symbol and an
// external one. Which a symbol is: its own setting if it has one, else the automatic rule registered by
// 43_terminal_sides.js (it needs the engine's wire and pin geometry, which this data module does not import), else internal.

export const SIDE_INTERNAL = 'internal', SIDE_EXTERNAL = 'external', SIDE_AUTO = 'auto';

export function terminalSideSetting(comp) {
  return comp && (comp.side === SIDE_INTERNAL || comp.side === SIDE_EXTERNAL) ? comp.side : SIDE_AUTO;
}

let autoSideResolver = null;
export function setAutoSideResolver(fn) { autoSideResolver = typeof fn === 'function' ? fn : null; }

let autoEndsResolver = null;
export function setAutoEndsResolver(fn) { autoEndsResolver = typeof fn === 'function' ? fn : null; }
// A feed-through terminal (one symbol, a wire on each side that come out on different sides): { internal: {wireIds}, external: {wireIds} }, else null.
export function terminalEndsOf(comp, sheet) {
  if (!autoEndsResolver || terminalSideSetting(comp) !== SIDE_AUTO) return null;
  try { return autoEndsResolver(comp, sheet) || null; } catch (err) { return null; }
}

let destinationResolver = null;
export function setDestinationResolver(fn) { destinationResolver = typeof fn === 'function' ? fn : null; }
export function terminalDestinationsOf(comp, sheet) {
  if (!destinationResolver) return { internal: [], external: [] };
  try { return destinationResolver(comp, sheet) || { internal: [], external: [] }; } catch (err) { return { internal: [], external: [] }; }
}

export function terminalSideOf(comp, sheet) {
  const setting = terminalSideSetting(comp);
  if (setting !== SIDE_AUTO) return setting;
  if (autoSideResolver) {
    try { if (autoSideResolver(comp, sheet) === SIDE_EXTERNAL) return SIDE_EXTERNAL; } catch (err) { /* fall back to internal */ }
  }
  return SIDE_INTERNAL;
}

// 'internal' / 'external' sets it; anything else (including 'auto') clears it back to automatic.
export function setTerminalSide(comp, side) {
  if (side === SIDE_INTERNAL || side === SIDE_EXTERNAL) comp.side = side; else delete comp.side;
  return comp;
}

// ---- block identity ----

const normaliseLocationId = (id) => (id === undefined || id === null || id === '') ? null : String(id);

export function terminalLocationId(comp, sheet) {
  return normaliseLocationId(getEffectiveLocationId(comp, sheet));
}

export function blockKey(name, locationId) {
  const loc = normaliseLocationId(locationId);
  return `${loc === null ? '' : loc}|${String(name).trim().toLowerCase()}`;
}

export const LOCATION_LABEL_AUTO = 'auto', LOCATION_LABEL_SHOW = 'show', LOCATION_LABEL_HIDE = 'hide', LOCATION_LABEL_POSITION = 'position';
const LABEL_MODES = [LOCATION_LABEL_SHOW, LOCATION_LABEL_HIDE, LOCATION_LABEL_POSITION];

// 'auto' | 'show' | 'hide' | 'position' — anything unrecognised is automatic.
export function locationLabelMode(comp) {
  if (LABEL_MODES.includes(comp?.locationLabel)) return comp.locationLabel;
  return comp?.hideLocation === true ? LOCATION_LABEL_HIDE : LOCATION_LABEL_AUTO;
}

export function setLocationLabel(comp, mode) {
  delete comp.hideLocation;
  if (LABEL_MODES.includes(mode)) comp.locationLabel = mode; else delete comp.locationLabel;
  return comp;
}

export function terminalBlockKeyOf(comp, sheet) {
  return blockKey(comp.label || '', terminalLocationId(comp, sheet));
}

// "+MP-X1" when the block is in a location, plain "X1" when it is not.
export function blockDisplayName(name, locationId) {
  const loc = findLocationById(locationId);
  return loc && loc.abbreviation ? `+${loc.abbreviation}-${name}` : String(name);
}

// A block's description is kept on each of its terminals (as blockDescription), the
// same way its designator is, so it needs no separate list to keep in step. The
// block's description is the first one found.
const cleanBlockDescription = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
function descriptionOf(comps) {
  for (const c of comps) { const d = cleanBlockDescription(c.blockDescription); if (d) return d; }
  return '';
}
function setDescription(comp, text) {
  const d = cleanBlockDescription(text);
  if (d) comp.blockDescription = d; else delete comp.blockDescription;
}

// Every block that has at least one assigned terminal, across every sheet,
// sorted by location then designator (X1, X2, ... X10). Each carries its own
// terminals, the positions in use, and the name it is displayed with.
export function listTerminalBlocks() {
  const map = new Map();
  (state.sheets || []).forEach((sheet, sheetIndex) => {
    (sheet.components || []).forEach(comp => {
      if (!isAssignedTerminal(comp)) return;
      const locationId = terminalLocationId(comp, sheet);
      const name = comp.label.trim();
      const key = blockKey(name, locationId);
      if (!map.has(key)) map.set(key, { key, name, locationId, displayName: blockDisplayName(name, locationId), terminals: [] });
      map.get(key).terminals.push({ comp, sheet, sheetIndex });
    });
  });
  const blocks = Array.from(map.values());
  blocks.forEach(b => {
    b.positions = Array.from(new Set(b.terminals.map(t => t.comp.position))).sort((x, y) => x - y);
    b.description = descriptionOf(b.terminals.map(t => t.comp));
  });
  const abbr = (b) => (findLocationById(b.locationId)?.abbreviation) || '';
  blocks.sort((a, b) => abbr(a).localeCompare(abbr(b)) || compareDesignators(a.name, b.name));
  return blocks;
}

export function findTerminalBlock(key) {
  return listTerminalBlocks().find(b => b.key === key) || null;
}

// The terminals in a block already sitting on this position at this level, not
// counting the one being edited. (A terminal with one level is always level 1.)
export function findPositionConflicts(key, position, excludeCompId, level = 1) {
  return findSlotConflicts(key, position, level, excludeCompId);
}

// The lowest whole number not yet used on that block — which is where the next
// terminal goes when nothing says otherwise (and fills a gap left by a deleted
// one). A block that does not exist yet starts at 1.
export function lowestFreePosition(key, excludeCompId) {
  const used = new Set((findTerminalBlock(key)?.terminals || [])
    .filter(t => String(t.comp.id) !== String(excludeCompId)).map(t => t.comp.position));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// [1,2,3,5,7,8] -> "1–3, 5, 7–8", for the "positions in use" hint.
export function formatPositionRanges(positions) {
  const sorted = Array.from(new Set(positions)).sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j - i >= 1 ? `${sorted[i]}\u2013${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(', ');
}

// The first of X1, X2, X3... not already a block in this location.
export function suggestNewBlockName(locationId) {
  const taken = new Set(listTerminalBlocks().filter(b => b.locationId === normaliseLocationId(locationId)).map(b => b.name.toLowerCase()));
  let n = 1;
  while (taken.has(`x${n}`)) n++;
  return `X${n}`;
}

// ---- checking what was typed into the modal ----

// Returns { ok, errors } with a message per field that is wrong. position may
// arrive as text from an <input>. levels and level are checked together: a level
// that the terminal does not have is an error, not something to be clamped.
export function validateTerminalAssignment({ blockName, position, kind, levels, level }) {
  const errors = {};
  const name = String(blockName ?? '').trim();
  if (!name) errors.blockName = 'Choose a block, or give the new block a name.';
  else if (!BLOCK_NAME_PATTERN.test(name)) errors.blockName = 'A block name is 1\u201320 letters, numbers, dots, dashes or underscores, starting with a letter or number (e.g. X1, TB2).';

  const text = String(position ?? '').trim();
  const num = Number(text);
  if (text === '') errors.position = 'Enter the terminal\u2019s position on the block.';
  else if (!/^\d+$/.test(text) || !Number.isInteger(num) || num < 1 || num > MAX_TERMINAL_POSITION) errors.position = `The position is a whole number from 1 to ${MAX_TERMINAL_POSITION}.`;

  if (kind !== undefined && kind !== 'standard' && kind !== TERMINAL_KIND_PE) errors.kind = 'Unknown terminal type.';

  if (levels !== undefined) {
    const count = Number(levels);
    if (!Number.isInteger(count) || count < 1 || count > MAX_TERMINAL_LEVELS) errors.levels = `A terminal has 1 to ${MAX_TERMINAL_LEVELS} levels.`;
    else if (level !== undefined) {
      const l = Number(level);
      if (!Number.isInteger(l) || l < 1 || l > count) errors.level = `Level ${level} does not exist: this terminal has ${count} level${count === 1 ? '' : 's'}.`;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// ---- terminal models: a terminal type, defined once and used wherever it appears ----

export const MAX_TERMINAL_LEVELS = 4;
export const MODEL_NAME_MAX = 40;

const modelList = () => (state.terminalModels || (state.terminalModels = []));
const cleanText = (v) => String(v ?? '').trim();

export function listTerminalModels() {
  return modelList().slice().sort((a, b) => compareDesignators(a.name, b.name));
}

export function findTerminalModel(id) {
  if (id === undefined || id === null || id === '') return null;
  return modelList().find(m => String(m.id) === String(id)) || null;
}

export function terminalModelOf(comp) { return findTerminalModel(comp?.modelId); }

// How many levels a terminal has: its model's, if it has one; otherwise what was
// set by hand; otherwise one.
export function levelsOf(comp) {
  const model = terminalModelOf(comp);
  if (model) return model.levels;
  const n = comp?.levels;
  return Number.isInteger(n) && n >= 1 && n <= MAX_TERMINAL_LEVELS ? n : 1;
}

// Which level a symbol is — never one that does not exist, whatever was saved.
export function levelOf(comp) {
  const n = comp?.level;
  const level = Number.isInteger(n) && n >= 1 ? n : 1;
  return Math.min(level, levelsOf(comp));
}

const storedLevel = (comp) => (Number.isInteger(comp?.level) && comp.level >= 1 ? comp.level : 1);

export function validateTerminalModel({ name, levels }, excludeId) {
  const errors = {};
  const n = cleanText(name);
  if (!n) errors.name = 'Give the model a name, e.g. PTTB 2.5.';
  else if (n.length > MODEL_NAME_MAX) errors.name = `A model name is at most ${MODEL_NAME_MAX} characters.`;
  else if (modelList().some(m => String(m.id) !== String(excludeId) && m.name.toLowerCase() === n.toLowerCase())) errors.name = `There is already a model called ${n}.`;
  const count = Number(levels);
  if (!Number.isInteger(count) || count < 1 || count > MAX_TERMINAL_LEVELS) errors.levels = `Levels is a whole number from 1 to ${MAX_TERMINAL_LEVELS}.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

export function addTerminalModel(fields) {
  const check = validateTerminalModel(fields);
  if (!check.ok) return { ok: false, errors: check.errors };
  // An id no other model has, even if two are made in the same instant.
  let id;
  do { id = Date.now() + Math.floor(Math.random() * 1000); } while (modelList().some(m => m.id === id));
  const model = {
    id,
    name: cleanText(fields.name), make: cleanText(fields.make), modelNo: cleanText(fields.modelNo),
    description: cleanText(fields.description), levels: Number(fields.levels)
  };
  modelList().push(model);
  return { ok: true, model };
}

export function terminalsUsingModel(id) {
  const out = [];
  (state.sheets || []).forEach((sheet, sheetIndex) => (sheet.components || []).forEach(comp => {
    if (isTerminal(comp) && comp.modelId !== undefined && String(comp.modelId) === String(id)) out.push({ comp, sheet, sheetIndex });
  }));
  return out;
}

// Changing a model changes every terminal that uses it — which is the point — but
// it cannot take away a level that one of them is using.
export function updateTerminalModel(id, fields) {
  const model = findTerminalModel(id);
  if (!model) return { ok: false, errors: { name: 'That model no longer exists.' } };
  const merged = { name: fields.name ?? model.name, levels: fields.levels ?? model.levels };
  const check = validateTerminalModel(merged, id);
  if (!check.ok) return { ok: false, errors: check.errors };
  const highest = Math.max(1, ...terminalsUsingModel(id).map(t => storedLevel(t.comp)));
  if (Number(merged.levels) < highest) return { ok: false, errors: { levels: `Level ${highest} of this model is in use on a terminal, so it needs at least ${highest} levels.` } };
  model.name = cleanText(merged.name);
  model.levels = Number(merged.levels);
  if (fields.make !== undefined) model.make = cleanText(fields.make);
  if (fields.modelNo !== undefined) model.modelNo = cleanText(fields.modelNo);
  if (fields.description !== undefined) model.description = cleanText(fields.description);
  return { ok: true, model };
}

// Deleting a model leaves the terminals that used it exactly as they were: each
// keeps its number of levels and its part details, copied onto it, instead of
// losing them. Returns how many terminals that was.
export function deleteTerminalModel(id) {
  const model = findTerminalModel(id);
  if (!model) return 0;
  const users = terminalsUsingModel(id);
  users.forEach(({ comp }) => {
    if (model.levels > 1) comp.levels = model.levels; else delete comp.levels;
    if (!comp.make) comp.make = model.make;
    if (!comp.modelNo) comp.modelNo = model.modelNo || model.name;
    if (!comp.description) comp.description = model.description;
    delete comp.modelId;
  });
  state.terminalModels = modelList().filter(m => String(m.id) !== String(id));
  return users.length;
}

// ---- saving, importing and the standard set ----
// A model file carries models by content, never by id: ids belong to one project,
// and the same file must be importable into any other without colliding.

export const TERMINAL_MODEL_FILE_FORMAT = 'schematicstudio-terminal-models';
export const MAX_IMPORT_MODELS = 500;

export function buildTerminalModelExport(libraryName) {
  return {
    format: TERMINAL_MODEL_FILE_FORMAT,
    version: 1,
    libraryName: cleanText(libraryName) || 'Terminal models',
    models: listTerminalModels().map(m => ({ name: m.name, make: m.make || '', modelNo: m.modelNo || '', description: m.description || '', levels: m.levels }))
  };
}

// Reads a parsed file (our format, or a bare list of models) into clean models.
// Entries that are not usable are counted, not guessed at.
export function parseTerminalModelFile(data) {
  const list = Array.isArray(data) ? data : (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.models) ? data.models : null);
  if (!list) return { ok: false, error: 'That file does not contain terminal models.' };
  if (data && !Array.isArray(data) && data.format !== undefined && data.format !== TERMINAL_MODEL_FILE_FORMAT) {
    return { ok: false, error: 'That file is not a terminal models file.' };
  }
  if (list.length > MAX_IMPORT_MODELS) return { ok: false, error: `That file has more than ${MAX_IMPORT_MODELS} models, which is too many to import.` };
  const models = [];
  let skipped = 0;
  const seen = new Set();
  list.forEach(item => {
    if (!item || typeof item !== 'object') { skipped++; return; }
    const name = cleanText(item.name);
    const levels = Number(item.levels === undefined ? 1 : item.levels);
    if (!name || name.length > MODEL_NAME_MAX || !Number.isInteger(levels) || levels < 1 || levels > MAX_TERMINAL_LEVELS) { skipped++; return; }
    if (seen.has(name.toLowerCase())) { skipped++; return; }   // the same name twice in one file: keep the first
    seen.add(name.toLowerCase());
    models.push({ name, make: cleanText(item.make), modelNo: cleanText(item.modelNo), description: cleanText(item.description), levels });
  });
  return { ok: true, models, skipped, libraryName: data && !Array.isArray(data) ? cleanText(data.libraryName) : '' };
}

const sameModelContent = (a, b) =>
  a.levels === b.levels && cleanText(a.make) === cleanText(b.make) && cleanText(a.modelNo) === cleanText(b.modelNo) && cleanText(a.description) === cleanText(b.description);

// A free name for an imported model whose name is already taken: "Name (2)", "Name (3)"...
function uniqueModelName(name) {
  const taken = new Set(modelList().map(m => m.name.toLowerCase()));
  let n = 2, candidate;
  do {
    const suffix = ` (${n++})`;
    candidate = name.slice(0, MODEL_NAME_MAX - suffix.length).trimEnd() + suffix;
  } while (taken.has(candidate.toLowerCase()));
  return candidate;
}

// Adds clean models to the project without ever changing one already there:
//   same name and same details  -> already have it, nothing added
//   same name, different details -> added under a free name ("Name (2)")
//   a new name                   -> added
// Terminals already on the sheets are untouched whatever happens here.
export function mergeTerminalModels(models) {
  const result = { added: 0, renamed: 0, unchanged: 0 };
  models.forEach(m => {
    const clash = modelList().find(x => x.name.toLowerCase() === m.name.toLowerCase());
    if (clash && sameModelContent(clash, m)) { result.unchanged++; return; }
    const name = clash ? uniqueModelName(m.name) : m.name;
    const out = addTerminalModel({ ...m, name });
    if (out.ok) { result.added++; if (clash) result.renamed++; }
  });
  return result;
}

export function addStandardTerminalModels() {
  return mergeTerminalModels(DEFAULT_TERMINAL_MODELS.map(m => ({ ...m })));
}

// ---- levels, physical terminals and free slots ----
// A physical terminal is one block and position. It has a number of levels, and
// is drawn once per level; all the symbols on it must agree on that number.

export function physicalTerminalAt(key, position, excludeCompId) {
  const block = findTerminalBlock(key);
  if (!block) return null;
  const symbols = block.terminals.filter(t => t.comp.position === position && String(t.comp.id) !== String(excludeCompId));
  if (!symbols.length) return null;
  return {
    symbols,
    levels: Math.max(...symbols.map(t => levelsOf(t.comp))),
    usedLevels: Array.from(new Set(symbols.map(t => levelOf(t.comp)))).sort((a, b) => a - b),
    modelId: symbols.map(t => t.comp.modelId).find(id => id !== undefined && id !== null && id !== '') ?? null
  };
}

// The lowest level of that terminal not yet drawn, or null when every level is.
export function lowestFreeLevel(key, position, excludeCompId) {
  const physical = physicalTerminalAt(key, position, excludeCompId);
  if (!physical) return 1;
  for (let l = 1; l <= physical.levels; l++) if (!physical.usedLevels.includes(l)) return l;
  return null;
}

// `side` (optional): only symbols on that side count - an internal and an external symbol may share a slot, as the two
// connection points of one terminal. Leave it out to find every symbol in the slot.
export function findSlotConflicts(key, position, level, excludeCompId, side) {
  const block = findTerminalBlock(key);
  if (!block) return [];
  return block.terminals.filter(t => t.comp.position === position && levelOf(t.comp) === level && String(t.comp.id) !== String(excludeCompId)
    && (side === undefined || terminalSideOf(t.comp, t.sheet) === side));
}

// Where the next terminal goes: the lowest position and level not yet drawn. A
// multi-level terminal with levels still to draw is filled before moving on.
export function nextFreeSlot(key, excludeCompId) {
  const block = findTerminalBlock(key);
  const others = block ? block.terminals.filter(t => String(t.comp.id) !== String(excludeCompId)) : [];
  const byPosition = new Map();
  others.forEach(({ comp }) => {
    if (!byPosition.has(comp.position)) byPosition.set(comp.position, { levels: 1, used: new Set() });
    const e = byPosition.get(comp.position);
    e.levels = Math.max(e.levels, levelsOf(comp));
    e.used.add(levelOf(comp));
  });
  for (let position = 1; position <= MAX_TERMINAL_POSITION; position++) {
    const e = byPosition.get(position);
    if (!e) return { position, level: 1 };
    for (let level = 1; level <= e.levels; level++) if (!e.used.has(level)) return { position, level };
  }
  return { position: MAX_TERMINAL_POSITION, level: 1 };
}

// modelId: undefined leaves it; null / '' clears it. levels: only kept on the
// terminal itself when it has no model (the model's count is the one that counts).
// A terminal with one level has no level of its own.
function setLevelFields(comp, { levels, level, modelId } = {}) {
  if (modelId !== undefined) { if (modelId === null || modelId === '') delete comp.modelId; else comp.modelId = modelId; }
  if (levels !== undefined) {
    if (terminalModelOf(comp)) delete comp.levels;
    else if (Number(levels) > 1) comp.levels = Number(levels); else delete comp.levels;
  }
  if (level !== undefined) { const n = Number(level); if (n > 1) comp.level = n; else delete comp.level; }
  if (levelsOf(comp) <= 1) delete comp.level;
  return comp;
}

// Gives every symbol on a physical terminal the same model and number of levels.
export function setPhysicalTerminalSpec(key, position, { levels, modelId }) {
  const block = findTerminalBlock(key);
  if (!block) return 0;
  const symbols = block.terminals.filter(t => t.comp.position === position);
  symbols.forEach(({ comp }) => setLevelFields(comp, { levels, modelId }));
  return symbols.length;
}

// ---- creating and changing a terminal ----

// location: null / '' = "the sheet's own location" — stored as no override at
// all. A location the same as the sheet's is also stored as none, so a block is
// not made "different" from its own sheet by a redundant override.
function applyLocation(comp, sheet, locationId) {
  const loc = normaliseLocationId(locationId);
  const sheetLoc = normaliseLocationId(sheet?.iecLocation);
  if (loc === null || loc === sheetLoc) delete comp.location;
  else comp.location = findLocationById(loc)?.id ?? loc;
}

export function buildTerminalComponent(sheet, x, y, { blockName, position, kind, locationId, locationLabel, levels, level, modelId, side }, id = Date.now()) {
  const comp = {
    id, type: 'terminal', label: String(blockName).trim(), value: '',
    modelNo: '', make: '', description: '', x, y, rotation: 0,
    position: Number(position), wireIds: []
  };
  if (kind === TERMINAL_KIND_PE) comp.terminalKind = TERMINAL_KIND_PE;
  if (locationLabel !== undefined) setLocationLabel(comp, locationLabel);
  if (side !== undefined) setTerminalSide(comp, side);
  setLevelFields(comp, { levels, level, modelId });
  applyLocation(comp, sheet, locationId);
  inheritBlockDescription(comp, sheet);
  return comp;
}

// locationLabel: 'auto' | 'show' | 'hide' | 'position' sets it; leaving it out (undefined) leaves
// the terminal's setting exactly as it was. The same goes for levels, level and modelId.
export function applyTerminalAssignment(comp, sheet, { blockName, position, kind, locationId, locationLabel, levels, level, modelId, side }) {
  const oldKey = isAssignedTerminal(comp) ? blockKey(comp.label, terminalLocationId(comp, sheet)) : null;
  comp.label = String(blockName).trim();
  comp.position = Number(position);
  if (kind === TERMINAL_KIND_PE) comp.terminalKind = TERMINAL_KIND_PE; else delete comp.terminalKind;
  if (locationLabel !== undefined) setLocationLabel(comp, locationLabel);
  if (side !== undefined) setTerminalSide(comp, side);
  setLevelFields(comp, { levels, level, modelId });
  applyLocation(comp, sheet, locationId);
  if (oldKey !== blockKey(comp.label, terminalLocationId(comp, sheet))) inheritBlockDescription(comp, sheet);
  return comp;
}

// A terminal joining a block takes that block's description; one starting a new
// block starts without one.
function inheritBlockDescription(comp, sheet) {
  const key = blockKey(comp.label || '', terminalLocationId(comp, sheet));
  const others = [];
  (state.sheets || []).forEach(sh => (sh.components || []).forEach(c => {
    if (c !== comp && isAssignedTerminal(c) && blockKey(c.label, terminalLocationId(c, sh)) === key) others.push(c);
  }));
  setDescription(comp, descriptionOf(others));
}

// Would a terminal in this location show a "+XX-" prefix on a sheet in this
// sheet's own location, in automatic mode? Only when the location is not the
// sheet's and has a name.
export function locationShowsPrefix(locationId, sheet) {
  const loc = normaliseLocationId(locationId);
  if (loc === null || loc === normaliseLocationId(sheet?.iecLocation)) return false;
  return !!findLocationById(loc)?.abbreviation;
}

// What the terminals on a block agree on for the label's location ('auto' if they
// do not agree), and setting it on all of them at once.
export function blockLocationLabelMode(key) {
  const block = findTerminalBlock(key);
  if (!block || block.terminals.length === 0) return LOCATION_LABEL_AUTO;
  const modes = new Set(block.terminals.map(t => locationLabelMode(t.comp)));
  return modes.size === 1 ? Array.from(modes)[0] : LOCATION_LABEL_AUTO;
}

export function setBlockLocationLabel(key, mode) {
  const block = findTerminalBlock(key);
  if (!block) return 0;
  block.terminals.forEach(({ comp }) => setLocationLabel(comp, mode));
  return block.terminals.length;
}

// Moves a whole block to another location — every terminal on it, on every sheet —
// so it stays one block. A terminal only carries a location of its own where that
// is not its sheet's. Returns how many were moved.
export function moveBlockToLocation(key, locationId) {
  const block = findTerminalBlock(key);
  if (!block) return 0;
  block.terminals.forEach(({ comp, sheet }) => applyLocation(comp, sheet, locationId));
  return block.terminals.length;
}

// Renames and/or moves a whole block, and sets what its labels show, in one go:
// every terminal on it, on every sheet. Nothing changes unless every check passes.
// A block cannot be renamed or moved onto the name of another block that already
// exists in the same place - that would silently merge two blocks.
export function amendTerminalBlock(key, { name, locationId, labelMode, description } = {}) {
  const block = findTerminalBlock(key);
  if (!block) return { ok: false, errors: { name: 'That block no longer exists.' } };
  const errors = {};
  const newName = name === undefined ? block.name : String(name).trim();
  if (!newName) errors.name = 'A block needs a designator, e.g. X1.';
  else if (!BLOCK_NAME_PATTERN.test(newName)) errors.name = 'A block name is 1\u201320 letters, numbers, dots, dashes or underscores, starting with a letter or number (e.g. X1, TB2).';
  const newLocation = locationId === undefined ? block.locationId : normaliseLocationId(locationId);
  if (newLocation !== null && !findLocationById(newLocation)) errors.locationId = 'That location no longer exists.';
  // "No location" only means something where the sheets themselves have none: on a
  // sheet that is in a location, a terminal with none of its own is in the sheet's.
  else if (newLocation === null && newLocation !== block.locationId && block.terminals.some(t => normaliseLocationId(t.sheet.iecLocation) !== null)) {
    errors.locationId = 'Choose a location: the sheets this block is on are already in locations of their own.';
  }
  if (description !== undefined && cleanBlockDescription(description).length > BLOCK_DESCRIPTION_MAX) errors.description = `A description is at most ${BLOCK_DESCRIPTION_MAX} characters.`;
  if (labelMode !== undefined && labelMode !== LOCATION_LABEL_AUTO && !LABEL_MODES.includes(labelMode)) errors.labelMode = 'Unknown label setting.';
  if (!Object.keys(errors).length) {
    const newKey = blockKey(newName, newLocation);
    if (newKey !== key && findTerminalBlock(newKey)) {
      errors.name = `There is already a block ${blockDisplayName(newName, newLocation)}. Choose a different designator or location.`;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const count = block.terminals.length;
  const terminals = block.terminals.slice();
  if (newLocation !== block.locationId) terminals.forEach(({ comp, sheet }) => applyLocation(comp, sheet, newLocation));
  if (newName !== block.name) terminals.forEach(({ comp }) => { comp.label = newName; });
  if (labelMode !== undefined) terminals.forEach(({ comp }) => setLocationLabel(comp, labelMode));
  if (description !== undefined) terminals.forEach(({ comp }) => setDescription(comp, description));
  return { ok: true, count, newKey: blockKey(newName, newLocation) };
}

// ---- auto position ----
// Gives a block's positions out in ascending order of the wire ID connected to each
// terminal: the terminal with the lowest wire ID becomes position 1 (or the start
// number), the next 2, and so on, with no gaps. A terminal with several levels
// keeps its levels together and is placed by the lowest wire ID on any of them.
// Terminals with no wire connected come after the wired ones, in the order they
// already had. Wire IDs are compared the way designators are (W2 before W10).

export function planAutoPosition(key, { start = 1, descending = false } = {}) {
  const block = findTerminalBlock(key);
  if (!block) return { ok: false, error: 'That block no longer exists.' };
  const first = Number(start);
  if (!Number.isInteger(first) || first < 1) return { ok: false, error: 'The start position is a whole number, 1 or more.' };
  refreshAllTerminalWireIds();

  const byPosition = new Map();
  block.terminals.forEach(({ comp }) => {
    if (!byPosition.has(comp.position)) byPosition.set(comp.position, []);
    byPosition.get(comp.position).push(comp);
  });
  const entries = Array.from(byPosition.entries()).map(([position, comps]) => {
    const ids = comps.flatMap(c => (Array.isArray(c.wireIds) ? c.wireIds : [])).map(v => String(v).trim()).filter(Boolean);
    ids.sort(compareDesignators);
    return { position, comps, wire: ids.length ? ids[0] : '' };
  });
  entries.sort((a, b) => {
    if (a.wire && b.wire) return (descending ? -1 : 1) * compareDesignators(a.wire, b.wire) || a.position - b.position;
    if (a.wire) return -1;
    if (b.wire) return 1;
    return a.position - b.position;
  });

  if (first + entries.length - 1 > MAX_TERMINAL_POSITION) {
    return { ok: false, error: `That would need positions up to ${first + entries.length - 1}, and the highest position is ${MAX_TERMINAL_POSITION}.` };
  }
  const moves = entries.map((e, i) => ({ comps: e.comps, wire: e.wire, from: e.position, to: first + i }));
  return {
    ok: true, block, moves,
    changed: moves.filter(m => m.from !== m.to).length,
    unwired: moves.filter(m => !m.wire).length
  };
}

export function autoPositionBlock(key, options) {
  const plan = planAutoPosition(key, options);
  if (!plan.ok) return plan;
  plan.moves.forEach(m => m.comps.forEach(c => { c.position = m.to; }));
  return plan;
}

// One row per terminal symbol on a block, for showing what is on it.
export function describeBlockTerminals(key) {
  const block = findTerminalBlock(key);
  if (!block) return [];
  return block.terminals.map(({ comp, sheet, sheetIndex }) => {
    const model = terminalModelOf(comp);
    return {
      comp, sheet, sheetIndex,
      position: comp.position,
      level: levelOf(comp), levels: levelsOf(comp),
      pe: isPETerminal(comp),
      side: terminalSideOf(comp, sheet), sideSetting: terminalSideSetting(comp),
      modelName: model ? model.name : '',
      wireIds: Array.isArray(comp.wireIds) ? comp.wireIds.slice() : []
    };
  }).sort((a, b) => a.position - b.position || a.level - b.level || a.sheetIndex - b.sheetIndex);
}

// The fields a duplicate of an assigned terminal should carry: the same block and
// kind, but the next free slot — never a second symbol on the same level of the
// same screw — and none of the original's saved wire IDs. A new position gets the
// original's model and levels; a free level of a terminal already there gets that
// terminal's.
export function duplicateTerminalFields(sheet, original) {
  const locationId = terminalLocationId(original, sheet);
  const key = blockKey(original.label, locationId);
  // A terminal with several levels is duplicated onto its own next free level first;
  // only when every level is drawn (or it has just the one) does it go on to the
  // next free slot on the block.
  const ownLevel = levelsOf(original) > 1 ? lowestFreeLevel(key, original.position) : null;
  const slot = ownLevel !== null ? { position: original.position, level: ownLevel } : nextFreeSlot(key);
  const fields = { label: original.label, position: slot.position, wireIds: [] };
  if (slot.level > 1) fields.level = slot.level;
  const there = physicalTerminalAt(key, slot.position);
  if (there) {
    if (there.modelId !== null) fields.modelId = there.modelId;
    else if (there.levels > 1) fields.levels = there.levels;
  } else {
    if (original.modelId !== undefined && original.modelId !== null && original.modelId !== '') fields.modelId = original.modelId;
    else if (levelsOf(original) > 1) fields.levels = levelsOf(original);
  }
  if (original.terminalKind) fields.terminalKind = original.terminalKind;
  if (terminalSideSetting(original) !== SIDE_AUTO) fields.side = original.side;
  const description = cleanBlockDescription(original.blockDescription);
  if (description) fields.blockDescription = description;
  const mode = locationLabelMode(original);
  if (mode !== LOCATION_LABEL_AUTO) fields.locationLabel = mode;
  return fields;
}

// ---- the saved wire IDs ----

// The wire ID(s) on wires that end exactly at this terminal's pin. The two
// sides of one terminal are one net, so they normally share a single number —
// but if they differ every distinct one is kept, in the order found.
export function connectedWireIds(comp, sheet) {
  const ids = [];
  (sheet?.wires || []).forEach(wire => {
    const p = wire.points;
    if (!p || p.length < 4) return;
    const atStart = p[0] === comp.x && p[1] === comp.y;
    const atEnd = p[p.length - 2] === comp.x && p[p.length - 1] === comp.y;
    // a wire drawn before the terminal was put on it runs straight through the pin instead of ending there
    let through = false;
    if (!atStart && !atEnd) {
      for (let i = 0; i + 3 < p.length && !through; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], len2 = dx * dx + dy * dy;
        const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((comp.x - p[i]) * dx + (comp.y - p[i + 1]) * dy) / len2));
        through = Math.hypot(p[i] + u * dx - comp.x, p[i + 1] + u * dy - comp.y) < 1;
      }
    }
    const id = wire.wireId === undefined || wire.wireId === null ? '' : String(wire.wireId).trim();
    if ((atStart || atEnd || through) && id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

// Keeps comp.wireIds in step with the wires, so the terminal carries its wire
// ID with it (saved in the project) — and the table can be generated from it
// without every sheet having to be open. A terminal with no wire on it right
// now keeps the last ID it had, rather than being blanked: a wire briefly
// removed while re-routing does not lose the number. Returns how many changed.
export function refreshTerminalWireIds(sheet) {
  let changed = 0;
  (sheet?.components || []).forEach(comp => {
    if (!isTerminal(comp)) return;
    const live = connectedWireIds(comp, sheet);
    if (live.length === 0) { if (!Array.isArray(comp.wireIds)) comp.wireIds = []; return; }
    const saved = Array.isArray(comp.wireIds) ? comp.wireIds : [];
    if (saved.length !== live.length || saved.some((v, i) => v !== live[i])) { comp.wireIds = live; changed++; }
  });
  return changed;
}

export function refreshAllTerminalWireIds() {
  let changed = 0;
  (state.sheets || []).forEach(sheet => { changed += refreshTerminalWireIds(sheet); });
  return changed;
}

// ---- what is shown beside the terminal ----

// The label in its two parts: the designator ("+MP-X1" — by default the location
// only where it differs from the sheet's; always, or never, if the terminal says so;
// nothing at all if it is to show the position alone) and the
// physical position ("3", or "3 PE" for a protective-earth terminal). The sheet
// draws the designator to the left of the terminal and the position to the right.
// null for a terminal that has not been assigned, which keeps showing what it
// always showed.
export function terminalLabelParts(comp, sheet, opts = {}) {
  if (!isAssignedTerminal(comp)) return null;
  const block = comp.label.trim();
  let mode = locationLabelMode(comp);
  if (opts.alwaysBlock && mode === LOCATION_LABEL_POSITION) mode = LOCATION_LABEL_AUTO;   // for lists and tables: the block is always named, even where the sheet shows the position alone
  let designator;
  if (mode === LOCATION_LABEL_POSITION) designator = '';   // the position alone
  else if (mode === LOCATION_LABEL_HIDE) designator = block;
  else if (mode === LOCATION_LABEL_SHOW) {
    // even where the location is the sheet's own — as long as there is one with a name
    const loc = findLocationById(getEffectiveLocationId(comp, sheet));
    designator = loc && loc.abbreviation ? `+${loc.abbreviation}-${block}` : block;
  } else designator = getDisplayDesignator(block, comp, sheet);
  // On a terminal with more than one level the position says which: 5.2
  const level = levelsOf(comp) > 1 ? `.${levelOf(comp)}` : '';
  return { designator, position: `${comp.position}${level}${isPETerminal(comp) ? ' PE' : ''}` };
}

// The same, as one piece of text: "+MP-X1:3".
export function terminalDisplayText(comp, sheet, opts) {
  const parts = terminalLabelParts(comp, sheet, opts);
  if (!parts) return null;
  return parts.designator === '' ? parts.position : `${parts.designator}:${parts.position}`;
}

// ---- the table ----

// Everything the table needs, taken fresh from the sheets: the blocks (or just
// the one chosen), every level of every position with its wire IDs, each block's
// model, and how many terminals are not assigned to a block yet (which cannot be
// placed in it). A level that exists but has no symbol drawn yet is still a row,
// with no wire — it is part of the terminal.
export function collectTerminalTableData(onlyBlockKey = '') {
  refreshAllTerminalWireIds();
  let blocks = listTerminalBlocks();
  if (onlyBlockKey) blocks = blocks.filter(b => b.key === onlyBlockKey);

  const data = blocks.map(block => {
    const byPosition = new Map();
    let sides = false;   // does this block have any external connection? then its cells show both sides
    block.terminals.forEach(({ comp, sheet }) => {
      if (!byPosition.has(comp.position)) byPosition.set(comp.position, { levels: 1, models: new Set(), slots: new Map() });
      const entry = byPosition.get(comp.position);
      entry.levels = Math.max(entry.levels, levelsOf(comp));
      const model = terminalModelOf(comp);
      if (model) entry.models.add(model.name);
      const level = levelOf(comp);
      if (!entry.slots.has(level)) entry.slots.set(level, { wireIds: [], intWireIds: [], extWireIds: [], intDest: [], extDest: [], pe: false, symbols: 0 });
      const slot = entry.slots.get(level);
      slot.symbols++;
      { const d = terminalDestinationsOf(comp, sheet); d.internal.forEach(x => { if (!slot.intDest.includes(x)) slot.intDest.push(x); }); d.external.forEach(x => { if (!slot.extDest.includes(x)) slot.extDest.push(x); }); }
      if (isPETerminal(comp)) slot.pe = true;
      const ends = terminalEndsOf(comp, sheet);
      if (ends) {
        // one symbol with an internal wire on one side and an external one on the other: it fills both sides of the screw
        sides = true;
        [[ends.internal, slot.intWireIds], [ends.external, slot.extWireIds]].forEach(([e, list]) => e.wireIds.forEach(id => {
          if (!slot.wireIds.includes(id)) slot.wireIds.push(id);
          if (!list.includes(id)) list.push(id);
        }));
        return;
      }
      const external = terminalSideOf(comp, sheet) === SIDE_EXTERNAL;
      if (external) sides = true;
      const sideList = external ? slot.extWireIds : slot.intWireIds;
      (comp.wireIds || []).forEach(id => {
        if (!slot.wireIds.includes(id)) slot.wireIds.push(id);
        if (!sideList.includes(id)) sideList.push(id);
      });
    });

    const rows = [];
    const modelNames = new Set();
    const firstSeen = { intDest: new Map(), extDest: new Map() };   // text -> the first position it appears on
    Array.from(byPosition.keys()).sort((a, b) => a - b).forEach(position => {
      const entry = byPosition.get(position);
      entry.models.forEach(n => modelNames.add(n));
      for (let level = 1; level <= entry.levels; level++) {
        const slot = entry.slots.get(level) || { wireIds: [], intWireIds: [], extWireIds: [], intDest: [], extDest: [], pe: false, symbols: 0 };
        // one connection on a device that feeds several terminals (a branch of one net) is listed once, on the lowest position;
        // the others say what it is common with, so it does not read as several connections
        ['intDest', 'extDest'].forEach(k => { slot[k] = slot[k].map(text => {
          if (/^link /.test(text)) return text;
          const first = firstSeen[k].get(text);
          if (first === undefined) { firstSeen[k].set(text, `${block.displayName}:${position}`); return text; }
          return `common with ${first}`;
        }); });
        rows.push({ position, level, levels: entry.levels, wireIds: slot.wireIds, intWireIds: slot.intWireIds, extWireIds: slot.extWireIds, intDest: slot.intDest, extDest: slot.extDest, pe: slot.pe, symbols: slot.symbols });
      }
    });
    // One physical connection is listed once: where the same origin or destination turns up again on a later position (a supply
    // that feeds several terminals, say) it points back to the first, instead of claiming a second connection.
    [['intDest'], ['extDest']].forEach(([key]) => {
      const first = new Map();
      rows.forEach(r => {
        r[key] = r[key].map(text => {
          if (!first.has(text)) { first.set(text, r.position); return text; }
          return first.get(text) === r.position ? text : `as position ${first.get(text)}`;
        });
      });
    });
    // One model for the whole block when every terminal on it has that model; "Mixed"
    // when they differ, or when only some of them have one (it would be wrong to
    // name a model for a terminal that has none); nothing when none do.
    const withoutModel = Array.from(byPosition.values()).filter(e => e.models.size === 0).length;
    const model = modelNames.size === 0 ? '' : (modelNames.size === 1 && withoutModel === 0 ? Array.from(modelNames)[0] : 'Mixed');
    return { key: block.key, displayName: block.displayName, description: block.description || '', model, sides, rows };
  });

  return { blocks: data, unassigned: countUnassignedTerminals() };
}

// How many terminals have no block and position yet (placed before blocks
// existed, say) — they cannot appear in the table until they are assigned.
export function countUnassignedTerminals() {
  let n = 0;
  (state.sheets || []).forEach(sheet => (sheet.components || []).forEach(c => { if (isTerminal(c) && !isAssignedTerminal(c)) n++; }));
  return n;
}

const NO_WIRE = '\u2014';
// sides: the block has external connections, so the cell reads "internal | external" - the wire(s) on the panel side, then
// the wire(s) on the field side (a dash where there is none).
export function terminalCellText(row, sides = false, swap = false) {
  if (!row) return '';
  let wires;
  if (sides) {
    const side = (ids) => (ids && ids.length ? ids.join(' / ') : NO_WIRE);
    wires = swap ? `${side(row.extWireIds)} | ${side(row.intWireIds)}` : `${side(row.intWireIds)} | ${side(row.extWireIds)}`;
  } else {
    wires = row.wireIds.length ? row.wireIds.join(' / ') : NO_WIRE;
  }
  return row.pe ? `${wires} (PE)` : wires;
}

// Blocks across the top, positions (and the levels within them) down the side: a
// header row of the block designators, a row of their descriptions and one of their models if any have one, and
// in each cell the wire ID(s) at that position and level. A position or level a
// block does not have is simply left blank.
export function buildTerminalTableMatrix(blocks, options = {}) {
  const descending = options.order === 'desc';
  const horizontal = options.orientation === 'horizontal';
  const showDest = !!options.dest && blocks.length === 1;
  const swap = !!options.swap;   // external on the left, internal on the right
  const rowsOf = (b) => b.rows.map(r => ({ ...r, level: r.level ?? 1, levels: r.levels ?? 1 }));
  const normalised = blocks.map(b => ({ ...b, rows: rowsOf(b) }));
  const slotMap = new Map();
  normalised.forEach(b => b.rows.forEach(r => slotMap.set(`${r.position}.${r.level}`, { position: r.position, level: r.level })));
  const slots = Array.from(slotMap.values()).sort((a, b) => (descending ? -1 : 1) * (a.position - b.position) || a.level - b.level);
  const destOf = (b, slot, key) => { const r = b.rows.find(x => x.position === slot.position && x.level === slot.level); return r && r[key] ? r[key].join(' / ') : ''; };
  return {
    horizontal, showDest, swap,
    left: showDest ? slots.map(sl => destOf(normalised[0], sl, swap ? 'extDest' : 'intDest')) : null,
    right: showDest ? slots.map(sl => destOf(normalised[0], sl, swap ? 'intDest' : 'extDest')) : null,
    slots,
    headers: normalised.map(b => (b.sides ? `${b.displayName} (${swap ? 'ext | int' : 'int | ext'})` : b.displayName)),
    descriptions: normalised.map(b => b.description || ''),
    models: normalised.map(b => b.model || ''),
    hasLevels: normalised.some(b => b.rows.some(r => r.levels > 1)),
    positions: Array.from(new Set(slots.map(s => s.position))),
    rows: slots.map((slot, i) => ({
      position: slot.position,
      level: slot.level,
      firstOfPosition: i === 0 || slots[i - 1].position !== slot.position,
      cells: normalised.map(b => terminalCellText(b.rows.find(r => r.position === slot.position && r.level === slot.level), !!b.sides, swap))
    }))
  };
}

// Draws the matrix as a custom symbol's path segments and texts: an outline, a
// header row (then a Desc row when blocks have descriptions, and a Type row when they have models), a position column (and a
// level column when any terminal has levels), and the cell text centred in every
// cell. The levels of one position share a position cell and are divided by dashed
// lines. No pins — it is documentation, not something wires connect to.
const TABLE_GRID = 10;   // table rows and columns are multiples of half the sheet's grid (GRID_SIZE is 20), so every line sits on a grid line
const TABLE_LEAD = 20;   // length of an origin / destination leader (a whole grid square)

export function buildTerminalTableGeometry(matrix) {
  if (matrix.horizontal) return buildHorizontalTableGeometry(matrix);
  const g = buildVerticalTableGeometry(matrix);
  if (!matrix.showDest || !matrix.left) return g;
  // origin / destination: a leader line out of each row on the left (the internal wire) and on the right (the external
  // wire), each with its text, as on a terminal strip drawing
  const FONT = 14, rendered = FONT * 0.5, CHAR_RATIO = 0.55, LEAD = TABLE_LEAD, GAP = 3, ROW_H = TABLE_GRID;
  const wOf = (t) => String(t).length * rendered * CHAR_RATIO;
  const leftW = Math.max(0, ...matrix.left.map(wOf)), rightW = Math.max(0, ...matrix.right.map(wOf));
  const ox = Math.ceil((leftW + LEAD + GAP * 2) / 20) * 20, tableW = g.width;
  const shift = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${Math.round((Number(x) + ox) * 10) / 10} ${y}`);
  const pathSegments = g.pathSegments.map(seg => ({ ...seg, d: shift(seg.d) }));
  const texts = g.texts.map(t => ({ ...t, relX: Math.round((t.relX + ox) * 10) / 10 }));
  const topH = g.height - matrix.rows.length * ROW_H;
  matrix.rows.forEach((row, i) => {
    const y = topH + i * ROW_H + ROW_H / 2;
    const ty = Math.round((y - rendered / 2 - 1) * 10) / 10;
    if (matrix.left[i]) {
      pathSegments.push({ d: `M ${ox - LEAD} ${y} L ${ox} ${y}`, dash: 'solid' });
      texts.push({ text: matrix.left[i], relX: Math.round((ox - LEAD - GAP - wOf(matrix.left[i])) * 10) / 10, relY: ty, fontSize: FONT });
    }
    if (matrix.right[i]) {
      pathSegments.push({ d: `M ${ox + tableW} ${y} L ${ox + tableW + LEAD} ${y}`, dash: 'solid' });
      texts.push({ text: matrix.right[i], relX: Math.round((ox + tableW + LEAD + GAP) * 10) / 10, relY: ty, fontSize: FONT });
    }
  });
  return { pathSegments, pins: [], texts, width: ox + tableW + LEAD + GAP * 2 + rightW, height: g.height };
}

// The same table turned on its side: the positions run across the page, each block is a row, and (when asked for) the
// origin and destination of the internal and external wires are rows of their own.
function buildHorizontalTableGeometry(matrix) {
  const FONT = 14, HEAD_FONT = 16, rendered = (f) => f * 0.5, CHAR_RATIO = 0.55, CELL_PAD = 8, ROW_H = TABLE_GRID, MIN_W = 4 * TABLE_GRID;
  const wOf = (t, f) => String(t).length * rendered(f) * CHAR_RATIO;
  const slots = matrix.slots || [];
  const hasLevels = matrix.hasLevels;
  const grid = [['Pos'].concat(slots.map(s => (hasLevels ? `${s.position}.${s.level}` : String(s.position))))];
  const labels = matrix.headers;
  labels.forEach((h, bi) => grid.push([h].concat(matrix.rows.map(r => r.cells[bi] || ''))));
  if (matrix.showDest && matrix.left) {
    grid.push([matrix.swap ? 'From (ext)' : 'From (int)'].concat(matrix.left));
    grid.push([matrix.swap ? 'To (int)' : 'To (ext)'].concat(matrix.right));
  }
  const cols = grid[0].length;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(MIN_W, Math.ceil((Math.max(...grid.map((row, r) => wOf(row[c] || '', r === 0 || c === 0 ? HEAD_FONT : FONT))) + CELL_PAD) / TABLE_GRID) * TABLE_GRID));
  const totalW = colW.reduce((a, b) => a + b, 0), totalH = grid.length * ROW_H;
  const pathSegments = [{ d: `M 0 0 L ${totalW} 0 L ${totalW} ${totalH} L 0 ${totalH} Z`, dash: 'solid' }];
  let x = 0;
  colW.slice(0, -1).forEach(w => { x += w; pathSegments.push({ d: `M ${x} 0 L ${x} ${totalH}`, dash: 'solid' }); });
  for (let r = 1; r < grid.length; r++) pathSegments.push({ d: `M 0 ${r * ROW_H} L ${totalW} ${r * ROW_H}`, dash: 'solid' });
  const texts = [];
  grid.forEach((row, r) => {
    let left = 0;
    row.forEach((cell, c) => {
      const f = r === 0 || c === 0 ? HEAD_FONT : FONT;
      if (cell) texts.push({ text: String(cell), relX: Math.round((left + (colW[c] - wOf(cell, f)) / 2) * 10) / 10, relY: Math.round((r * ROW_H + (ROW_H - rendered(f)) / 2) * 10) / 10, fontSize: f });
      left += colW[c];
    });
  });
  return { pathSegments, pins: [], texts, width: totalW, height: totalH };
}

function buildVerticalTableGeometry(matrix) {
  const FONT = 14, HEAD_FONT = 16;            // halved when drawn (the symbol text convention): 7px and 8px
  const rendered = (f) => f * 0.5;
  const CHAR_RATIO = 0.55, CELL_PAD = 8;
  // Every line of the table falls on the sheet's grid (rows, header and columns are whole grid squares), so it snaps into place
  // and lines up with everything else on the sheet.
  const ROW_H = TABLE_GRID, HEAD_H = 2 * TABLE_GRID, MIN_POS_W = 4 * TABLE_GRID, MIN_LVL_W = 2 * TABLE_GRID, MIN_COL_W = 4 * TABLE_GRID;
  const toGrid = (w) => Math.ceil(w / TABLE_GRID) * TABLE_GRID;
  const width = (text, f) => String(text).length * rendered(f) * CHAR_RATIO;
  const hasLevels = !!matrix.hasLevels;
  const models = matrix.models || [];
  const hasModel = models.some(Boolean);
  const descriptions = matrix.descriptions || [];
  const hasDescription = descriptions.some(Boolean);

  const posW = Math.max(MIN_POS_W, toGrid(Math.max(width('Pos', HEAD_FONT), hasModel ? width('Type', FONT) : 0, hasDescription ? width('Desc', FONT) : 0, ...matrix.positions.map(p => width(p, FONT))) + CELL_PAD));
  const lvlW = hasLevels ? Math.max(MIN_LVL_W, toGrid(Math.max(width('Lvl', HEAD_FONT), ...matrix.rows.map(r => width(r.level ?? 1, FONT))) + CELL_PAD)) : 0;
  const colW = matrix.headers.map((h, i) => Math.max(MIN_COL_W, toGrid(Math.max(width(h, HEAD_FONT), width(models[i] || '', FONT), width(descriptions[i] || '', FONT), ...matrix.rows.map(r => width(r.cells[i], FONT))) + CELL_PAD)));
  const leftW = posW + lvlW;
  const colLeft = [];
  colW.reduce((x, w) => { colLeft.push(x); return x + w; }, leftW);
  const totalW = leftW + colW.reduce((a, b) => a + b, 0);
  const descBottom = HEAD_H + (hasDescription ? ROW_H : 0);
  const topH = descBottom + (hasModel ? ROW_H : 0);
  const totalH = topH + matrix.rows.length * ROW_H;

  const pathSegments = [{ d: `M 0 0 L ${totalW} 0 L ${totalW} ${totalH} L 0 ${totalH} Z`, dash: 'solid' }];
  pathSegments.push({ d: `M 0 ${HEAD_H} L ${totalW} ${HEAD_H}`, dash: 'solid' });
  if (hasDescription) pathSegments.push({ d: `M 0 ${descBottom} L ${totalW} ${descBottom}`, dash: 'solid' });
  if (hasModel) pathSegments.push({ d: `M 0 ${topH} L ${totalW} ${topH}`, dash: 'solid' });
  const verticals = [posW];
  if (hasLevels) verticals.push(leftW);
  colLeft.slice(1).forEach(x => verticals.push(x));
  verticals.forEach(x => pathSegments.push({ d: `M ${x} 0 L ${x} ${totalH}`, dash: 'solid' }));
  matrix.rows.forEach((row, i) => {
    if (i === 0) return;
    const y = topH + i * ROW_H;
    // between the levels of one position: dashed, and not through the position column
    if (hasLevels && row.firstOfPosition === false) pathSegments.push({ d: `M ${posW} ${y} L ${totalW} ${y}`, dash: 'dashed' });
    else pathSegments.push({ d: `M 0 ${y} L ${totalW} ${y}`, dash: 'solid' });
  });

  const texts = [];
  const centred = (text, left, cellW, top, cellH, fontSize) => {
    const w = width(text, fontSize);
    texts.push({ text: String(text), relX: Math.round((left + (cellW - w) / 2) * 10) / 10, relY: Math.round((top + (cellH - rendered(fontSize)) / 2) * 10) / 10, fontSize });
  };
  centred('Pos', 0, posW, 0, HEAD_H, HEAD_FONT);
  if (hasLevels) centred('Lvl', posW, lvlW, 0, HEAD_H, HEAD_FONT);
  matrix.headers.forEach((h, i) => centred(h, colLeft[i], colW[i], 0, HEAD_H, HEAD_FONT));
  if (hasDescription) {
    centred('Desc', 0, posW, HEAD_H, ROW_H, FONT);
    descriptions.forEach((d, i) => { if (d) centred(d, colLeft[i], colW[i], HEAD_H, ROW_H, FONT); });
  }
  if (hasModel) {
    centred('Type', 0, posW, descBottom, ROW_H, FONT);
    models.forEach((m, i) => { if (m) centred(m, colLeft[i], colW[i], descBottom, ROW_H, FONT); });
  }
  matrix.rows.forEach((row, r) => {
    const top = topH + r * ROW_H;
    if (!hasLevels || row.firstOfPosition !== false) centred(row.position, 0, posW, top, ROW_H, FONT);
    if (hasLevels) centred(row.level ?? 1, posW, lvlW, top, ROW_H, FONT);
    row.cells.forEach((cell, i) => { if (cell) centred(cell, colLeft[i], colW[i], top, ROW_H, FONT); });
  });

  return { pathSegments, pins: [], texts, width: totalW, height: totalH };
}

// Symbols made by the table generator are documentation, like a shield: never a
// stocked part, never given a designator or value drawn above them.
export const TERMINAL_TABLE_SYMBOL_PREFIX = 'custom_terminaltable_';
export function isTerminalTableSymbol(type) {
  return String(type).startsWith(TERMINAL_TABLE_SYMBOL_PREFIX);
}
