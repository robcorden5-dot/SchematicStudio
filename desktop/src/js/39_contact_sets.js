// ==========================================
// 39. CONTACT SETS (parent, auxiliary blocks and child contacts)
// ==========================================
// A parent (a coil) offers contacts: its own ("3-pole power, 1 x NO") and those of each auxiliary item fitted to it (a CA5-22M
// with 2 x NO and 2 x NC). A contact is { id, kind: 'no' | 'nc' | 'p3', terms: '13-14' }. NO and NC are control contacts; 'p3'
// is a three-pole power contact, its terms the three poles ('1-2, 3-4, 5-6'). A child contact on a sheet is then ASSIGNED one of them
// (comp.contactRef = { set, id }), and takes its terminal numbers from it: comp.contactNo ("13-14", which the label already
// shows as K1.13-14) and comp.contactTerms (['13', '14'], drawn beside the symbol's pins).
//
// A set is 'own' (the parent's own contacts) or 'aux:<aux item id>'.

import { BUILTIN_LIBRARY } from './40_builtin_library.js';

export const CHILD_CONTACT_KEYS = { no: 'child_contact_no', nc: 'child_contact_nc', p3: 'child_contact_3p', lamp: 'child_lamp' };   // ('sol', a valve coil, is a Pneumatic library symbol flagged childContact:'sol')
export const CONTACT_KINDS = ['no', 'nc', 'p3', 'lamp', 'sol'];   // 'lamp' is a light block fitted to a push button: its terminals X1-X2 are the supply
export const CHILD_CONTACT_LIBRARY = 'Built-in';
// The built-in coils (parents): a control relay, a relay and a motor contactor. Dropped on a sheet they are parents already.
export const PARENT_COIL_KEYS = { cr: 'builtin_coil_cr', k: 'builtin_coil_k', km: 'builtin_coil_km', cr_round: 'builtin_coil_cr_round', k_round: 'builtin_coil_k_round', km_round: 'builtin_coil_km_round' };
// The contact itself, drawn between pins at (0, -20) and (0, 20). Normally open: the blade is pivoted on the lower pin and swings away
// to the upper left, clear of the upper pin. Normally closed: the upper pin has a short hook, above the middle, that rests against the blade, which leans to the
// upper right and passes it.
export const contactBladeArt = (nc) => (nc
  ? [{ d: 'M 0 20 L 0 10', dash: 'solid' }, { d: 'M 0 10 L 10 -10', dash: 'solid' }, { d: 'M 0 -20 L 0 -5 L 7.5 -5', dash: 'solid' }]
  : [{ d: 'M 0 20 L 0 10', dash: 'solid' }, { d: 'M 0 10 L -10 -10', dash: 'solid' }, { d: 'M 0 -20 L 0 -10', dash: 'solid' }]);

