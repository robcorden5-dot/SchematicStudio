// ==========================================
// 16. PLC MODULES
// ==========================================
// A PLC module is an ordinary custom symbol, drawn by this file instead of by hand:
// a label block on the left (model, make, description), a pin for every input (and
// supply) along the top and one for every output (and 0V / common) along the bottom. Each channel has an address (I0.0, Q0.3...)
// and a function (Hydraulic, Pneumatic...) which are drawn beside its pin. The
// designator is the symbol's prefix, so placed modules are numbered PLC1, PLC2...
//
// The module's own details are kept on the symbol as `plc`, so it can be opened and
// edited again; the drawing (pathData, pins, texts) is always rebuilt from them.
// This file is data and geometry only - the dialog is in 17_plc_module_creator.js.

import { normaliseGroups, groupProblems, groupTitle, titleBlockWidth, savedLabelW } from './37_terminal_groups.js';

export const PLC_MAX_CHANNELS = 64;
export const PLC_MAX_SUPPLIES = 16;
export const PLC_LIMITS = { make: 30, model: 40, description: 80, designator: 6, address: 12, fn: 20, library: 40, supplyName: 12, supplyValue: 20 };
export const PLC_DEFAULT_LIBRARY = 'PLC Modules';
export const PLC_DEFAULT_DESIGNATOR = 'PLC';


// Offered when giving a channel its function; any text is allowed too.
export const PLC_FUNCTION_SUGGESTIONS = [
  'Hydraulic', 'Pneumatic', 'Motor', 'Valve', 'Solenoid', 'Contactor', 'Sensor', 'Proximity', 'Limit switch',
  'Pushbutton', 'Selector', 'E-stop', 'Safety', 'Lamp', 'Alarm', 'Heater', 'Pump', 'Fan', 'Spare'
];

// ---- the type of an input or output ----
// Any channel can be given a type; it is shown in the I/O schedule, and an analogue or temperature lead is drawn with a small wave.
export const PLC_SIGNAL_TYPES = {
  digital:     { label: 'Digital',            wave: false },
  analogue:    { label: 'Analogue',           wave: true },
  relay:       { label: 'Relay',              wave: false },
  safety:      { label: 'Safety',             wave: false },
  highspeed:   { label: 'High-speed / pulse', wave: false },
  temperature: { label: 'Temperature (RTD/TC)', wave: true },
  comms:       { label: 'Communications',     wave: false },
  other:       { label: 'Other',              wave: false }
};
export const signalOf = (kind) => (PLC_SIGNAL_TYPES[kind] ? kind : 'digital');

// ---- supply, common and other connections ----
// The module's own power and reference connections, as opposed to its inputs and
// outputs: the supply voltage, the common, an analogue supply and common, protective
// earth. Supplies are drawn along the top of the box, commons and earth along the
// bottom, which is where they are usually wired from.

export const PLC_SUPPLY_TYPES = {
  supply:          { label: 'Supply (L+)',            side: 'top',    name: 'L+',  value: '24V DC' },
  output_supply:   { label: 'Output supply',          side: 'top',    name: '1L+', value: '24V DC' },
  sensor_supply:   { label: 'Sensor supply',          side: 'top',    name: 'SV+', value: '24V DC' },
  analogue_supply: { label: 'Analogue supply',        side: 'top',    name: 'AL+', value: '24V DC' },
  encoder_supply:  { label: 'Encoder supply',         side: 'top',    name: 'ENC+', value: '5V DC' },
  reference:       { label: '10V reference',          side: 'top',    name: '+10V', value: '10V DC' },
  dc_positive:     { label: 'DC positive',            side: 'top',    name: 'DC+', value: '24V DC' },
  ac_live:         { label: 'AC live (L)',            side: 'top',    name: 'L',   value: '230V AC' },
  common:          { label: 'Common (0V)',            side: 'bottom', name: 'M',   value: '0V' },
  sensor_common:   { label: 'Sensor common',          side: 'bottom', name: 'SM',  value: '0V' },
  analogue_common: { label: 'Analogue common',        side: 'bottom', name: 'AM',  value: '0V' },
  dc_negative:     { label: 'DC negative',            side: 'bottom', name: 'DC-', value: '0V' },
  ac_neutral:      { label: 'AC neutral (N)',         side: 'bottom', name: 'N',   value: '230V AC' },
  relay_common:    { label: 'Relay common',           side: 'bottom', name: 'COM', value: '' },
  pe:              { label: 'PE (earth)',             side: 'bottom', name: 'PE',  value: '' },
  functional_earth:{ label: 'Functional earth (FE)',  side: 'bottom', name: 'FE',  value: '' },
  shield:          { label: 'Shield',                 side: 'bottom', name: 'SH',  value: '' },
  other:           { label: 'Other connection',       side: 'top',    name: '',    value: '' }
};
export const supplySide = (type) => (PLC_SUPPLY_TYPES[type] || PLC_SUPPLY_TYPES.other).side;

