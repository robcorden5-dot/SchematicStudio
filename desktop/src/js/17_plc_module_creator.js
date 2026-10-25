// ==========================================
// 17. PLC MODULE CREATOR (the dialog)
// ==========================================
// Make, model, description and designator, then how many inputs and outputs the
// module has, each with an address and a function (Hydraulic, Pneumatic...). Making
// it adds a symbol to the library you choose (PLC Modules by default), which is
// dragged onto a sheet like any other. Opening such a symbol with Edit in the
// sidebar comes back here. The drawing and the rules are in 16_plc_modules.js.
//
// Pro feature, like creating any custom symbol.

import { state, isFreePlan, appAlert, pushHistory, scheduleAutosave } from './1_config_state.js';
import * as PLC from './16_plc_modules.js';
import * as G from './37_terminal_groups.js';

const el = (id) => document.getElementById(id);
let editingKey = null;                 // the symbol being edited; null = a new module
let inputs = [], outputs = [];         // [{ address, fn, kind }]
let supplies = [];                     // [{ name, type, value }] - supply, common, earth and other connections
let groups = [];                       // [{ id, name, description }] - terminals grouped under one name (an item says which with .group)

const addressOptions = () => ({ style: el('plcAddrStyle').value === 'sequential' ? 'sequential' : 'bytebit', start: Number(el('plcAddrStart').value) || 0 });

function setMessage(text, kind) {
  const box = el('plcMessage');
  if (!box) return;
  box.textContent = text || '';
  box.style.display = text ? 'block' : 'none';
  box.style.color = kind === 'error' ? '#f87171' : (kind === 'ok' ? '#4ade80' : '');
}

// ---- the two edges ----
// Every pin sits on the top or the bottom edge, whatever it is: an input, an output or a
// supply / common / earth connection. By default supplies and inputs go on the top and outputs
// and 0V / common / earth on the bottom, but any row can be dragged to either edge. Each edge is
// one list, in the order its pins sit along the module. Every row has an edge (_e) and an
// order number within it (_o), which dragging rewrites.

const defaultEdge = (item) => (supplies.includes(item) ? (PLC.supplySide(item.type) === 'top' ? 'top' : 'bottom') : (outputs.includes(item) ? 'bottom' : 'top'));
const edgeOf = (item) => item._e || defaultEdge(item);
const byOrder = (a, b) => (a._o ?? Infinity) - (b._o ?? Infinity);

// the rows of an edge, in order: items are channel or supply objects
function edgeItems(edge) {
  const natural = (edge === 'top' ? supplies.concat(inputs, outputs) : outputs.concat(inputs, supplies)).filter(c => edgeOf(c) === edge);
  return natural.map((item, i) => ({ item, i })).sort((a, b) => byOrder(a.item, b.item) || a.i - b.i).map(x => x.item);
}
const renumber = (edge) => { edgeItems(edge).forEach((item, i) => { item._o = i; item._e = edge; }); };
const renumberAll = () => { renumber('top'); renumber('bottom'); };
// the order the pins run along the module: the top edge, then the bottom edge
const displayOrder = () => edgeItems('top').concat(edgeItems('bottom'));

function readModule() {
  renumberAll();
  const top = edgeItems('top'), bottom = edgeItems('bottom'), all = top.concat(bottom);
  const clean = (c) => { const o = { ...c }; delete o._o; delete o._e; delete o._sel; return o; };
  const letter = (c) => (supplies.includes(c) ? 's' : (inputs.includes(c) ? 'i' : 'o'));
  return {
    make: el('plcMake').value, model: el('plcModel').value, description: el('plcDescription').value,
    designator: el('plcDesignator').value, library: el('plcLibrary').value,
    inputs: all.filter(c => inputs.includes(c)).map(clean),
    outputs: all.filter(c => outputs.includes(c)).map(clean),
    supplies: all.filter(c => supplies.includes(c)).map(clean),
    topPattern: top.map(letter).join(''), bottomPattern: bottom.map(letter).join(''),
    inputPrefix: el('plcInPrefix').value, outputPrefix: el('plcOutPrefix').value,
    addressStyle: el('plcAddrStyle').value, addressStart: el('plcAddrStart').value,
    fnPlacement: el('plcFnPlacement').value,
    groups: groups.map(g => ({ ...g }))
  };
}