// The built-in toggle switches (parents): a toggle (lever), a selector (knob) and a key switch, each normally open (3-4) or normally
// closed (1-2). They behave as the push buttons did: the switch has its own contact, further contact blocks and lamps are children of it,
// and every child has its own part details and BOM line.
export const TOGGLE_SWITCH_KEYS = {
  toggle_no: 'builtin_sw_toggle_no', toggle_nc: 'builtin_sw_toggle_nc',
  selector_no: 'builtin_sw_selector_no', selector_nc: 'builtin_sw_selector_nc',
  key_no: 'builtin_sw_key_no', key_nc: 'builtin_sw_key_nc'
};
const SWITCH_STYLES = {
  toggle: { name: 'Toggle Switch', description: 'Toggle switch',
    head: [{ d: 'M -14 5 L -19 -4', dash: 'solid' }, { d: 'M -21 -4 A 2 2 0 1 0 -17 -4 A 2 2 0 1 0 -21 -4', dash: 'solid' }], linkTo: -14 },
  selector: { name: 'Selector Switch', description: 'Selector switch',
    head: [{ d: 'M -13 5 A 4 4 0 1 0 -21 5 A 4 4 0 1 0 -13 5', dash: 'solid' }, { d: 'M -17 1 L -17 9', dash: 'solid' }], linkTo: -13 },
  key: { name: 'Key Switch', description: 'Key switch',
    head: [{ d: 'M -13 5 A 3 3 0 1 0 -19 5 A 3 3 0 1 0 -13 5', dash: 'solid' }, { d: 'M -19 5 L -26 5', dash: 'solid' }, { d: 'M -24 5 L -24 8', dash: 'solid' }, { d: 'M -21.5 5 L -21.5 8', dash: 'solid' }], linkTo: -13 }
};
export function buildToggleSwitchDefinition(styleKey, kind) {
  const st = SWITCH_STYLES[styleKey];
  const nc = kind === 'nc';
  const linkFrom = nc ? 2.5 : -2.5;   // where the dashed operating link leaves the blade
  const pathData = [...contactBladeArt(nc), { d: `M ${linkFrom} 5 L ${st.linkTo} 5`, dash: 'dashed' }, ...st.head];
  const t = nc ? ['1', '2'] : ['3', '4'];
  return {
    name: `${st.name} (${nc ? 'N.C' : 'N.O'})`, prefix: 'S', value: ' ', description: st.description,
    pathData, pins: [{ id: t[0], relX: 0, relY: -20, rotation: 270 }, { id: t[1], relX: 0, relY: 20, rotation: 90 }],
    texts: [{ text: t[0], relX: 5, relY: -25, fontSize: 12, rotation: 0 }, { text: t[1], relX: 5, relY: 20, fontSize: 12, rotation: 0 }],
    parentCoil: 'pb', pushButton: kind, switchStyle: styleKey, library: CHILD_CONTACT_LIBRARY, builtin: true
  };
}
// The built-in push buttons (parents): a normally closed button numbered 1-2 and a normally open one numbered 3-4, drawn with the
// operator at the left. Contacts fitted to a push button keep the same numbers: NC is always 1-2 and NO always 3-4.
export const PUSH_BUTTON_KEYS = { no: 'builtin_pb_no', nc: 'builtin_pb_nc' };
// The artwork is the same as the Basic library's push buttons: the contact blade, a dashed link to the push head (an E on its side).
// (An N.C button has its dashed hook against the blade, above the link.)
const PB_HEAD = [
  { d: 'M -15 0 L -5 0', dash: 'dashed' },
  { d: 'M -14.72 -4.87 L -14.72 5.28', dash: 'solid' },
  { d: 'M -15.23 -5.08 L -10.15 -5.08', dash: 'solid' },
  { d: 'M -15.23 5.08 L -10.15 5.08', dash: 'solid' }
];
export function buildPushButtonDefinition(kind) {
  const nc = kind === 'nc';
  const pathData = nc
    ? [{ d: 'M 0 10 L 10 -10', dash: 'solid' }, { d: 'M 0 -20 L 0 -5', dash: 'solid' }, { d: 'M 0 20 L 0 10', dash: 'solid' }, { d: 'M -15 0 L 5 0', dash: 'dashed' }, ...PB_HEAD.slice(1), { d: 'M 0 -5 L 10 -5', dash: 'dashed' }]
    : [{ d: 'M 0 10 L -10 -10', dash: 'solid' }, { d: 'M 0 -20 L 0 -10', dash: 'solid' }, { d: 'M 0 20 L 0 10', dash: 'solid' }, ...PB_HEAD];
  const t = nc ? ['1', '2'] : ['3', '4'];   // on a push button the NC contact is 1-2 and the NO contact 3-4
  return {
    name: nc ? 'Push Button (N.C)' : 'Push Button (N.O)', prefix: 'PB', value: ' ', description: 'Push button',
    pathData, pins: [{ id: t[0], relX: 0, relY: -20, rotation: 270 }, { id: t[1], relX: 0, relY: 20, rotation: 90 }],
    texts: [{ text: t[0], relX: 5, relY: -25, fontSize: 12, rotation: 0 }, { text: t[1], relX: 5, relY: 20, fontSize: 12, rotation: 0 }],
    parentCoil: 'pb', pushButton: kind, library: CHILD_CONTACT_LIBRARY, builtin: true
  };
}
// A child contact or lamp of a push button is a component in its own right: its own make, model and description, and its own BOM line,
// where a child of a coil is the same device as its parent.
export function ownsPartDetails(comp, parent) {
  if (!comp || !comp.parentId || !parent) return false;
  const def = window.customSymbolDefinitions ? window.customSymbolDefinitions[parent.type] : null;
  return isPushButtonParent(parent, def) || isValveBody(parent, def);   // a valve's solenoid coils are parts of their own too
}
// A valve body: a solenoid-operated valve of the Pneumatic library (flagged valveBody), or any valve symbol (prefix V) named as solenoid operated.
// Its solenoid coils (kind 'sol', terms the pilot port: 14, 12) are children placed in the electrical circuit.
export function isValveBody(comp, def) {
  if (!def) return false;
  return !!def.valveBody || (/^V/i.test(String(def.prefix || '')) && /solenoid/i.test(String(def.name || '')));
}
// The solenoids a valve body offers by default: a 5-port valve 14 (and 12 if double), a 2- or 3-port valve 12.
export function suggestValveSolenoids(def) {
  if (def && Array.isArray(def.valveSolenoids) && def.valveSolenoids.length) return def.valveSolenoids.map(t => ({ terms: String(t) }));   // a hydraulic valve names its solenoids (a, b)
  const name = String((def && def.name) || '');
  const five = /^5\//.test(name) || (def && Array.isArray(def.pins) && def.pins.length >= 5);
  const double = /double/i.test(name);
  if (!five) return [{ terms: '12' }];
  return double ? [{ terms: '14' }, { terms: '12' }] : [{ terms: '14' }];
}