// A name not already used by a connection: "L+", then "2L+", "3L+"...
export function uniqueSupplyName(base, taken) {
  const used = new Set(Array.from(taken, n => String(n).trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${n}${base}`.toLowerCase())) return `${n}${base}`;
}

// What a new module starts with: a supply and its common.
export const defaultSupplies = () => [
  { name: 'L+', type: 'supply', value: '24V DC' },
  { name: 'M', type: 'common', value: '0V' }
];

// ---- addresses ----

// 'bytebit': I0.0 ... I0.7, I1.0 ...   'sequential': I0, I1, I2 ...
export function autoAddress(prefix, index, { style = 'bytebit', start = 0 } = {}) {
  const first = Number.isInteger(Number(start)) && Number(start) >= 0 ? Number(start) : 0;
  const p = String(prefix ?? '').trim();
  if (style === 'sequential') return `${p}${first + index}`;
  return `${p}${first + Math.floor(index / 8)}.${index % 8}`;
}

export function autoAddresses(prefix, count, options) {
  return Array.from({ length: count }, (_, i) => autoAddress(prefix, i, options));
}

// ---- checking a module before it is made ----

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function validatePlcModule(m) {
  const errors = {};
  const model = clean(m.model);
  if (!model) errors.model = 'Give the module a model, e.g. 6ES7 521-1BL00-0AB0.';
  else if (model.length > PLC_LIMITS.model) errors.model = `The model is at most ${PLC_LIMITS.model} characters.`;
  if (clean(m.make).length > PLC_LIMITS.make) errors.make = `The make is at most ${PLC_LIMITS.make} characters.`;
  if (clean(m.description).length > PLC_LIMITS.description) errors.description = `The description is at most ${PLC_LIMITS.description} characters.`;
  const designator = clean(m.designator);
  if (!designator) errors.designator = 'Give a designator, e.g. PLC (modules are numbered PLC1, PLC2...).';
  else if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(designator)) errors.designator = `A designator is 1–${PLC_LIMITS.designator} letters or numbers, starting with a letter.`;

  const inputs = Array.isArray(m.inputs) ? m.inputs : [];
  const outputs = Array.isArray(m.outputs) ? m.outputs : [];
  if (inputs.length > PLC_MAX_CHANNELS || outputs.length > PLC_MAX_CHANNELS) errors.channels = `A module has at most ${PLC_MAX_CHANNELS} inputs and ${PLC_MAX_CHANNELS} outputs.`;
  else if (inputs.length + outputs.length === 0) errors.channels = 'A module needs at least one input or output.';

  const supplies = Array.isArray(m.supplies) ? m.supplies : [];
  if (supplies.length > PLC_MAX_SUPPLIES) errors.supplies = `A module has at most ${PLC_MAX_SUPPLIES} supply, common and other connections.`;
  const seen = new Map();
  const check = (list, kind) => list.forEach((ch, i) => {
    const key = `${kind}${i}`;
    const address = clean(ch.address);
    if (!address) errors[key] = `${kind === 'in' ? 'Input' : 'Output'} ${i + 1} needs an address.`;
    else if (address.length > PLC_LIMITS.address) errors[key] = `${kind === 'in' ? 'Input' : 'Output'} ${i + 1}: an address is at most ${PLC_LIMITS.address} characters.`;
    else if (seen.has(address.toLowerCase())) errors[key] = `The address ${address} is used twice. Every input and output needs its own.`;
    else seen.set(address.toLowerCase(), key);
    if (clean(ch.fn).length > PLC_LIMITS.fn) errors[key] = `${kind === 'in' ? 'Input' : 'Output'} ${i + 1}: a function is at most ${PLC_LIMITS.fn} characters.`;
  });
  check(inputs, 'in');
  check(outputs, 'out');
  supplies.forEach((sp, i) => {
    const key = `sup${i}`;
    const name = clean(sp.name);
    if (!name) errors[key] = `Connection ${i + 1} (${(PLC_SUPPLY_TYPES[sp.type] || PLC_SUPPLY_TYPES.other).label}) needs a name, e.g. ${(PLC_SUPPLY_TYPES[sp.type] || PLC_SUPPLY_TYPES.other).name || 'L+'}.`;
    else if (name.length > PLC_LIMITS.supplyName) errors[key] = `Connection ${i + 1}: a name is at most ${PLC_LIMITS.supplyName} characters.`;
    else if (seen.has(name.toLowerCase())) errors[key] = `The name ${name} is used twice. Every connection needs its own name.`;
    else seen.set(name.toLowerCase(), key);
    if (clean(sp.value).length > PLC_LIMITS.supplyValue) errors[key] = `Connection ${i + 1}: a voltage is at most ${PLC_LIMITS.supplyValue} characters.`;
    if (sp.type !== undefined && !PLC_SUPPLY_TYPES[sp.type]) errors[key] = `Connection ${i + 1} has an unknown type.`;
  });
  // groups: each needs a name, and its terminals must sit together on one edge
  const rawGroups = Array.isArray(m.groups) ? m.groups : [];
  if (rawGroups.length) {
    const layout = edgeLayout(m);
    const lists = ['top', 'bottom'].map(edge => layout[edge].map(ref => (ref.kind === 's' ? supplies : (ref.kind === 'i' ? inputs : outputs))[ref.index] || {}));
    const used = new Set([...supplies, ...inputs, ...outputs].map(c => c && c.group).filter(Boolean));
    Object.entries(groupProblems(rawGroups.filter(g => used.has(g.id)), lists)).forEach(([id, text]) => { errors[`grp${id}`] = text; });
  }
  const library = clean(m.library);
  if (library.length > PLC_LIMITS.library) errors.library = `A library name is at most ${PLC_LIMITS.library} characters.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

// The module as it is kept: trimmed, with channels reduced to address and function.
export function normalisePlcModule(m) {
  return withoutDanglingGroups(normalisePlcModuleRaw(m));
}

function normalisePlcModuleRaw(m) {
  const grp = (c, o) => { if (c.group) o.group = clean(c.group); return o; };
  const ch = (c) => { const o = { address: clean(c.address), fn: clean(c.fn), kind: signalOf(c.kind) }; if (c.custom) o.custom = true; return grp(c, o); };
  const sup = (c) => grp(c, { name: clean(c.name), type: PLC_SUPPLY_TYPES[c.type] ? c.type : 'other', value: clean(c.value) });
  const everyItem = [...(Array.isArray(m.supplies) ? m.supplies : []), ...(Array.isArray(m.inputs) ? m.inputs : []), ...(Array.isArray(m.outputs) ? m.outputs : [])].filter(Boolean);
  return {
    groups: normaliseGroups(m.groups, everyItem),
    make: clean(m.make), model: clean(m.model), description: clean(m.description),
    designator: clean(m.designator) || PLC_DEFAULT_DESIGNATOR,
    supplies: (Array.isArray(m.supplies) ? m.supplies : []).map(c => sup(c || {})),
    inputs: (Array.isArray(m.inputs) ? m.inputs : []).map(c => ch(c || {})), outputs: (Array.isArray(m.outputs) ? m.outputs : []).map(c => ch(c || {})),
    inputPrefix: clean(m.inputPrefix ?? 'I'), outputPrefix: clean(m.outputPrefix ?? 'Q'),
    fnPlacement: m.fnPlacement === 'outside' ? 'outside' : 'inside',   // where a channel's function is written: in the box, or outside beside its pin
    topPattern: String(m.topPattern ?? '').replace(/[^sio]/g, ''), bottomPattern: String(m.bottomPattern ?? '').replace(/[^sio]/g, ''),
    addressStyle: m.addressStyle === 'sequential' ? 'sequential' : 'bytebit',
    addressStart: Number.isInteger(Number(m.addressStart)) && Number(m.addressStart) >= 0 ? Number(m.addressStart) : 0
  };
}

// the same module with any group reference that points at no group removed
function withoutDanglingGroups(m) {
  const ids = new Set(m.groups.map(g => g.id));
  const fix = (c) => { if (c.group && !ids.has(c.group)) { const o = { ...c }; delete o.group; return o; } return c; };
  return { ...m, supplies: m.supplies.map(fix), inputs: m.inputs.map(fix), outputs: m.outputs.map(fix) };
}

// ---- drawing ----
// Everything sits on the 20-unit grid so wires snap cleanly. See buildTopBottomGeometry.

const GRID = 20;
const FONT_BODY = 16, FONT_HEAD = 18, FONT_SUB = 14;   // halved when drawn (the symbol text convention)
const CHAR_RATIO = 0.6;       // average character width as a share of the drawn font size (a little generous, so text never runs past the box)
const rendered = (f) => f * 0.5;
const textWidth = (text, f) => String(text).length * rendered(f) * CHAR_RATIO;
const ceilGrid = (n) => Math.ceil(n / GRID) * GRID;
const ellipsis = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Which pins sit on which edge, and in what order. A module keeps a pattern for each edge
// saying which kind of pin comes next - s (supply, common, earth), i (input) or o (output) -
// and each kind is taken in its own order, so any pin can be on either edge. A module with no
// patterns, or whatever they don't cover, falls back to the usual arrangement: supplies and
// inputs along the top, outputs and 0V / common / earth along the bottom.
// Returns { top, bottom }, lists of { kind: 's'|'i'|'o', index } into supplies, inputs, outputs.
export function edgeLayout(module) {
  const m = normalisePlcModule(module);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const queues = { s: range(m.supplies.length), i: range(m.inputs.length), o: range(m.outputs.length) };
  const out = { top: [], bottom: [] };
  [['top', m.topPattern], ['bottom', m.bottomPattern]].forEach(([edge, pattern]) => {
    for (const kind of pattern) if (queues[kind].length) out[edge].push({ kind, index: queues[kind].shift() });
  });
  const supplyOn = (edge) => queues.s.filter(index => (supplySide(m.supplies[index].type) === 'top') === (edge === 'top'));
  supplyOn('top').forEach(index => out.top.push({ kind: 's', index }));
  queues.i.forEach(index => out.top.push({ kind: 'i', index }));
  queues.o.forEach(index => out.bottom.push({ kind: 'o', index }));
  supplyOn('bottom').forEach(index => out.bottom.push({ kind: 's', index }));
  return out;
}

export function buildPlcModuleGeometry(module) {
  return buildTopBottomGeometry(normalisePlcModule(module));
}

// Inputs along the top and outputs along the bottom, so a label block (model, make,
// description) can fill the left. Inputs, outputs and supply connections can sit on either edge, wherever the module puts them (edgeLayout). Pins run vertically, so each is labelled beneath (or above) it in two
// lines: the address or name, then the function or voltage.
function buildTopBottomGeometry(m, opts = {}) {
  const round = (n) => Math.round(n * 10) / 10;
  const line = (c, isSupply) => isSupply ? [c.name, c.value] : [c.address, c.fn];
  const item = (c, isSupply) => {
    const [a, b] = line(c, isSupply);
    // the pitch is a multiple of 40 so the pin, in the middle, stays on the 20 grid
    const pitch = Math.max(40, Math.ceil((textWidth(a, FONT_BODY) + 8) / 40) * 40);
    const outside = !isSupply && m.fnPlacement === 'outside';
    return { c, isSupply, a, b, pitch, outside, groupId: c.group || null, bLen: b && !outside ? textWidth(b, FONT_BODY) : 0, outLen: b && outside ? textWidth(b, FONT_BODY) : 0 };
  };
  const layout = edgeLayout(m);
  const itemFor = (ref) => (ref.kind === 's' ? item(m.supplies[ref.index], true) : item((ref.kind === 'i' ? m.inputs : m.outputs)[ref.index], false));
  const topItems = layout.top.map(itemFor), bottomItems = layout.bottom.map(itemFor);
  // A placed module keeps the box of its library symbol, so its pins (and any wire on them) stay put;
  // a function too long for that box is shortened on the drawing (it is kept in full).
  if (opts.height) {
    const lh = rendered(FONT_BODY), both = topItems.length && bottomItems.length;
    const room = both ? (opts.height - 6 - 2 * (6 + lh)) / 2 : opts.height - 6 - (6 + lh);
    const chars = Math.max(1, Math.floor(room / (rendered(FONT_BODY) * CHAR_RATIO)));
    [...topItems, ...bottomItems].forEach(it => { if (it.b && !it.isSupply && !it.outside) { it.b = ellipsis(it.b, chars); it.bLen = textWidth(it.b, FONT_BODY); } });
  }
  const total = (list) => list.reduce((n, it) => n + it.pitch, 0);

  const headLines = [
    { text: m.model, font: FONT_HEAD },
    { text: m.make, font: FONT_SUB },
    { text: ellipsis(m.description, 44), font: FONT_SUB }
  ].filter(l => l.text);
  const headTextH = headLines.reduce((n, l) => n + rendered(l.font) + 3, 0);
  const labelW = opts.labelW || titleBlockWidth(Math.max(0, ...headLines.map(l => textWidth(l.text, l.font))), headTextH);
  const bodyW = Math.max(120, total(topItems), total(bottomItems));
  // The address runs across the pin; the function (or voltage) runs up the box beside it, in line
  // with the pin. Top and bottom ones can stand in the same column, so the box is tall enough for both.
  const lineH = rendered(FONT_BODY);
  // a group's name and description are written in a band under (or over) its terminals' addresses
  const BAND = lineH + 6;
  const bandOf = (it) => (it.groupId ? BAND : 0);
  const reach = (list) => (list.length ? 3 + lineH + 3 + Math.max(0, ...list.map(bandOf)) + Math.max(0, ...list.map(it => it.bLen)) : 0);
  const H = opts.height || Math.max(60, ceilGrid(headTextH + 8), ceilGrid(reach(topItems) + reach(bottomItems) + 6));
  const right = labelW + bodyW;

  const pathSegments = [
    { d: `M 0 0 L ${right} 0 L ${right} ${H} L 0 ${H} Z`, dash: 'solid' },
    { d: `M ${labelW} 0 L ${labelW} ${H}`, dash: 'solid' }
  ];
  const pins = [], texts = [];

  let y = Math.max(4, round((H - headTextH) / 2));
  headLines.forEach(l => {
    texts.push({ text: l.text, relX: round((labelW - textWidth(l.text, l.font)) / 2), relY: y, fontSize: l.font, head: true });
    y += rendered(l.font) + 3;
  });

  const centred = (t) => round(-textWidth(t, FONT_BODY) / 2);
  const wave = (x, y0) => ({ d: `M ${x} ${y0} q 4 3 0 6 t 0 6`, dash: 'solid' });
  const place = (list, edge) => {
    let x = labelW;
    list.forEach(it => {
      it.left = x; it.right = x + it.pitch;
      const px = x + it.pitch / 2, c = it.c;
      const pinY = edge === 'top' ? -GRID : H + GRID;
      pathSegments.push({ d: `M ${px} ${edge === 'top' ? -GRID : H} L ${px} ${edge === 'top' ? 0 : H + GRID}`, dash: 'solid' });
      if (it.isSupply) pins.push({ id: c.name, name: c.name, type: c.type, value: c.value, relX: px, relY: pinY, rotation: 90 });
      else {
        pins.push({ id: c.address, name: c.address, function: c.fn, signal: c.kind, relX: px, relY: pinY, rotation: 90 });
        if (PLC_SIGNAL_TYPES[c.kind] && PLC_SIGNAL_TYPES[c.kind].wave) pathSegments.push(edge === 'top' ? wave(px, -GRID + 4) : wave(px, H + 4));
      }
      // the address, across the pin, at the box edge; the function, turned to run up the box
      const ay = edge === 'top' ? 3 : H - 3 - lineH;
      texts.push({ text: it.a, relX: round(px + centred(it.a)), relY: round(ay), fontSize: FONT_BODY });
      if (it.b && it.outside) {
        // outside the box, beside the pin's lead and to the left of it, reading upward
        const endY = edge === 'top' ? -3 : H + 3 + it.outLen;
        texts.push({ text: it.b, relX: round(px - 3 - lineH), relY: round(endY), fontSize: FONT_BODY, rotation: -90 });
      } else if (it.b) {
        // rotated -90, a text starts at its bottom end and reads upward, its glyphs to the right of that line
        const bottomEnd = edge === 'top' ? 3 + lineH + 3 + bandOf(it) + it.bLen : H - 3 - lineH - 3 - bandOf(it);
        texts.push({ text: it.b, relX: round(px - lineH / 2), relY: round(bottomEnd), fontSize: FONT_BODY, rotation: -90 });
      }
      x += it.pitch;
    });
  };
  place(topItems, 'top');
  place(bottomItems, 'bottom');
  // a frame round each run of grouped terminals, with the group's name and description in it
  const titles = new Map(m.groups.map(g => [g.id, groupTitle(g)]));
  const frame = (list, edge) => {
    for (let i = 0; i < list.length;) {
      const id = list[i].groupId;
      let j = i; while (j < list.length && list[j].groupId === id) j++;
      if (id) {
        const x1 = list[i].left + 2, x2 = list[j - 1].right - 2, d = 3 + lineH + 3 + BAND;
        pathSegments.push({ d: edge === 'top' ? `M ${x1} 0 L ${x1} ${d} L ${x2} ${d} L ${x2} 0` : `M ${x1} ${H} L ${x1} ${H - d} L ${x2} ${H - d} L ${x2} ${H}`, dash: 'solid' });
        const chars = Math.max(1, Math.floor((x2 - x1 - 6) / (rendered(FONT_SUB) * CHAR_RATIO)));
        const title = ellipsis(titles.get(id) || '', chars);
        if (title) texts.push({ text: title, relX: round(x1 + 3), relY: round(edge === 'top' ? 3 + lineH + 3 + 3 : H - d + 3), fontSize: FONT_SUB });
      }
      i = j;
    }
  };
  frame(topItems, 'top');
  frame(bottomItems, 'bottom');
  return { pathSegments, pins, texts, width: right, height: H, top: topItems.length ? -GRID : 0, bottom: bottomItems.length ? H + GRID : H };
}

// ---- the symbol ----

export function buildPlcSymbolDefinition(module, library) {
  const m = normalisePlcModule(module);
  const geometry = buildPlcModuleGeometry(m);
  const name = [m.make, m.model].filter(Boolean).join(' ');
  const definition = {
    name,
    prefix: m.designator,
    value: ' ',   // a lone space: the header already names the module, and '' would show the word CUSTOM
    make: m.make, modelNo: m.model, description: m.description,
    pathData: geometry.pathSegments, pins: geometry.pins, texts: geometry.texts,
    plc: m
  };
  const lib = clean(library);
  if (lib) definition.library = lib;
  return definition;
}

// ---- functions of one placed module ----
// A library module carries default functions; each module placed on a sheet can have its own, kept
// on the component as plcFns { address: function }. Only the functions are different, so the
// drawing is the library module's with its function texts replaced.

// Every input and output of a module: [{ address, fn, kind, side }]
export function plcChannels(def) {
  const m = def && def.plc ? normalisePlcModule(def.plc) : null;
  if (!m) return [];
  return [...m.inputs.map(c => ({ ...c, side: 'in' })), ...m.outputs.map(c => ({ ...c, side: 'out' }))];
}

// The function a placed module gives one address: its own, else the library's.
export function plcFunctionFor(comp, address, libraryFn = '') {
  const own = comp && comp.plcFns && Object.prototype.hasOwnProperty.call(comp.plcFns, address) ? comp.plcFns[address] : undefined;
  return own !== undefined ? own : libraryFn;
}

// Keeps only functions that differ from the library's, trimmed and limited in length.
export function cleanPlcFns(def, fns) {
  const out = {};
  plcChannels(def).forEach(c => {
    if (!fns || !Object.prototype.hasOwnProperty.call(fns, c.address)) return;
    const v = clean(fns[c.address]).slice(0, PLC_LIMITS.fn);
    if (v !== c.fn) out[c.address] = v;
  });
  return out;
}

// The texts for a placed module with its own functions. Null when it has none (use the library's).
export function plcInstanceTexts(def, fns) {
  if (!def || !def.plc || !fns || !Object.keys(fns).length) return null;
  const base = normalisePlcModule(def.plc);
  const height = buildTopBottomGeometry(base).height;
  const own = (c) => ({ ...c, fn: plcFunctionFor({ plcFns: fns }, c.address, c.fn) });
  return buildTopBottomGeometry({ ...base, inputs: base.inputs.map(own), outputs: base.outputs.map(own) }, { height, labelW: savedLabelW(def) || undefined }).texts;
}

export const isPlcSymbol = (def) => !!def && typeof def === 'object' && !!def.plc;

// Wires and terminals refer to a pin by its id, so changing an address while
// editing a module would orphan nothing here, but a duplicate would be ambiguous -
// validatePlcModule keeps them unique. A summary of what a module offers, by function:
export function summarisePlcFunctions(module) {
  const m = normalisePlcModule(module);
  const supplies = m.supplies.map(c => ({ name: c.name, type: c.type, value: c.value }));
  const count = (list) => list.reduce((acc, c) => { const k = c.fn || 'Unassigned'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return { inputs: count(m.inputs), outputs: count(m.outputs), supplies };
}

// ---- wires ----

// The PLC inputs and outputs a wire is connected to: those of its two ends that sit exactly
// on the pin of a PLC module. Returns [{ designator, address, fn, signal }], each with the
// module's own reference on the sheet (PLC1), the pin's address (I0.3) and its function.
export function wirePlcConnections(wire, components, definitions) {
  const pts = wire && wire.points;
  if (!Array.isArray(pts) || pts.length < 4) return [];
  const ends = [[pts[0], pts[1]], [pts[pts.length - 2], pts[pts.length - 1]]];
  const found = [];
  (components || []).forEach(comp => {
    const def = definitions && definitions[comp.type];
    if (!def || !def.plc || !Array.isArray(def.pins)) return;
    const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    def.pins.forEach(pin => {
      if (!PLC_SIGNAL_TYPES[pin.signal]) return;   // a supply or common, not an input or output (a supply pin also carries a type)
      if (pin.type) return;
      const fx = comp.flipX ? -1 : 1, fy = comp.flipY ? -1 : 1;
      const x = comp.x + (fx * pin.relX * cos - fy * pin.relY * sin), y = comp.y + (fx * pin.relX * sin + fy * pin.relY * cos);
      if (ends.some(([ex, ey]) => Math.abs(ex - x) < 0.5 && Math.abs(ey - y) < 0.5)) {
        found.push({ designator: comp.label || def.prefix || '', address: pin.name || pin.id || '', fn: plcFunctionFor(comp, pin.name || pin.id || '', pin.function || ''), signal: pin.signal });
      }
    });
  });
  return found;
}

// How one of those connections reads on a wire: "PLC1 I0.3 · Hydraulic".
export const describePlcConnection = (c) => [c.designator, c.address].filter(Boolean).join(' ') + (c.fn ? ` \u00B7 ${c.fn}` : '');