// ---- drag and drop ordering ----
// Every row has a grip on its left. Dragging a row onto another moves it to that place on
// its edge - supply rows and channel rows alike - and the pins follow the same order.

let drag = null;   // { item }

// Moves list[from] to sit just before (or after) list[to]. Returns whether anything moved.
export function moveRow(list, from, to, after = false) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  let at = to + (after ? 1 : 0);
  if (from < to) at -= 1;
  list.splice(at, 0, item);
  return at !== from;
}

// Puts an item on an edge, before (or after) another item there, or at the end.
function moveItem(item, edge, target = null, after = false) {
  const from = edgeOf(item);
  const list = edgeItems(edge).filter(c => c !== item);
  let at = list.length;
  if (target) { at = list.indexOf(target); if (at < 0) at = list.length; else if (after) at++; }
  list.splice(at, 0, item);
  list.forEach((c, i) => { c._o = i; c._e = edge; });
  if (from !== edge) renumber(from);
}

function makeSortable(row, item) {
  const grip = document.createElement('span');
  grip.className = 'plc-grip'; grip.textContent = '\u22EE\u22EE'; grip.title = 'Drag to reorder, or to the other edge';
  grip.draggable = true;
  grip.addEventListener('dragstart', (e) => {
    drag = { item };
    row.classList.add('plc-dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'plc-row'); try { e.dataTransfer.setDragImage(row, 10, 10); } catch (err) { /* ignore */ } }
  });
  grip.addEventListener('dragend', () => { drag = null; row.classList.remove('plc-dragging'); document.querySelectorAll('.plc-drop-above,.plc-drop-below,.plc-drop-end').forEach(r => r.classList.remove('plc-drop-above', 'plc-drop-below', 'plc-drop-end')); });
  row.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.classList.toggle('plc-drop-below', after); row.classList.toggle('plc-drop-above', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('plc-drop-above', 'plc-drop-below'));
  row.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    const after = row.classList.contains('plc-drop-below');
    row.classList.remove('plc-drop-above', 'plc-drop-below');
    if (drag.item !== item) moveItem(drag.item, edgeOf(item), item, after);
    drag = null;
    renderChannels();
  });
  row.insertBefore(grip, row.firstChild);
}

// ---- groups ----
// Tick any terminals and "Group ticked terminals" puts them under one name and description (X3, Encoder): they are
// moved together on their edge, and drawn in a frame with that title. Rows show the name of the group they are in.

function addGroupBits(row, item) {
  const box = document.createElement('input');
  box.type = 'checkbox'; box.className = 'grp-sel'; box.checked = !!item._sel; box.title = 'Tick to group this terminal with others';
  box.setAttribute('aria-label', 'Select this terminal');
  box.onchange = () => { item._sel = box.checked; };
  row.insertBefore(box, row.firstChild);
  const g = groups.find(x => x.id === item.group);
  if (g) {
    const badge = document.createElement('span');
    badge.className = 'grp-badge'; badge.textContent = g.name || '?'; badge.title = G.groupTitle(g) || 'Group';
    row.appendChild(badge);
  }
}

const everyItem = () => [...supplies, ...inputs, ...outputs];

function pruneGroups() {
  const used = new Set(everyItem().map(c => c.group).filter(Boolean));
  groups = groups.filter(g => used.has(g.id));
  everyItem().forEach(c => { if (c.group && !groups.some(g => g.id === c.group)) delete c.group; });
}