// A symbol with one contact drawn between pins at (0, -20) and (0, 20): its terminal numbers can be taken from a contact of the part.
export const hasStandardContactPins = (def) => !!def && Array.isArray(def.pins) && def.pins.length === 2
  && def.pins.every(p => p.relX === 0 && Math.abs(p.relY) === 20) && def.pins[0].relY !== def.pins[1].relY;
// On a push button the numbers never change with the position: a normally closed contact is always 1-2, a normally open one always 3-4 (a lamp is X1-X2)
// (each contact block is its own set of contacts, so the same numbers repeat from block to block).
export const suggestPushButtonTerminals = (kind) => (kind === 'lamp' ? 'X1-X2' : kind === 'nc' ? '1-2' : '3-4');
// A push button parent: one of the built-in ones, or a symbol of the user's with the prefix PB (1PB1, 2PB3...).
export function isPushButtonParent(comp, def) {
  if (!comp) return false;
  if (def && (def.pushButton || String(def.prefix || '').toUpperCase() === 'PB')) return true;
  return /^\d*PB\d/i.test(String(comp.label || ''));
}

const PARENT_COILS = {
  cr: { name: 'Control Relay Coil (CR)', prefix: 'CR', description: 'Control relay' },
  k: { name: 'Relay Coil (K)', prefix: 'K', description: 'Relay' },
  km: { name: 'Motor Contactor Coil (KM)', prefix: 'KM', description: 'Motor contactor' }
};

export const childContactKind = (type) => (type === CHILD_CONTACT_KEYS.no ? 'no' : type === CHILD_CONTACT_KEYS.nc ? 'nc' : type === CHILD_CONTACT_KEYS.p3 ? 'p3' : type === CHILD_CONTACT_KEYS.lamp ? 'lamp'
  : ((window.customSymbolDefinitions && window.customSymbolDefinitions[type] && window.customSymbolDefinitions[type].childContact) || null));

