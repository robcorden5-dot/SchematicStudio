// ==========================================
// 35. DRIVE MODULES
// ==========================================
// A drive (variable speed drive / inverter / soft starter) is an ordinary custom symbol, drawn by this
// file instead of by hand: a label block on the left (model, make, description, rating), the power
// supply terminals along the top (L1 L2 L3 PE), the motor terminals along the bottom (U V W PE) and
// the control terminals down the right edge (24V, DI1, AI1, RO1...), each with a name and, for control
// terminals, a function (Start, Speed reference, Fault...). The designator is the symbol's prefix, so
// placed drives are numbered VFD1, VFD2...
//
// The drive's own details are kept on the symbol as `drive`, so it can be opened and edited again; the
// drawing (pathData, pins, texts) is always rebuilt from them. Data and geometry only - the dialog is
// in 36_drive_creator.js.

import { normaliseGroups, groupProblems, groupTitle, titleBlockWidth, savedLabelW } from './37_terminal_groups.js';

export const DRIVE_MAX_POWER = 12;
export const DRIVE_MAX_CONTROL = 40;
export const DRIVE_LIMITS = { make: 30, model: 40, description: 80, rating: 30, designator: 6, name: 12, fn: 20, library: 40 };
export const DRIVE_DEFAULT_LIBRARY = 'Drives';
export const DRIVE_DEFAULT_DESIGNATOR = 'VFD';

// Offered when giving a control terminal its function; any text is allowed too.
export const DRIVE_FUNCTION_SUGGESTIONS = [
  'Start', 'Stop', 'Run forward', 'Run reverse', 'Reset', 'Jog', 'Speed ref', 'Speed feedback', 'Torque ref', 'Motor current',
  'Fault', 'Running', 'Ready', 'At speed', 'Brake', 'E-stop', 'Safe torque off', 'Thermistor', 'Enable', 'Spare'
];

// The kinds of control terminal. `prefix` names new ones (DI1, DI2...); `wave` draws an analogue lead.
export const DRIVE_CONTROL_TYPES = {
  di:     { label: 'Digital input',   prefix: 'DI', wave: false },
  do:     { label: 'Digital output',  prefix: 'DO', wave: false },
  ai:     { label: 'Analogue input',  prefix: 'AI', wave: true },
  ao:     { label: 'Analogue output', prefix: 'AO', wave: true },
  relay:  { label: 'Relay output',    prefix: 'RO', wave: false },
  supply: { label: 'Supply',          prefix: '24V', single: true },
  common: { label: 'Common',          prefix: '0V', single: true },
  safety: { label: 'Safe torque off', prefix: 'STO' },
  comms:  { label: 'Communications',  prefix: 'COM' },
  other:  { label: 'Other',           prefix: '' }
};