export function groupPlcSelected() {
  const picked = displayOrder().filter(c => c._sel);
  if (!picked.length) { setMessage('Tick the terminals to group first, using the boxes at the left of each row.', 'error'); return; }
  const edge = edgeOf(picked[0]);
  const rest = edgeItems(edge).filter(c => !picked.includes(c));
  const before = edgeItems(edge).slice(0, edgeItems(edge).indexOf(picked[0])).filter(c => !picked.includes(c)).length;
  const from = new Set(picked.map(edgeOf));
  rest.splice(before, 0, ...picked);                              // together, where the first of them was
  rest.forEach((c, i) => { c._o = i; c._e = edge; });
  from.forEach(e => { if (e !== edge) renumber(e); });
  const g = { id: G.nextGroupId(groups), name: G.nextGroupName(groups), description: '' };
  groups.push(g);
  picked.forEach(c => { c.group = g.id; c._sel = false; });
  pruneGroups();
  setMessage('');
  renderChannels();
  const nameInput = el('plcGroups').querySelector(`[data-group="${g.id}"] input`);
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

export function ungroupPlcSelected() {
  const picked = everyItem().filter(c => c._sel);
  if (!picked.length) { setMessage('Tick the terminals to take out of their group first.', 'error'); return; }
  picked.forEach(c => { delete c.group; c._sel = false; });
  pruneGroups();
  setMessage('');
  renderChannels();
}

function renderGroups() {
  const box = el('plcGroups');
  if (!box) return;
  pruneGroups();
  box.innerHTML = '';
  groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'plc-row'; row.dataset.group = g.id;
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'plc-addr'; name.value = g.name; name.maxLength = G.GROUP_LIMITS.name; name.placeholder = 'Name';
    name.setAttribute('aria-label', 'Group name');
    name.oninput = () => { g.name = name.value; refreshBadges(); updatePreview(); };
    const desc = document.createElement('input');
    desc.type = 'text'; desc.className = 'plc-fn'; desc.value = g.description; desc.maxLength = G.GROUP_LIMITS.description; desc.placeholder = 'Description, e.g. Encoder';
    desc.setAttribute('aria-label', 'Group description');
    desc.oninput = () => { g.description = desc.value; updatePreview(); };
    const count = document.createElement('span');
    count.className = 'grp-badge'; count.style.maxWidth = '90px'; count.textContent = `${everyItem().filter(c => c.group === g.id).length} terminals`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-icon'; remove.innerHTML = '&#10005;'; remove.title = 'Remove this group (the terminals stay)';
    remove.onclick = () => { everyItem().forEach(c => { if (c.group === g.id) delete c.group; }); renderChannels(); };
    row.appendChild(name); row.appendChild(desc); row.appendChild(count); row.appendChild(remove);
    box.appendChild(row);
  });
}

function refreshBadges() {
  renderEdge('plcTopList', 'top'); renderEdge('plcBottomList', 'bottom');
}

// ---- the rows ----

const rowOf = new Map();   // item -> its row, so a new row can be focused