// The generated symbols: a vertical control contact (NO, NC) or a three-pole power contact, with the pins at the ends and the
// terminal numbers filled in from the assigned contact.
export function buildChildContactDefinition(kind) {
  const nc = kind === 'nc';
  let pathData, pins, name;
  if (kind === 'lamp') {
    name = 'Lamp';
    pathData = [
      { d: 'M 0 -20 L 0 -10', dash: 'solid' },
      { d: 'M 0 20 L 0 10', dash: 'solid' },
      { d: 'M -10 0 A 10 10 0 1 0 10 0 A 10 10 0 1 0 -10 0', dash: 'solid' },
      { d: 'M -7 -7 L 7 7', dash: 'solid' },
      { d: 'M -7 7 L 7 -7', dash: 'solid' }
    ];
    pins = [{ id: 'X1', relX: 0, relY: -20, rotation: 90 }, { id: 'X2', relX: 0, relY: 20, rotation: 90 }];
  } else if (kind === 'p3') {
    name = 'Contact (3-pole power)';
    pathData = [];
    [-20, 0, 20].forEach(x => pathData.push(
      { d: `M ${x} -20 L ${x} -10`, dash: 'solid' },
      { d: `M ${x} 20 L ${x} 10`, dash: 'solid' },
      { d: `M ${x} 10 L ${x - 10} -10`, dash: 'solid' }
    ));
    pathData.push({ d: 'M -25 0 L 15 0', dash: 'dashed' });   // the three poles move together
    pins = [-20, 0, 20].map((x, i) => ({ id: String(i * 2 + 1), relX: x, relY: -20, rotation: 90 }))
      .concat([-20, 0, 20].map((x, i) => ({ id: String(i * 2 + 2), relX: x, relY: 20, rotation: 90 })));
  } else {
    name = nc ? 'Contact (N.C)' : 'Contact (N.O)';
    pathData = contactBladeArt(nc);
    pins = [{ id: '1', relX: 0, relY: -20, rotation: 90 }, { id: '2', relX: 0, relY: 20, rotation: 90 }];
  }
  return { name, nameNote: '(child)', prefix: 'K', value: ' ', pathData, pins, texts: [], childContact: kind, library: CHILD_CONTACT_LIBRARY, builtin: true };
}

// A coil: a rectangle (or, for the round version, a circle) with A1 above and A2 below. `kind` is 'cr', 'k' or 'km', with '_round' for the circle.
export function buildParentCoilDefinition(kind) {
  const round = kind.endsWith('_round');
  const base = round ? kind.slice(0, -6) : kind;
  const c = PARENT_COILS[base];
  // Compact: the pins are one grid square apart (0,0 and 0,20), the body between them.
  const pathData = [
    { d: 'M 0 0 L 0 5', dash: 'solid' },
    { d: 'M 0 20 L 0 15', dash: 'solid' },
    { d: round ? 'M -5 10 A 5 5 0 1 0 5 10 A 5 5 0 1 0 -5 10' : 'M -10 5 L 10 5 L 10 15 L -10 15 Z', dash: 'solid' }
  ];
  const pins = [{ id: 'A1', relX: 0, relY: 0, rotation: 90 }, { id: 'A2', relX: 0, relY: 20, rotation: 90 }];
  const texts = [{ text: 'A1', relX: 5, relY: -8, fontSize: 11, rotation: 0 }, { text: 'A2', relX: 5, relY: 21.5, fontSize: 11, rotation: 0 }];
  return { name: round ? c.name.replace(')', ', round)') : c.name, prefix: c.prefix, value: ' ', description: c.description, pathData, pins, texts, parentCoil: base, library: CHILD_CONTACT_LIBRARY, builtin: true };
}