// Terminals added in one go from the "+ Add" menus: name(s) and the kind of terminal each is.
export const DRIVE_POWER_PRESETS = {
  three:  { label: '3-phase supply (L1 L2 L3)', edge: 'top',    names: ['L1', 'L2', 'L3'], kind: 'power' },
  single: { label: '1-phase supply (L N)',       edge: 'top',    names: ['L', 'N'], kind: 'power' },
  dcin:   { label: 'DC supply (DC+ DC-)',        edge: 'top',    names: ['DC+', 'DC-'], kind: 'dc' },
  motor:  { label: 'Motor (U V W)',              edge: 'bottom', names: ['U', 'V', 'W'], kind: 'motor' },
  brake:  { label: 'Brake resistor (BR+ BR-)',   edge: 'bottom', names: ['BR+', 'BR-'], kind: 'brake' },
  dcbus:  { label: 'DC bus (DC+ DC-)',           edge: 'bottom', names: ['DC+', 'DC-'], kind: 'dc' },
  pe:     { label: 'PE (earth)',                 edge: 'both',   names: ['PE'], kind: 'pe' },
  other:  { label: 'Other terminal',             edge: 'both',   names: [''], kind: 'other' }
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// A name not already used by a terminal: "PE", then "2PE", "3PE"... (the same rule a PLC module uses)
export function uniqueDriveName(base, taken) {
  const used = new Set(Array.from(taken, n => String(n).trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${n}${base}`.toLowerCase())) return `${n}${base}`;
}

// The next free name for a control terminal of that type: DI1, DI2... A single-use type (24V, 0V) is just its name, then 2x24V...
export function nextControlName(type, taken) {
  const def = DRIVE_CONTROL_TYPES[type] || DRIVE_CONTROL_TYPES.other;
  if (!def.prefix) return '';
  if (def.single) return uniqueDriveName(def.prefix, taken);
  const used = new Set(Array.from(taken, n => String(n).trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`${def.prefix}${n}`.toLowerCase())) return `${def.prefix}${n}`;
}

// What a new drive starts with.
export const defaultDrive = () => ({
  layout: 'block',
  make: '', model: '', description: '', rating: '', designator: DRIVE_DEFAULT_DESIGNATOR,
  top: ['L1', 'L2', 'L3', 'PE'].map(name => ({ name, kind: name === 'PE' ? 'pe' : 'power' })),
  bottom: ['U', 'V', 'W', 'PE'].map(name => ({ name, kind: name === 'PE' ? 'pe' : 'motor' })),
  control: [
    { name: '24V', kind: 'supply', fn: '' },
    { name: 'DI1', kind: 'di', fn: 'Start' }, { name: 'DI2', kind: 'di', fn: 'Stop' }, { name: 'DI3', kind: 'di', fn: 'Reset' },
    { name: 'AI1', kind: 'ai', fn: 'Speed ref' }, { name: '0V', kind: 'common', fn: '' },
    { name: 'RO1', kind: 'relay', fn: 'Fault' }
  ].map(t => ({ ...t, side: defaultSide(t.kind) }))
});

// Block layout: which side of the box a control terminal is drawn on. Outputs (relay, digital and analogue out) and communications go on the right.
export const defaultSide = (kind) => (['relay', 'do', 'comms'].includes(kind) ? 'right' : 'left');

// ---- checking a drive before it is made ----

export function validateDrive(m) {
  const errors = {};
  const model = clean(m.model);
  if (!model) errors.model = 'Give the drive a model, e.g. ATV320U55N4B.';
  else if (model.length > DRIVE_LIMITS.model) errors.model = `The model is at most ${DRIVE_LIMITS.model} characters.`;
  if (clean(m.make).length > DRIVE_LIMITS.make) errors.make = `The make is at most ${DRIVE_LIMITS.make} characters.`;
  if (clean(m.description).length > DRIVE_LIMITS.description) errors.description = `The description is at most ${DRIVE_LIMITS.description} characters.`;
  if (clean(m.rating).length > DRIVE_LIMITS.rating) errors.rating = `The rating is at most ${DRIVE_LIMITS.rating} characters.`;
  const designator = clean(m.designator);
  if (!designator) errors.designator = 'Give a designator, e.g. VFD (drives are numbered VFD1, VFD2...).';
  else if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(designator)) errors.designator = `A designator is 1–${DRIVE_LIMITS.designator} letters or numbers, starting with a letter.`;
  const library = clean(m.library);
  if (library.length > DRIVE_LIMITS.library) errors.library = `A library name is at most ${DRIVE_LIMITS.library} characters.`;

  const top = Array.isArray(m.top) ? m.top : [], bottom = Array.isArray(m.bottom) ? m.bottom : [], control = Array.isArray(m.control) ? m.control : [];
  if (top.length + bottom.length > DRIVE_MAX_POWER * 2 || top.length > DRIVE_MAX_POWER || bottom.length > DRIVE_MAX_POWER) errors.power = `Each of the top and bottom edges has at most ${DRIVE_MAX_POWER} terminals.`;
  if (control.length > DRIVE_MAX_CONTROL) errors.control = `A drive has at most ${DRIVE_MAX_CONTROL} control terminals.`;
  if (top.length + bottom.length + control.length === 0) errors.power = 'A drive needs at least one terminal.';

  // A name is used once on an edge. The supply and the motor can each have a PE: the second is told apart inside the symbol.
  const check = (list, kind, label) => { const seen = new Map(); list.forEach((t, i) => {
    const key = `${kind}${i}`, name = clean(t.name);
    if (!name) errors[key] = `${label} terminal ${i + 1} needs a name.`;
    else if (name.length > DRIVE_LIMITS.name) errors[key] = `${label} terminal ${i + 1}: a name is at most ${DRIVE_LIMITS.name} characters.`;
    else if (seen.has(name.toLowerCase())) errors[key] = `The name ${name} is used twice on this edge. Every terminal needs its own (a second PE can be PE2).`;
    else seen.set(name.toLowerCase(), key);
    if (clean(t.fn).length > DRIVE_LIMITS.fn) errors[key] = `${label} terminal ${i + 1}: a function is at most ${DRIVE_LIMITS.fn} characters.`;
    if (kind === 'ctl' && t.kind !== undefined && !DRIVE_CONTROL_TYPES[t.kind]) errors[key] = `${label} terminal ${i + 1} has an unknown type.`;
  }); };
  check(top, 'top', 'Supply'); check(bottom, 'bot', 'Motor');
  check(control, 'ctl', 'Control');
  // control terminals share the symbol with the power ones: a name must not repeat across control and power either, except PE
  const powerNames = new Set([...top, ...bottom].map(t => clean(t.name).toLowerCase()));
  control.forEach((t, i) => { const n = clean(t.name).toLowerCase(); if (n && powerNames.has(n) && !errors[`ctl${i}`]) errors[`ctl${i}`] = `Control terminal ${i + 1}: the name ${clean(t.name)} is already a supply or motor terminal.`; });
  const rawGroups = Array.isArray(m.groups) ? m.groups : [];
  if (rawGroups.length) {
    const used = new Set([...top, ...bottom, ...control].map(t => t && t.group).filter(Boolean));
    Object.entries(groupProblems(rawGroups.filter(g => used.has(g.id)), [top, bottom, control])).forEach(([id, text]) => { errors[`grp${id}`] = text; });
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// The drive as it is kept: trimmed, every terminal reduced to what the drawing needs.
export function normaliseDrive(m) {
  const grp = (t, o) => { if (t && t.group) o.group = clean(t.group); return o; };
  const power = (t) => grp(t, { name: clean(t && t.name), kind: ['power', 'motor', 'pe', 'dc', 'brake', 'other'].includes(t && t.kind) ? t.kind : 'other' });
  const block = m.layout === 'block';
  const ctl = (t) => { const o = grp(t, { name: clean(t && t.name), kind: DRIVE_CONTROL_TYPES[t && t.kind] ? t.kind : 'other', fn: clean(t && t.fn) }); if (block) o.side = (t && t.side) === 'right' ? 'right' : (t && t.side) === 'left' ? 'left' : defaultSide(o.kind); return o; };
  const every = [...(Array.isArray(m.top) ? m.top : []), ...(Array.isArray(m.bottom) ? m.bottom : []), ...(Array.isArray(m.control) ? m.control : [])].filter(Boolean);
  const groups = normaliseGroups(m.groups, every);
  const ids = new Set(groups.map(g => g.id));
  const keep = (o) => { if (o.group && !ids.has(o.group)) delete o.group; return o; };
  return {
    layout: block ? 'block' : 'classic',
    groups,
    make: clean(m.make), model: clean(m.model), description: clean(m.description), rating: clean(m.rating),
    designator: clean(m.designator) || DRIVE_DEFAULT_DESIGNATOR,
    top: (Array.isArray(m.top) ? m.top : []).map(power).map(keep), bottom: (Array.isArray(m.bottom) ? m.bottom : []).map(power).map(keep),
    control: (Array.isArray(m.control) ? m.control : []).map(ctl).map(keep)
  };
}

// ---- drawing ----
// Everything sits on the 20-unit grid so wires snap cleanly.

const GRID = 20;
const FONT_BODY = 16, FONT_HEAD = 18, FONT_SUB = 14;   // halved when drawn (the symbol text convention)
const CHAR_RATIO = 0.6;
const rendered = (f) => f * 0.5;
const textWidth = (text, f) => String(text).length * rendered(f) * CHAR_RATIO;
const ceilGrid = (n) => Math.ceil(n / GRID) * GRID;
const ellipsis = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const round = (n) => Math.round(n * 10) / 10;

// `sizeFrom` is the library drive a placed one is drawn on: the box keeps that drive's size, and a longer function is shortened to fit.
export function buildDriveGeometry(module, sizeFrom = null, fixedLabelW = null) {
  const m = normaliseDrive(module);
  const z = sizeFrom ? normaliseDrive(sizeFrom) : m;
  const lineH = rendered(FONT_BODY);
  // Pins sit 20 apart along an edge. A name too wide for 20 (four characters or more) is written in a smaller font so it fits
  // without touching its neighbours; only a name too long even at the smallest size widens the spacing of the whole edge.
  const MIN_NAME_FONT = 8;
  const nameFont = (t) => Math.max(MIN_NAME_FONT, Math.min(FONT_BODY, Math.floor(16 / (String(t.name).length * 0.3 || 1))));
  // the terminals of one group are written in one size: the smallest any of them needs
  const fontsFor = (list) => {
    const fonts = list.map(nameFont);
    for (let i = 0; i < list.length;) {
      const id = list[i].group || null;
      let j = i; while (j < list.length && (list[j].group || null) === id) j++;
      if (id) { const f = Math.min(...fonts.slice(i, j)); for (let k = i; k < j; k++) fonts[k] = f; }
      i = j;
    }
    return fonts;
  };
  const layoutEdge = (list) => {
    const fonts = fontsFor(list);
    const widest = Math.max(0, ...list.map((t, i) => textWidth(t.name, fonts[i])));
    const pitch = Math.max(20, Math.ceil((widest + 4) / 20) * 20);
    // 40 between a group and the connection before or after it (or the next group)
    let x = 20;
    return list.map((t, i) => {
      if (i > 0) x += ((list[i - 1].group || null) !== (t.group || null)) ? Math.max(pitch, 40) : pitch;
      return x;
    });
  };
  const topXs = layoutEdge(z.top), bottomXs = layoutEdge(z.bottom);
  const edgeW = (xs) => (xs.length ? xs[xs.length - 1] + 20 : 0);
  if (m.layout === 'block') return buildBlockGeometry({ m, z, lineH, fontsFor, topXs, bottomXs, edgeW, sizeFrom });

  const headLines = [
    { text: z.model, font: FONT_HEAD }, { text: z.make, font: FONT_SUB },
    { text: ellipsis(z.description, 44), font: FONT_SUB }, { text: z.rating, font: FONT_SUB }
  ].filter(l => l.text);
  const headTextH = headLines.reduce((n, l) => n + rendered(l.font) + 3, 0);
  const labelW = fixedLabelW || titleBlockWidth(Math.max(0, ...headLines.map(l => textWidth(l.text, l.font))), headTextH);
  const bodyW = Math.max(120, edgeW(topXs), edgeW(bottomXs));
  const nameW = Math.max(0, ...z.control.map(t => textWidth(t.name, FONT_BODY)));
  const fnW = Math.max(0, ...z.control.map(t => textWidth(t.fn, FONT_BODY)));
  const titles = new Map(z.groups.map(g => [g.id, groupTitle(g)]));
  const titleW = Math.max(0, ...[...titles.values()].map(t => textWidth(t, FONT_SUB) + 12));
  // control pins sit 20 apart; a group's name and description take a row of their own above its first pin
  const pys = []; let cy = 0, prevGroup = null;
  z.control.forEach(t => { if ((t.group || null) !== prevGroup) cy += 20; pys.push(cy + 20); cy += 20; prevGroup = t.group || null; });
  const ctrlW = z.control.length ? ceilGrid(Math.max(8 + nameW + (fnW ? 8 + fnW : 0) + 4, titleW)) : 0;
  const H = Math.max(60, ceilGrid(headTextH + 8), z.control.length ? pys[pys.length - 1] + 20 : 0, z.top.some(t => t.group) || z.bottom.some(t => t.group) ? 80 : 0);
  const right = labelW + bodyW + ctrlW;

  const pathSegments = [
    { d: `M 0 0 L ${right} 0 L ${right} ${H} L 0 ${H} Z`, dash: 'solid' },
    { d: `M ${labelW} 0 L ${labelW} ${H}`, dash: 'solid' }
  ];
  if (ctrlW) pathSegments.push({ d: `M ${labelW + bodyW} 0 L ${labelW + bodyW} ${H}`, dash: 'solid' });
  const pins = [], texts = [];

  let y = Math.max(4, round((H - headTextH) / 2));
  headLines.forEach(l => {
    texts.push({ text: l.text, relX: round((labelW - textWidth(l.text, l.font)) / 2), relY: y, fontSize: l.font, head: true });
    y += rendered(l.font) + 3;
  });

  // power: supply along the top, motor along the bottom, names inside the box beside each lead
  const usedIds = new Set();
  const idFor = (name) => { let id = name; for (let n = 2; usedIds.has(id); n++) id = `${name}#${n}`; usedIds.add(id); return id; };   // wires find a pin by its id, so each is its own
  const place = (list, edge, xs) => {
    const fonts = fontsFor(list);
    list.forEach((t, i) => {
      const px = labelW + xs[i];
      const pinY = edge === 'top' ? -GRID : H + GRID;
      pathSegments.push({ d: `M ${px} ${edge === 'top' ? -GRID : H} L ${px} ${edge === 'top' ? 0 : H + GRID}`, dash: 'solid' });
      pins.push({ id: idFor(t.name), name: t.name, type: t.kind, relX: px, relY: pinY, rotation: 90 });
      const f = fonts[i];
      texts.push({ text: t.name, relX: round(px - textWidth(t.name, f) / 2), relY: round(edge === 'top' ? 3 + (lineH - rendered(f)) / 2 : H - 3 - lineH + (lineH - rendered(f)) / 2), fontSize: f });
    });
  };
  place(m.top, 'top', topXs);
  place(m.bottom, 'bottom', bottomXs);

  // control: down the right edge, the name beside the lead and the function to its left
  m.control.forEach((t, i) => {
    const py = pys[i], wave = DRIVE_CONTROL_TYPES[t.kind] && DRIVE_CONTROL_TYPES[t.kind].wave;
    pathSegments.push({ d: `M ${right} ${py} L ${right + GRID} ${py}`, dash: 'solid' });
    if (wave) pathSegments.push({ d: `M ${right + 4} ${py} q 3 -4 6 0 t 6 0`, dash: 'solid' });
    pins.push({ id: idFor(t.name), name: t.name, function: t.fn, type: t.kind, relX: right + GRID, relY: py, rotation: 0 });
    const nameX = right - 4 - textWidth(t.name, FONT_BODY);
    texts.push({ text: t.name, relX: round(nameX), relY: round(py - lineH / 2), fontSize: FONT_BODY });
    let fn = t.fn;
    if (fn && sizeFrom) fn = ellipsis(fn, Math.max(1, Math.floor((ctrlW - 12 - nameW - 8) / (rendered(FONT_BODY) * CHAR_RATIO))));
    if (fn) texts.push({ text: fn, relX: round(nameX - 8 - textWidth(fn, FONT_BODY)), relY: round(py - lineH / 2), fontSize: FONT_BODY });
  });

  // a frame round each run of grouped terminals, with the group's name and description in it
  const BAND = lineH + 6, depth = 3 + lineH + 3 + BAND;
  const edgeFrames = (list, xs, edge) => {
    for (let i = 0; i < list.length;) {
      const id = list[i].group || null;
      let j = i; while (j < list.length && (list[j].group || null) === id) j++;
      if (id) {
        const x1 = labelW + xs[i] - 10, x2 = labelW + xs[j - 1] + 10;
        pathSegments.push({ d: edge === 'top' ? `M ${x1} 0 L ${x1} ${depth} L ${x2} ${depth} L ${x2} 0` : `M ${x1} ${H} L ${x1} ${H - depth} L ${x2} ${H - depth} L ${x2} ${H}`, dash: 'solid' });
        const title = ellipsis(titles.get(id) || '', Math.max(1, Math.floor((x2 - x1 - 6) / (rendered(FONT_SUB) * CHAR_RATIO))));
        if (title) texts.push({ text: title, relX: round(x1 + 3), relY: round(edge === 'top' ? 3 + lineH + 3 + 3 : H - depth + 3), fontSize: FONT_SUB });
      }
      i = j;
    }
  };
  edgeFrames(m.top, topXs, 'top');
  edgeFrames(m.bottom, bottomXs, 'bottom');
  for (let i = 0; i < m.control.length;) {
    const id = m.control[i].group || null;
    let j = i; while (j < m.control.length && (m.control[j].group || null) === id) j++;
    if (id) {
      const y1 = pys[i] - 28, y2 = pys[j - 1] + 10, x1 = labelW + bodyW + 3, x2 = right - 3;
      pathSegments.push({ d: `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`, dash: 'solid' });
      const title = ellipsis(titles.get(id) || '', Math.max(1, Math.floor((x2 - x1 - 6) / (rendered(FONT_SUB) * CHAR_RATIO))));
      if (title) texts.push({ text: title, relX: round(x1 + 4), relY: round(pys[i] - 24), fontSize: FONT_SUB });
    }
    i = j;
  }

  return { pathSegments, pins, texts, width: right, height: H, top: m.top.length ? -GRID : 0, bottom: m.bottom.length ? H + GRID : H, rightPins: m.control.length ? right + GRID : right };
}

// The block layout: one plain box like a PLC or drive module drawn by hand. The make, model and rating sit at the top inside it (the part number
// and description are the sheet label's, as on any other part), the supply and motor terminals run along the top and bottom, and the control
// terminals are in two columns inside the left and right edges, each with its name (and function) inside the box.
function buildBlockGeometry({ m, z, lineH, fontsFor, topXs, bottomXs, edgeW, sizeFrom }) {
  const sideOf = (t) => (t.side === 'right' ? 'right' : 'left');
  const colsZ = { left: z.control.filter(t => sideOf(t) === 'left'), right: z.control.filter(t => sideOf(t) === 'right') };
  const colsM = { left: m.control.filter(t => sideOf(t) === 'left'), right: m.control.filter(t => sideOf(t) === 'right') };
  const titles = new Map(z.groups.map(g => [g.id, groupTitle(g)]));
  const titleW = Math.max(0, ...[...titles.values()].map(t => textWidth(t, FONT_SUB) + 12));

  const headLines = [{ text: z.make, font: FONT_SUB }, { text: z.model, font: FONT_BODY }, { text: z.rating, font: FONT_SUB }].filter(l => l.text);
  const headTextH = headLines.reduce((n, l) => n + rendered(l.font) + 3, 0);
  const headW = Math.max(0, ...headLines.map(l => textWidth(l.text, l.font)));

  const colInfo = (list) => {
    const nameW = Math.max(0, ...list.map(t => textWidth(t.name, FONT_BODY)));
    const fnW = Math.max(0, ...list.map(t => textWidth(t.fn, FONT_BODY)));
    const grouped = list.some(t => t.group);
    return { nameW, fnW, w: list.length ? Math.max(6 + nameW + (fnW ? 8 + fnW : 0) + 6, grouped ? titleW + 8 : 0) : 0 };
  };
  const ci = { left: colInfo(colsZ.left), right: colInfo(colsZ.right) };
  const W = ceilGrid(Math.max(160, edgeW(topXs), edgeW(bottomXs), ci.left.w + ci.right.w + (ci.left.w && ci.right.w ? 12 : 0), headW + 12));

  const firstRow = Math.max(60, ceilGrid(3 + lineH + 6 + headTextH + 6));
  // (the first pin of a column is at firstRow; a group adds a row above its first pin)
  const pysFor = (list) => { const ys = []; let cy = firstRow - 20, prev = null; list.forEach(t => { if ((t.group || null) !== prev) cy += 20; ys.push(cy + 20); cy += 20; prev = t.group || null; }); return ys; };
  const pys = { left: pysFor(colsM.left), right: pysFor(colsM.right) };
  const last = Math.max(0, ...pys.left, ...pys.right);
  const anyEdgeGroup = z.top.some(t => t.group) || z.bottom.some(t => t.group);
  const H = Math.max(80, anyEdgeGroup ? 100 : 0, ceilGrid(last ? last + 30 : firstRow), ceilGrid(3 + lineH + 6 + headTextH + 14));

  const pathSegments = [{ d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`, dash: 'solid' }];
  const pins = [], texts = [];
  let y = 3 + lineH + 6;
  headLines.forEach(l => { texts.push({ text: l.text, relX: round((W - textWidth(l.text, l.font)) / 2), relY: round(y), fontSize: l.font, head: true }); y += rendered(l.font) + 3; });

  const usedIds = new Set();
  const idFor = (name) => { let id = name; for (let n = 2; usedIds.has(id); n++) id = `${name}#${n}`; usedIds.add(id); return id; };
  const place = (list, edge, xs) => {
    const fonts = fontsFor(list);
    list.forEach((t, i) => {
      const px = xs[i], pinY = edge === 'top' ? -GRID : H + GRID;
      pathSegments.push({ d: `M ${px} ${edge === 'top' ? -GRID : H} L ${px} ${edge === 'top' ? 0 : H + GRID}`, dash: 'solid' });
      pins.push({ id: idFor(t.name), name: t.name, type: t.kind, relX: px, relY: pinY, rotation: 90 });
      const f = fonts[i];
      texts.push({ text: t.name, relX: round(px - textWidth(t.name, f) / 2), relY: round(edge === 'top' ? 3 + (lineH - rendered(f)) / 2 : H - 3 - lineH + (lineH - rendered(f)) / 2), fontSize: f });
    });
  };
  place(m.top, 'top', topXs);
  place(m.bottom, 'bottom', bottomXs);

  // control terminals: pins on the box edge itself, names inside
  ['left', 'right'].forEach(side => {
    const list = colsM[side], ys = pys[side], info = ci[side];
    list.forEach((t, i) => {
      const py = ys[i], x = side === 'left' ? 0 : W;
      pins.push({ id: idFor(t.name), name: t.name, function: t.fn, type: t.kind, relX: x, relY: py, rotation: side === 'left' ? 180 : 0 });
      const nw = textWidth(t.name, FONT_BODY);
      let fn = t.fn;
      if (fn && sizeFrom) fn = ellipsis(fn, Math.max(1, Math.floor((info.w - 6 - info.nameW - 8 - 6) / (rendered(FONT_BODY) * CHAR_RATIO))));
      if (side === 'left') {
        texts.push({ text: t.name, relX: 6, relY: round(py - lineH / 2), fontSize: FONT_BODY });
        if (fn) texts.push({ text: fn, relX: round(6 + info.nameW + 8), relY: round(py - lineH / 2), fontSize: FONT_BODY });
      } else {
        const nameX = W - 6 - nw;
        texts.push({ text: t.name, relX: round(nameX), relY: round(py - lineH / 2), fontSize: FONT_BODY });
        if (fn) texts.push({ text: fn, relX: round(W - 6 - info.nameW - 8 - textWidth(fn, FONT_BODY)), relY: round(py - lineH / 2), fontSize: FONT_BODY });
      }
    });
    // a frame round each run of grouped terminals, with the group's name and description in it
    for (let i = 0; i < list.length;) {
      const id = list[i].group || null;
      let j = i; while (j < list.length && (list[j].group || null) === id) j++;
      if (id) {
        const y1 = ys[i] - 28, y2 = ys[j - 1] + 10;
        const x1 = side === 'left' ? 3 : W - Math.max(info.w, titleW + 8) - 3, x2 = side === 'left' ? 3 + Math.max(info.w, titleW + 8) : W - 3;
        pathSegments.push({ d: `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`, dash: 'solid' });
        const title = ellipsis(titles.get(id) || '', Math.max(1, Math.floor((x2 - x1 - 6) / (rendered(FONT_SUB) * CHAR_RATIO))));
        if (title) texts.push({ text: title, relX: round(x1 + 4), relY: round(ys[i] - 24), fontSize: FONT_SUB });
      }
      i = j;
    }
  });

  const BAND = lineH + 6, depth = 3 + lineH + 3 + BAND;
  const edgeFrames = (list, xs, edge) => {
    for (let i = 0; i < list.length;) {
      const id = list[i].group || null;
      let j = i; while (j < list.length && (list[j].group || null) === id) j++;
      if (id) {
        const x1 = xs[i] - 10, x2 = xs[j - 1] + 10;
        pathSegments.push({ d: edge === 'top' ? `M ${x1} 0 L ${x1} ${depth} L ${x2} ${depth} L ${x2} 0` : `M ${x1} ${H} L ${x1} ${H - depth} L ${x2} ${H - depth} L ${x2} ${H}`, dash: 'solid' });
        const title = ellipsis(titles.get(id) || '', Math.max(1, Math.floor((x2 - x1 - 6) / (rendered(FONT_SUB) * CHAR_RATIO))));
        if (title) texts.push({ text: title, relX: round(x1 + 3), relY: round(edge === 'top' ? 3 + lineH + 3 + 3 : H - depth + 3), fontSize: FONT_SUB });
      }
      i = j;
    }
  };
  edgeFrames(m.top, topXs, 'top');
  edgeFrames(m.bottom, bottomXs, 'bottom');

  return { pathSegments, pins, texts, width: W, height: H, top: m.top.length ? -GRID : 0, bottom: m.bottom.length ? H + GRID : H, rightPins: W };
}

// ---- the symbol ----

export function buildDriveSymbolDefinition(module, library) {
  const m = normaliseDrive(module);
  const geometry = buildDriveGeometry(m);
  const definition = {
    name: [m.make, m.model].filter(Boolean).join(' '),
    prefix: m.designator,
    value: ' ',   // the header already names the drive, and '' would show the word CUSTOM
    make: m.make, modelNo: m.model, description: m.description,
    pathData: geometry.pathSegments, pins: geometry.pins, texts: geometry.texts,
    drive: m
  };
  const lib = clean(library);
  if (lib) definition.library = lib;
  return definition;
}

// ---- functions of one placed drive ----
// A library drive carries default functions for its control terminals; each drive placed on a sheet can have its own,
// kept on the component as driveFns { terminal name: function }. Only the functions differ, so the drawing is the library
// drive's with its function texts replaced.

// Every control terminal of a drive: [{ name, kind, fn }]
export function driveChannels(def) {
  const m = def && def.drive ? normaliseDrive(def.drive) : null;
  return m ? m.control.map(t => ({ ...t })) : [];
}

// The function a placed drive gives one control terminal: its own, else the library's.
export function driveFunctionFor(comp, name, libraryFn = '') {
  const own = comp && comp.driveFns && Object.prototype.hasOwnProperty.call(comp.driveFns, name) ? comp.driveFns[name] : undefined;
  return own !== undefined ? own : libraryFn;
}

// Keeps only functions that differ from the library's, trimmed and limited in length.
export function cleanDriveFns(def, fns) {
  const out = {};
  driveChannels(def).forEach(c => {
    if (!fns || !Object.prototype.hasOwnProperty.call(fns, c.name)) return;
    const v = clean(fns[c.name]).slice(0, DRIVE_LIMITS.fn);
    if (v !== c.fn) out[c.name] = v;
  });
  return out;
}

// The texts for a placed drive with its own functions. Null when it has none (use the library's).
// The box does not change size: a function too long for the room is shortened on the drawing (it is kept in full).
export function driveInstanceTexts(def, fns) {
  if (!def || !def.drive || !fns || !Object.keys(fns).length) return null;
  const base = normaliseDrive(def.drive);
  const own = { ...base, control: base.control.map(t => ({ ...t, fn: driveFunctionFor({ driveFns: fns }, t.name, t.fn) })) };
  return buildDriveGeometry(own, base, savedLabelW(def)).texts;
}

export const isDriveSymbol = (def) => !!def && typeof def === 'object' && !!def.drive;