function channelRow(ch, list, kind, n) {
  const row = document.createElement('div');
  row.className = 'plc-row';
  const label = kind === 'in' ? 'Input' : 'Output';
  const addr = document.createElement('input');
  addr.type = 'text'; addr.className = 'plc-addr'; addr.value = ch.address; addr.maxLength = PLC.PLC_LIMITS.address;
  addr.setAttribute('aria-label', `${label} ${n} address`);
  addr.oninput = () => { ch.address = addr.value; updatePreview(); };
  const typeSel = document.createElement('select');
  typeSel.className = 'plc-kind';
  typeSel.title = 'The type of connection (analogue and temperature leads are drawn with a small wave)';
  Object.entries(PLC.PLC_SIGNAL_TYPES).forEach(([v, d]) => { const o = document.createElement('option'); o.value = v; o.textContent = d.label; typeSel.appendChild(o); });
  typeSel.value = PLC.signalOf(ch.kind);
  typeSel.setAttribute('aria-label', `${label} ${n} type`);
  typeSel.onchange = () => { ch.kind = typeSel.value; updatePreview(); };
  const dirSel = document.createElement('select');   // is this terminal an input or an output of the module?
  dirSel.className = 'plc-kind plc-dir';
  dirSel.title = 'Whether this terminal is an input or an output';
  [['in', 'Input'], ['out', 'Output']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; dirSel.appendChild(o); });
  dirSel.value = kind;
  dirSel.setAttribute('aria-label', `${label} ${n} direction`);
  dirSel.onchange = () => {
    const to = dirSel.value === 'in' ? inputs : outputs;
    if (to === list) return;
    if (to.length >= PLC.PLC_MAX_CHANNELS) { dirSel.value = kind; setMessage(`A module can have at most ${PLC.PLC_MAX_CHANNELS} ${dirSel.value === 'in' ? 'inputs' : 'outputs'}.`, 'error'); return; }
    const e = edgeOf(ch), o = ch._o;
    list.splice(list.indexOf(ch), 1); to.push(ch);
    ch._e = e; ch._o = o;   // it stays where it is on the module
    syncCounts(); renderChannels();
  };
  const fn = document.createElement('input');
  fn.type = 'text'; fn.className = 'plc-fn'; fn.value = ch.fn; fn.maxLength = PLC.PLC_LIMITS.fn; fn.placeholder = 'Function';
  fn.setAttribute('list', 'plcFunctionList');
  fn.setAttribute('aria-label', `${label} ${n} function`);
  fn.oninput = () => { ch.fn = fn.value; updatePreview(); };
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'btn-icon'; remove.innerHTML = '&#10005;';
  remove.title = `Remove this ${kind === 'in' ? 'input' : 'output'}`;
  remove.onclick = () => { list.splice(list.indexOf(ch), 1); syncCounts(); renderChannels(); };
  row.appendChild(addr); row.appendChild(dirSel); row.appendChild(typeSel); row.appendChild(fn); addGroupBits(row, ch); row.appendChild(remove);
  makeSortable(row, ch);
  return row;
}

function supplyRow(sp, n) {
  const row = document.createElement('div');
  row.className = 'plc-row plc-row-supply';
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'plc-addr'; name.value = sp.name; name.maxLength = PLC.PLC_LIMITS.supplyName; name.placeholder = 'Name';
  name.setAttribute('aria-label', `Connection ${n} name`);
  name.oninput = () => { sp.name = name.value; updatePreview(); };
  const type = document.createElement('select');
  type.className = 'plc-kind plc-suptype';
  type.setAttribute('aria-label', `Connection ${n} type`);
  Object.entries(PLC.PLC_SUPPLY_TYPES).forEach(([v, def]) => { const o = document.createElement('option'); o.value = v; o.textContent = def.label; type.appendChild(o); });
  type.value = PLC.PLC_SUPPLY_TYPES[sp.type] ? sp.type : 'other';
  type.onchange = () => { sp.type = type.value; updatePreview(); };
  const value = document.createElement('input');
  value.type = 'text'; value.className = 'plc-fn'; value.value = sp.value; value.maxLength = PLC.PLC_LIMITS.supplyValue; value.placeholder = 'Voltage';
  value.setAttribute('aria-label', `Connection ${n} voltage`);
  value.oninput = () => { sp.value = value.value; updatePreview(); };
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'btn-icon'; remove.innerHTML = '&#10005;'; remove.title = 'Remove this connection';
  remove.onclick = () => { supplies.splice(supplies.indexOf(sp), 1); renderChannels(); };
  row.appendChild(name); row.appendChild(type); row.appendChild(value); addGroupBits(row, sp); row.appendChild(remove);
  makeSortable(row, sp);
  return row;
}

// A new supply joins the edge it was added to: after any supplies already leading the top edge,
// or at the end of the bottom edge.
function placeSupply(sp, edge) {
  sp._o = undefined; sp._e = edge;
  const list = edgeItems(edge).filter(c => c !== sp);
  let at = list.length;
  if (edge === 'top') { at = 0; while (at < list.length && supplies.includes(list[at])) at++; }
  list.splice(at, 0, sp);
  list.forEach((c, i) => { c._o = i; });
}

function wireEdgeDrop(box, edge) {
  if (box.dataset.dropWired === '1') return;
  box.dataset.dropWired = '1';
  box.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); box.classList.add('plc-drop-end'); });
  box.addEventListener('dragleave', (e) => { if (e.target === box) box.classList.remove('plc-drop-end'); });
  box.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault(); box.classList.remove('plc-drop-end');
    moveItem(drag.item, edge);
    drag = null;
    renderChannels();
  });
}