// Puts the built-in symbols (child contacts and coils) in the project's symbols, fresh each time so an older project's copy is brought
// up to date. True when something was added or changed.
export function ensureBuiltinSymbols() {
  if (!window.customSymbolDefinitions) return false;
  let changed = false;
  const put = (key, def) => {
    const cur = window.customSymbolDefinitions[key];
    if (!cur || JSON.stringify(cur) !== JSON.stringify(def)) { window.customSymbolDefinitions[key] = def; changed = true; }
  };
  ['no', 'nc', 'p3', 'lamp'].forEach(kind => put(CHILD_CONTACT_KEYS[kind], buildChildContactDefinition(kind)));
  Object.keys(PUSH_BUTTON_KEYS).forEach(kind => put(PUSH_BUTTON_KEYS[kind], buildPushButtonDefinition(kind)));
  Object.keys(TOGGLE_SWITCH_KEYS).forEach(k => { const [style, kind] = k.split('_'); put(TOGGLE_SWITCH_KEYS[k], buildToggleSwitchDefinition(style, kind)); });
  Object.keys(BUILTIN_LIBRARY).forEach(k => put(k, BUILTIN_LIBRARY[k]));   // fuses, breakers, isolators, motors... (40_builtin_library.js)
  Object.keys(PARENT_COIL_KEYS).forEach(kind => put(PARENT_COIL_KEYS[kind], buildParentCoilDefinition(kind)));
  return changed;
}
export const ensureChildContactSymbols = ensureBuiltinSymbols;

// The terminal numbers drawn beside a child contact's pins. A control contact has two (top, bottom); a power contact six, a
// top and bottom pair for each pole.
export function childContactTexts(kind, terms) {
  const t = Array.isArray(terms) ? terms : [];
  const out = [];
  if (kind === 'sol') {   // a valve coil: A1 / A2 at the pins, the pilot port it operates (14, 12) beside the body
    out.push({ text: 'A1', relX: 5, relY: -8, fontSize: 11, rotation: 0 }, { text: 'A2', relX: 5, relY: 21.5, fontSize: 11, rotation: 0 });   // as on the relay coils
    if (t[0]) out.push({ text: String(t[0]), relX: -32, relY: 4, fontSize: 12, rotation: 0 });
    return out;
  }
  const put = (text, x, y) => { if (text) out.push({ text: String(text), relX: x + 5, relY: y, fontSize: 12, rotation: 0 }); };
  if (kind === 'p3') { [-20, 0, 20].forEach((x, i) => { put(t[i * 2], x, -25); put(t[i * 2 + 1], x, 20); }); return out; }
  put(t[0], 0, -25); put(t[1], 0, 20);
  return out;
}

// ---- numbering ----
// IEC style: the position is the tens digit, 1-2 for an NC contact, 3-4 for an NO: 13-14, 21-22, 33-34...
export const suggestTerminals = (kind, position) => {
  if (kind === 'p3') return '1-2, 3-4, 5-6';
  if (kind === 'lamp') return 'X1-X2';
  if (kind === 'sol') return '14';
  const n = Math.max(1, Math.min(9, position | 0));
  return kind === 'nc' ? `${n}1-${n}2` : `${n}3-${n}4`;
};
export const splitTerms = (text) => String(text || '').split(/\s*[-\u2013/]\s*/).map(s => s.trim()).filter(Boolean);
// The individual terminal numbers of a contact as the symbol draws them (a power contact: '1-2, 3-4, 5-6' -> 1,2,3,4,5,6).
export const termsFor = (kind, text) => (kind === 'p3'
  ? String(text || '').split(/\s*[,;]\s*/).filter(Boolean).flatMap(pole => splitTerms(pole))
  : splitTerms(text));
// What a label shows: a power contact is written by its first and last terminal ('1-6').
export const contactNumberOf = (kind, text) => {
  if (kind !== 'p3') return String(text || '');
  const t = termsFor('p3', text);
  return t.length > 1 ? `${t[0]}-${t[t.length - 1]}` : String(text || '');
};
export const newContactId = () => `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newAuxId = () => `aux_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- what a parent offers ----
const KIND_TEXT = { no: 'NO', nc: 'NC', p3: '3P', lamp: 'LAMP', sol: 'COIL' };
export const kindText = (kind) => KIND_TEXT[kind] || 'NO';

