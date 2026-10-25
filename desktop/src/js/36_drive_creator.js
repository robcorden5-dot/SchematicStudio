// ==========================================
// 36. DRIVE CREATOR (the dialog)
// ==========================================
// Make, model, description, rating and designator, then the drive's terminals: the supply
// along the top, the motor along the bottom and the control terminals down the right edge.
// Making it adds a symbol to the library you choose (Drives by default), which is dragged
// onto a sheet like any other. Opening such a symbol with Edit in the sidebar comes back here.
// The drawing and the rules are in 35_drive_modules.js.
//
// Pro feature, like creating any custom symbol.

import { isFreePlan, appAlert, pushHistory, scheduleAutosave } from './1_config_state.js';
import * as D from './35_drive_modules.js';
import * as G from './37_terminal_groups.js';

const el = (id) => document.getElementById(id);
let editingKey = null;                       // the symbol being edited; null = a new drive
let top = [], bottom = [], control = [];     // [{ name, kind }], [{ name, kind }], [{ name, kind, fn }]
let groups = [];                             // [{ id, name, description }] - terminals grouped under one name (a terminal says which with .group)

function setMessage(text, kind) {
  const box = el('driveMessage');
  if (!box) return;
  box.textContent = text || '';
  box.style.display = text ? 'block' : 'none';
  box.style.color = kind === 'error' ? '#f87171' : (kind === 'ok' ? '#4ade80' : '');
}

const readDrive = () => ({
  layout: el('driveLayout') && el('driveLayout').value === 'classic' ? 'classic' : 'block',
  make: el('driveMake').value, model: el('driveModel').value, description: el('driveDescription').value, rating: el('driveRating').value,
  designator: el('driveDesignator').value, library: el('driveLibrary').value,
  top: top.map(strip), bottom: bottom.map(strip), control: control.map(strip), groups: groups.map(g => ({ ...g }))
});
function strip(t) { const o = { ...t }; delete o._sel; return o; }

const isBlock = () => !el('driveLayout') || el('driveLayout').value !== 'classic';
const allNames = () => [...top, ...bottom, ...control].map(t => t.name);

// ---- the rows ----

function moveIn(list, item, delta) {
  const i = list.indexOf(item), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  list.splice(i, 1); list.splice(j, 0, item);
  renderAll();
}