function renderEdge(containerId, edge) {
  const box = el(containerId);
  wireEdgeDrop(box, edge);
  box.innerHTML = '';
  rowOf.clear();
  const items = edgeItems(edge);
  items.forEach(item => {
    let row;
    if (supplies.includes(item)) row = supplyRow(item, supplies.indexOf(item) + 1);
    else if (inputs.includes(item)) row = channelRow(item, inputs, 'in', inputs.indexOf(item) + 1);
    else row = channelRow(item, outputs, 'out', outputs.indexOf(item) + 1);
    rowOf.set(item, row);
    box.appendChild(row);
  });
  if (!items.length) {
    const none = document.createElement('div');
    none.className = 'modal-hint';
    none.textContent = 'Nothing on this edge. Drag a row here, or add one below.';
    box.appendChild(none);
  }
}

function renderChannels() {
  renumberAll();
  renderEdge('plcTopList', 'top');
  renderEdge('plcBottomList', 'bottom');
  renderGroups();
  updatePreview();
}

// Adds a connection of that type to an edge, named so as not to clash with anything already on the module.
export function addPlcSupply(type, edge = null) {
  const def = PLC.PLC_SUPPLY_TYPES[type];
  if (!def || supplies.length >= PLC.PLC_MAX_SUPPLIES) return;
  const taken = [...inputs, ...outputs].map(c => c.address).concat(supplies.map(c => c.name));
  const name = def.name ? PLC.uniqueSupplyName(def.name, taken) : '';
  const sp = { name, type, value: def.value };
  supplies.push(sp);
  placeSupply(sp, edge || defaultEdge(sp));
  renderChannels();
  focusRow(sp);
}

// The "Add" menu under each edge: a supply, common, earth or other connection, or a custom
// input or output of your own.
export function addPlcItem(select, edge) {
  const value = select.value;
  select.value = '';
  const custom = /^custom-(in|out)-([a-z]+)$/.exec(value);
  if (custom) addPlcCustomChannel(custom[1], edge, custom[2]);
  else if (value) addPlcSupply(value, edge);
}

function focusRow(item) {
  const row = rowOf.get(item);
  if (row) { row.scrollIntoView({ block: 'nearest' }); row.querySelector('input').focus(); }
}

function syncCounts() { el('plcInCount').value = inputs.length; el('plcOutCount').value = outputs.length; }

// Adds one input or output of your own, with whatever name it needs (AI+, CAN H, Enable...).
// It joins the end of the edge it was added to, and can be dragged anywhere. A custom channel keeps its
// name when the others are auto-addressed.
export function addPlcCustomChannel(kind, edge = null, signal = 'digital') {
  const list = kind === 'in' ? inputs : outputs;
  if (list.length >= PLC.PLC_MAX_CHANNELS) { setMessage(`A module can have at most ${PLC.PLC_MAX_CHANNELS} ${kind === 'in' ? 'inputs' : 'outputs'}.`, 'error'); return; }
  const ch = { address: '', fn: '', kind: PLC.signalOf(signal), custom: true };
  list.push(ch);
  ch._e = edge || defaultEdge(ch); ch._o = edgeItems(ch._e).length;
  syncCounts();
  renderChannels();
  focusRow(ch);
}

function resize(list, count, prefix) {
  const n = Math.max(0, Math.min(PLC.PLC_MAX_CHANNELS, Math.floor(Number(count)) || 0));
  // fewer: the ones furthest along the edge go
  while (list.length > n) {
    const order = displayOrder();
    let last = 0;
    list.forEach((c, i) => { if (order.indexOf(c) > order.indexOf(list[last])) last = i; });
    list.splice(last, 1);
  }
  const fresh = PLC.autoAddresses(prefix, n, addressOptions());
  while (list.length < n) list.push({ address: fresh[list.length], fn: '' });
}

export function onPlcCountChange() {
  renumberAll();
  resize(inputs, el('plcInCount').value, el('plcInPrefix').value);
  resize(outputs, el('plcOutCount').value, el('plcOutPrefix').value);
  renderChannels();
}