export function auxName(item) {
  return [item.type, item.modelNo].filter(Boolean).join(' ') || item.make || item.description || 'Auxiliary item';
}

// [{ key: 'own' | 'aux:<id>', name, contacts: [{id, kind, terms}] }], the sets with at least one contact.
export function contactSetsOf(parent) {
  if (!parent) return [];
  const sets = [];
  const clean = (list) => (Array.isArray(list) ? list : []).filter(c => c && c.id && CONTACT_KINDS.includes(c.kind));
  const own = clean(parent.contacts);
  if (own.length) sets.push({ key: 'own', name: parent.modelNo ? `${parent.modelNo} (this part)` : 'This part', contacts: own });
  (parent.auxItems || []).forEach(a => {
    const list = clean(a.contacts);
    if (list.length && a.id) sets.push({ key: `aux:${a.id}`, name: auxName(a), contacts: list });
  });
  return sets;
}

export const choiceValue = (setKey, contactId) => `${setKey}|${contactId}`;
export const splitChoice = (value) => { const i = String(value || '').indexOf('|'); return i < 0 ? null : { set: value.slice(0, i), id: value.slice(i + 1) }; };

export function findContact(parent, ref) {
  if (!parent || !ref) return null;
  const set = contactSetsOf(parent).find(s => s.key === ref.set);
  const c = set && set.contacts.find(x => x.id === ref.id);
  return c ? { contact: c, setName: set.name } : null;
}

// What a child takes from the contact it is assigned.
export function childFieldsFor(parent, ref) {
  const found = findContact(parent, ref);
  if (!found) return null;
  return { contactRef: { set: ref.set, id: ref.id }, contactNo: contactNumberOf(found.contact.kind, found.contact.terms), contactTerms: termsFor(found.contact.kind, found.contact.terms) };
}

// Which child contacts use each contact: Map(choiceValue -> [comp]).
export function contactUsage(parentId, sheets) {
  const used = new Map();
  (sheets || []).forEach((sheet, idx) => (sheet.components || []).forEach(c => {
    const isSelf = String(c.id) === String(parentId) && c.selfContactRef;   // the parent's own symbol can stand for one of its contacts too
    if (!isSelf && (!c.parentId || String(c.parentId) !== String(parentId) || !c.contactRef)) return;
    const ref = isSelf ? c.selfContactRef : c.contactRef;
    const k = choiceValue(ref.set, ref.id);
    if (!used.has(k)) used.set(k, []);
    used.get(k).push({ comp: c, sheetIdx: idx });
  }));
  return used;
}

// After a parent's contacts are edited: every child assigned one follows it (new terminal numbers), and one whose contact was
// removed keeps the numbers it had but is no longer assigned. Returns how many children changed.
export function syncChildContacts(parent, sheets) {
  let changed = 0;
  if (parent.selfContactRef) {   // the parent's own symbol follows its contact the same way
    const f = childFieldsFor(parent, parent.selfContactRef);
    if (!f) { delete parent.selfContactRef; delete parent.selfTerms; changed++; }
    else if (JSON.stringify(parent.selfTerms || []) !== JSON.stringify(f.contactTerms)) { parent.selfTerms = f.contactTerms; changed++; }
  }
  (sheets || []).forEach(sheet => (sheet.components || []).forEach(c => {
    if (!c.parentId || String(c.parentId) !== String(parent.id) || !c.contactRef) return;
    const fields = childFieldsFor(parent, c.contactRef);
    if (!fields) { delete c.contactRef; changed++; return; }
    if (c.contactNo !== fields.contactNo || JSON.stringify(c.contactTerms || []) !== JSON.stringify(fields.contactTerms)) { c.contactNo = fields.contactNo; c.contactTerms = fields.contactTerms; changed++; }
  }));
  return changed;
}