function rowButtons(row, list, item, noun) {
  const mk = (html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-icon'; b.innerHTML = html; b.title = title; b.onclick = fn; row.appendChild(b); };
  mk('&#9650;', `Move this ${noun} up`, () => moveIn(list, item, -1));
  mk('&#9660;', `Move this ${noun} down`, () => moveIn(list, item, 1));
  mk('&#10005;', `Remove this ${noun}`, () => { list.splice(list.indexOf(item), 1); renderAll(); });
}

function textInput(cls, value, max, label, onInput, placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text'; input.className = cls; input.value = value; input.maxLength = max; input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.oninput = () => { onInput(input.value); updatePreview(); };
  return input;
}

function powerRow(list, t, n, edgeName) {
  const row = document.createElement('div');
  row.className = 'plc-row plc-row-supply';
  groupBox(row, t);
  row.appendChild(textInput('plc-addr', t.name, D.DRIVE_LIMITS.name, `${edgeName} terminal ${n} name`, v => { t.name = v; }, 'Name'));
  groupBadge(row, t);
  rowButtons(row, list, t, 'terminal');
  return row;
}

function controlRow(t, n) {
  const row = document.createElement('div');
  row.className = 'plc-row';
  groupBox(row, t);
  row.appendChild(textInput('plc-addr', t.name, D.DRIVE_LIMITS.name, `Control terminal ${n} name`, v => { t.name = v; }, 'Name'));
  const kind = document.createElement('select');
  kind.className = 'plc-kind plc-suptype';
  kind.setAttribute('aria-label', `Control terminal ${n} type`);
  Object.entries(D.DRIVE_CONTROL_TYPES).forEach(([v, def]) => { const o = document.createElement('option'); o.value = v; o.textContent = def.label; kind.appendChild(o); });
  kind.value = D.DRIVE_CONTROL_TYPES[t.kind] ? t.kind : 'other';
  kind.onchange = () => { t.kind = kind.value; updatePreview(); };
  row.appendChild(kind);
  if (isBlock()) {   // the block layout has a left and a right column
    const side = document.createElement('select');
    side.className = 'plc-kind'; side.style.maxWidth = '70px';
    side.setAttribute('aria-label', `Control terminal ${n} side`);
    [['left', 'Left'], ['right', 'Right']].forEach(([v, text]) => { const o = document.createElement('option'); o.value = v; o.textContent = text; side.appendChild(o); });
    side.value = t.side === 'right' ? 'right' : 'left';
    side.onchange = () => { t.side = side.value; updatePreview(); };
    row.appendChild(side);
  }
  const fn = textInput('plc-fn', t.fn || '', D.DRIVE_LIMITS.fn, `Control terminal ${n} function`, v => { t.fn = v; }, 'Function');
  fn.setAttribute('list', 'driveFunctionList');
  row.appendChild(fn);
  groupBadge(row, t);
  rowButtons(row, control, t, 'terminal');
  return row;
}

// ---- groups ----
// Tick any terminals on one edge and "Group ticked terminals" puts them under one name and description (X3, Encoder):
// they are brought together, and drawn in a frame with that title.

function groupBox(row, t) {
  const box = document.createElement('input');
  box.type = 'checkbox'; box.className = 'grp-sel'; box.checked = !!t._sel; box.title = 'Tick to group this terminal with others';
  box.setAttribute('aria-label', 'Select this terminal');
  box.onchange = () => { t._sel = box.checked; };
  row.appendChild(box);
}

function groupBadge(row, t) {
  const g = groups.find(x => x.id === t.group);
  if (!g) return;
  const badge = document.createElement('span');
  badge.className = 'grp-badge'; badge.textContent = g.name || '?'; badge.title = G.groupTitle(g) || 'Group';
  row.appendChild(badge);
}

const everyTerminal = () => [...top, ...bottom, ...control];

function pruneGroups() {
  const used = new Set(everyTerminal().map(t => t.group).filter(Boolean));
  groups = groups.filter(g => used.has(g.id));
  everyTerminal().forEach(t => { if (t.group && !groups.some(g => g.id === t.group)) delete t.group; });
}

export function groupDriveSelected() {
  const lists = [top, bottom, control];
  const where = lists.filter(l => l.some(t => t._sel));
  if (!where.length) { setMessage('Tick the terminals to group first, using the boxes at the left of each row.', 'error'); return; }
  if (where.length > 1) { setMessage('A group sits on one edge. Tick terminals from the supply, the motor or the control list, not a mix.', 'error'); return; }
  const list = where[0];
  const picked = list.filter(t => t._sel);
  if (list === control && isBlock() && new Set(picked.map(t => t.side === 'right' ? 'right' : 'left')).size > 1) { setMessage('A group sits on one side. Tick control terminals that are all on the left or all on the right.', 'error'); return; }
  const before = list.slice(0, list.indexOf(picked[0])).filter(t => !t._sel).length;
  const rest = list.filter(t => !t._sel);
  rest.splice(before, 0, ...picked);                              // together, where the first of them was
  list.splice(0, list.length, ...rest);
  const g = { id: G.nextGroupId(groups), name: G.nextGroupName(groups), description: '' };
  groups.push(g);
  picked.forEach(t => { t.group = g.id; t._sel = false; });
  setMessage('');
  renderAll();
  const nameInput = el('driveGroups').querySelector(`[data-group="${g.id}"] input`);
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

export function ungroupDriveSelected() {
  const picked = everyTerminal().filter(t => t._sel);
  if (!picked.length) { setMessage('Tick the terminals to take out of their group first.', 'error'); return; }
  picked.forEach(t => { delete t.group; t._sel = false; });
  setMessage('');
  renderAll();
}

function renderGroups() {
  const box = el('driveGroups');
  if (!box) return;
  pruneGroups();
  box.innerHTML = '';
  groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'plc-row'; row.dataset.group = g.id;
    row.appendChild(textInput('plc-addr', g.name, G.GROUP_LIMITS.name, 'Group name', v => { g.name = v; renderLists(); }, 'Name'));
    row.appendChild(textInput('plc-fn', g.description, G.GROUP_LIMITS.description, 'Group description', v => { g.description = v; }, 'Description, e.g. Encoder'));
    const count = document.createElement('span');
    count.className = 'grp-badge'; count.style.maxWidth = '90px'; count.textContent = `${everyTerminal().filter(t => t.group === g.id).length} terminals`;
    row.appendChild(count);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-icon'; remove.innerHTML = '&#10005;'; remove.title = 'Remove this group (the terminals stay)';
    remove.onclick = () => { everyTerminal().forEach(t => { if (t.group === g.id) delete t.group; }); renderAll(); };
    row.appendChild(remove);
    box.appendChild(row);
  });
}

const rowOf = new Map();