// Gives every input and output a fresh address by the chosen scheme, in the order they sit.
export function autoAddressPlcChannels() {
  const options = addressOptions();
  const give = (list, prefix) => {
    const auto = displayOrder().filter(c => list.includes(c) && !c.custom);   // custom channels keep their own names
    PLC.autoAddresses(prefix, auto.length, options).forEach((a, i) => { auto[i].address = a; });
  };
  give(inputs, el('plcInPrefix').value);
  give(outputs, el('plcOutPrefix').value);
  renderChannels();
}

// ---- preview ----

function updatePreview() {
  const box = el('plcPreview');
  if (!box) return;
  const module = readModule();
  const normalised = PLC.normalisePlcModule(module);
  if (!normalised.inputs.length && !normalised.outputs.length) { box.textContent = ''; return; }
  const g = PLC.buildPlcModuleGeometry(normalised);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const pad = 14;
  const top = (g.top ?? 0) - pad, bottom = (g.bottom ?? g.height) + pad;
  svg.setAttribute('viewBox', `${-pad} ${top} ${g.width + 2 * pad} ${bottom - top}`);
  svg.setAttribute('style', `width:100%; max-height:260px; background:#fff; border-radius:4px;`);
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
    if (t.rotation) text.setAttribute('transform', `rotate(${t.rotation} ${t.relX} ${t.relY})`);
    text.setAttribute('font-size', t.fontSize * 0.5); text.setAttribute('font-family', 'sans-serif'); text.setAttribute('fill', '#0f172a');
    text.textContent = t.text;
    svg.appendChild(text);
  });
  box.textContent = '';
  box.appendChild(svg);
}

// ---- opening and closing ----

function libraryNames() {
  const names = new Set([PLC.PLC_DEFAULT_LIBRARY]);
  Object.values(window.customSymbolDefinitions || {}).forEach(sym => { if (sym && !sym.hidden && sym.library) names.add(sym.library); });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function fillStaticLists() {
  const fns = el('plcFunctionList');
  if (fns && !fns.options.length) PLC.PLC_FUNCTION_SUGGESTIONS.forEach(f => { const o = document.createElement('option'); o.value = f; fns.appendChild(o); });
  const libs = el('plcLibraryList');
  libs.innerHTML = '';
  libraryNames().forEach(n => { const o = document.createElement('option'); o.value = n; libs.appendChild(o); });
}

export async function openPlcModuleCreator(symKey = null) {
  if (isFreePlan()) { await appAlert('The PLC Module creator is a Pro feature, like creating any custom symbol.'); return; }
  const def = symKey ? window.customSymbolDefinitions?.[symKey] : null;
  editingKey = def && PLC.isPlcSymbol(def) ? symKey : null;
  const m = editingKey ? PLC.normalisePlcModule(def.plc) : null;

  fillStaticLists();
  el('plcMake').value = m ? m.make : '';
  el('plcModel').value = m ? m.model : '';
  el('plcDescription').value = m ? m.description : '';
  el('plcDesignator').value = m ? m.designator : PLC.PLC_DEFAULT_DESIGNATOR;
  el('plcLibrary').value = m && def.library ? def.library : PLC.PLC_DEFAULT_LIBRARY;
  el('plcInPrefix').value = m ? m.inputPrefix : 'I';
  el('plcOutPrefix').value = m ? m.outputPrefix : 'Q';
  el('plcAddrStyle').value = m ? m.addressStyle : 'bytebit';
  el('plcAddrStart').value = m ? m.addressStart : 0;
  el('plcFnPlacement').value = m ? m.fnPlacement : 'outside';   // a new module writes functions beside the pins; older ones keep them in the box
  inputs = m ? m.inputs.map(c => ({ ...c })) : [];
  outputs = m ? m.outputs.map(c => ({ ...c })) : [];
  groups = m ? m.groups.map(g => ({ ...g })) : [];
  supplies = m ? m.supplies.map(c => ({ ...c })) : PLC.defaultSupplies();   // a new module starts with a supply and its common
  if (!m) { resize(inputs, 8, 'I'); resize(outputs, 8, 'Q'); }
  else {
    // the order the pins sit along each edge
    const lists = { s: supplies, i: inputs, o: outputs };
    const layout = PLC.edgeLayout(m);
    ['top', 'bottom'].forEach(edge => layout[edge].forEach((ref, pos) => { const item = lists[ref.kind][ref.index]; item._o = pos; item._e = edge; }));
  }
  el('plcInCount').value = inputs.length;
  el('plcOutCount').value = outputs.length;

  el('plcTitle').textContent = editingKey ? 'Edit PLC Module' : 'PLC Module Creator';
  el('plcSaveBtn').textContent = editingKey ? 'Save changes' : 'Create module';
  el('plcEditNote').style.display = editingKey ? 'block' : 'none';
  setMessage('');
  renderChannels();
  wireKeyboardOnce();
  el('plcModal').style.display = 'flex';
  el(editingKey ? 'plcModel' : 'plcMake').focus();
}

export function closePlcModuleCreator() {
  const modal = el('plcModal');
  if (modal) modal.style.display = 'none';
  editingKey = null;
}

function wireKeyboardOnce() {
  const modal = el('plcModal');
  if (!modal || modal.dataset.keysWired === '1') return;
  modal.dataset.keysWired = '1';
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePlcModuleCreator(); } });
  ['plcFnPlacement', 'plcMake', 'plcModel', 'plcDescription', 'plcDesignator', 'plcLibrary', 'plcInPrefix', 'plcOutPrefix', 'plcAddrStart'].forEach(id => el(id).addEventListener('input', updatePreview));
}