function renderList(boxId, list, build, emptyText) {
  const box = el(boxId);
  box.innerHTML = '';
  list.forEach((t, i) => { const row = build(t, i + 1); rowOf.set(t, row); box.appendChild(row); });
  if (!list.length) { const none = document.createElement('div'); none.className = 'modal-hint'; none.textContent = emptyText; box.appendChild(none); }
}

function renderLists() {
  rowOf.clear();
  renderList('driveTopList', top, (t, n) => powerRow(top, t, n, 'Supply'), 'No supply terminals. Add them below.');
  renderList('driveBottomList', bottom, (t, n) => powerRow(bottom, t, n, 'Motor'), 'No motor terminals. Add them below.');
  renderList('driveControlList', control, controlRow, 'No control terminals. Add them below.');
}

function renderAll() {
  pruneGroups();
  renderLists();
  renderGroups();
  updatePreview();
}

function focusRow(item) {
  const row = rowOf.get(item);
  if (row) { row.scrollIntoView({ block: 'nearest' }); const input = row.querySelector('input'); if (input) input.focus(); }
}

// ---- adding ----

// The "+ Add" menu under the supply and motor edges: a ready-made set of terminals (L1 L2 L3, U V W...) or a single one.
export function addDrivePower(select, edge) {
  const key = select.value;
  select.value = '';
  const preset = D.DRIVE_POWER_PRESETS[key];
  if (!preset) return;
  const list = edge === 'top' ? top : bottom;
  if (list.length + preset.names.length > D.DRIVE_MAX_POWER) { setMessage(`Each edge has at most ${D.DRIVE_MAX_POWER} terminals.`, 'error'); return; }
  const taken = allNames();
  let last = null;
  preset.names.forEach(name => {
    const unique = name ? D.uniqueDriveName(name, taken) : '';
    taken.push(unique);
    last = { name: unique, kind: preset.kind };
    list.push(last);
  });
  setMessage('');
  renderAll();
  focusRow(last);
}

// Adds a control terminal of that type, named DI1, DI2... so as not to clash with any other.
export function addDriveControl(select) {
  const type = select.value;
  select.value = '';
  if (!D.DRIVE_CONTROL_TYPES[type]) return;
  if (control.length >= D.DRIVE_MAX_CONTROL) { setMessage(`A drive has at most ${D.DRIVE_MAX_CONTROL} control terminals.`, 'error'); return; }
  const t = { name: D.nextControlName(type, allNames()), kind: type, fn: '' };
  if (isBlock()) t.side = D.defaultSide(type);
  control.push(t);
  setMessage('');
  renderAll();
  focusRow(t);
}

// ---- preview ----

function updatePreview() {
  const box = el('drivePreview');
  if (!box) return;
  const drive = D.normaliseDrive(readDrive());
  if (!drive.top.length && !drive.bottom.length && !drive.control.length) { box.textContent = ''; return; }
  const g = D.buildDriveGeometry(drive);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const pad = 14, topY = (g.top ?? 0) - pad, bottomY = (g.bottom ?? g.height) + pad;
  svg.setAttribute('viewBox', `${-pad} ${topY} ${g.rightPins + 2 * pad} ${bottomY - topY}`);
  svg.setAttribute('style', 'width:100%; max-height:300px; background:#fff; border-radius:4px;');
  g.pathSegments.forEach(seg => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', seg.d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#0f172a'); path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
  });
  g.pins.forEach(p => {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', p.relX); dot.setAttribute('cy', p.relY); dot.setAttribute('r', 2.5); dot.setAttribute('fill', '#2563eb');
    svg.appendChild(dot);
  });
  g.texts.forEach(t => {
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', t.relX); text.setAttribute('y', t.relY + (t.fontSize * 0.5) * 0.8);
    text.setAttribute('font-size', t.fontSize * 0.5); text.setAttribute('font-family', 'sans-serif'); text.setAttribute('fill', '#0f172a');
    text.textContent = t.text;
    svg.appendChild(text);
  });
  box.textContent = '';
  box.appendChild(svg);
}

// ---- opening and closing ----