// ---- making the symbol ----

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export async function savePlcModule(renderSymbolsListCallback, renderComponentsCallback) {
  if (isFreePlan()) return;
  const module = readModule();
  const check = PLC.validatePlcModule(module);
  if (!check.ok) {
    const first = check.errors.model || check.errors.designator || check.errors.make || check.errors.description || check.errors.channels || check.errors.library
      || check.errors.supplies || Object.entries(check.errors).find(([k]) => /^grp/.test(k))?.[1] || Object.entries(check.errors).find(([k]) => /^(in|out|sup)\d+$/.test(k))?.[1] || 'The module could not be made.';
    setMessage(first, 'error');
    const focus = check.errors.model ? 'plcModel' : (check.errors.designator ? 'plcDesignator' : null);
    if (focus) el(focus).focus();
    return;
  }

  const library = String(module.library ?? '').replace(/\s+/g, ' ').trim() || PLC.PLC_DEFAULT_LIBRARY;
  const definition = PLC.buildPlcSymbolDefinition(module, library);
  const defs = window.customSymbolDefinitions;

  // Two symbols with the same name in one library could not be told apart in the sidebar.
  const clash = Object.entries(defs).find(([key, sym]) => !sym.hidden && key !== editingKey && (sym.library || 'My Symbols') === library && sameName(sym.name, definition.name));
  if (clash) { setMessage(`"${library}" already has a symbol called "${definition.name}". Change the make or model, or choose another library.`, 'error'); return; }

  let symKey = editingKey;
  if (!symKey) {
    const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'module';
    symKey = `custom_plc_${slug}`;
    for (let n = 2; Object.prototype.hasOwnProperty.call(defs, symKey); n++) symKey = `custom_plc_${slug}_${n}`;
  }

  pushHistory();
  defs[symKey] = definition;
  if (renderSymbolsListCallback) renderSymbolsListCallback();
  if (renderComponentsCallback) renderComponentsCallback();
  scheduleAutosave();
  closePlcModuleCreator();
  await appAlert(`${definition.name} is in the "${library}" library in the sidebar. Drag it onto a sheet.`, 'PLC module ready');
}

window.openPlcModuleCreator = openPlcModuleCreator;
window.addPlcSupply = addPlcSupply;
window.addPlcItem = addPlcItem;
window.groupPlcSelected = groupPlcSelected;
window.ungroupPlcSelected = ungroupPlcSelected;