function libraryNames() {
  const names = new Set([D.DRIVE_DEFAULT_LIBRARY]);
  Object.values(window.customSymbolDefinitions || {}).forEach(sym => { if (sym && !sym.hidden && sym.library) names.add(sym.library); });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function fillStaticLists() {
  const fns = el('driveFunctionList');
  if (fns && !fns.options.length) D.DRIVE_FUNCTION_SUGGESTIONS.forEach(f => { const o = document.createElement('option'); o.value = f; fns.appendChild(o); });
  const libs = el('driveLibraryList');
  libs.innerHTML = '';
  libraryNames().forEach(n => { const o = document.createElement('option'); o.value = n; libs.appendChild(o); });
}

export async function openDriveCreator(symKey = null) {
  if (isFreePlan()) { await appAlert('The Drive creator is a Pro feature, like creating any custom symbol.'); return; }
  const def = symKey ? window.customSymbolDefinitions?.[symKey] : null;
  editingKey = def && D.isDriveSymbol(def) ? symKey : null;
  const m = editingKey ? D.normaliseDrive(def.drive) : D.defaultDrive();

  fillStaticLists();
  el('driveMake').value = m.make; el('driveModel').value = m.model; el('driveDescription').value = m.description; el('driveRating').value = m.rating;
  el('driveDesignator').value = m.designator;
  if (el('driveLayout')) el('driveLayout').value = m.layout === 'block' ? 'block' : 'classic';
  el('driveLibrary').value = editingKey && def.library ? def.library : D.DRIVE_DEFAULT_LIBRARY;
  top = m.top.map(t => ({ ...t })); bottom = m.bottom.map(t => ({ ...t })); control = m.control.map(t => ({ ...t })); groups = (m.groups || []).map(g => ({ ...g }));

  el('driveTitle').textContent = editingKey ? 'Edit Drive' : 'Drive Creator';
  el('driveSaveBtn').textContent = editingKey ? 'Save changes' : 'Create drive';
  el('driveEditNote').style.display = editingKey ? 'block' : 'none';
  setMessage('');
  renderAll();
  wireKeyboardOnce();
  el('driveModal').style.display = 'flex';
  el(editingKey ? 'driveModel' : 'driveMake').focus();
}

export function closeDriveCreator() {
  const modal = el('driveModal');
  if (modal) modal.style.display = 'none';
  editingKey = null;
}

function wireKeyboardOnce() {
  const modal = el('driveModal');
  if (!modal || modal.dataset.keysWired === '1') return;
  modal.dataset.keysWired = '1';
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDriveCreator(); } });
  ['driveMake', 'driveModel', 'driveDescription', 'driveRating', 'driveDesignator'].forEach(id => el(id).addEventListener('input', updatePreview));
  if (el('driveLayout')) el('driveLayout').addEventListener('change', () => { control.forEach(t => { if (isBlock() && !t.side) t.side = D.defaultSide(t.kind); }); renderAll(); });
}

// ---- making the symbol ----

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export async function saveDrive(renderSymbolsListCallback, renderComponentsCallback) {
  if (isFreePlan()) return;
  const drive = readDrive();
  const check = D.validateDrive(drive);
  if (!check.ok) {
    const first = check.errors.model || check.errors.designator || check.errors.make || check.errors.description || check.errors.rating || check.errors.library
      || check.errors.power || check.errors.control || Object.entries(check.errors).find(([k]) => /^grp/.test(k))?.[1] || Object.entries(check.errors).find(([k]) => /^(top|bot|ctl)\d+$/.test(k))?.[1] || 'The drive could not be made.';
    setMessage(first, 'error');
    const focus = check.errors.model ? 'driveModel' : (check.errors.designator ? 'driveDesignator' : null);
    if (focus) el(focus).focus();
    return;
  }

  const library = String(drive.library ?? '').replace(/\s+/g, ' ').trim() || D.DRIVE_DEFAULT_LIBRARY;
  const definition = D.buildDriveSymbolDefinition(drive, library);
  const defs = window.customSymbolDefinitions;

  // Two symbols with the same name in one library could not be told apart in the sidebar.
  const clash = Object.entries(defs).find(([key, sym]) => !sym.hidden && key !== editingKey && (sym.library || 'My Symbols') === library && sameName(sym.name, definition.name));
  if (clash) { setMessage(`"${library}" already has a symbol called "${definition.name}". Change the make or model, or choose another library.`, 'error'); return; }

  let symKey = editingKey;
  if (!symKey) {
    const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'drive';
    symKey = `custom_drive_${slug}`;
    for (let n = 2; Object.prototype.hasOwnProperty.call(defs, symKey); n++) symKey = `custom_drive_${slug}_${n}`;
  }

  pushHistory();
  defs[symKey] = definition;
  if (renderSymbolsListCallback) renderSymbolsListCallback();
  if (renderComponentsCallback) renderComponentsCallback();
  scheduleAutosave();
  closeDriveCreator();
  await appAlert(`${definition.name} is in the "${library}" library in the sidebar. Drag it onto a sheet.`, 'Drive ready');
}
