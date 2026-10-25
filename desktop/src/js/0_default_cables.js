// ==========================================
// 0. CABLE CORE COLOURS AND DEFAULT CABLE LIBRARY
// ==========================================
// The core colours a cable can use, with the abbreviations that are printed on
// drawings (BRN, BLK, GRY, BLU, GRN, YEL ...), and the cables every new project
// starts with so the common ones never have to be typed in.
//
// Only a brand-new project starts from DEFAULT_CABLES (see cableLibrary in
// 1_config_state.js); a saved project keeps whatever it had, and "Add standard
// set" in the Cable Library window adds any that are missing. To change what new
// people get, edit the list - nothing else needs touching.

// code: what is shown on the drawing. hex2 is the second stripe of a two-colour core.
export const CABLE_COLOURS = [
  { code: 'BRN',     name: 'Brown',        hex: '#8b5a2b' },
  { code: 'BLK',     name: 'Black',        hex: '#111827' },
  { code: 'GRY',     name: 'Grey',         hex: '#9ca3af' },
  { code: 'BLU',     name: 'Blue',         hex: '#2563eb' },
  { code: 'GRN',     name: 'Green',        hex: '#16a34a' },
  { code: 'YEL',     name: 'Yellow',       hex: '#eab308' },
  { code: 'GRN/YEL', name: 'Green/Yellow', hex: '#16a34a', hex2: '#eab308' },
  { code: 'WHT',     name: 'White',        hex: '#ffffff' },
  { code: 'RED',     name: 'Red',          hex: '#dc2626' },
  { code: 'ORG',     name: 'Orange',       hex: '#f97316' },
  { code: 'VIO',     name: 'Violet',       hex: '#7c3aed' },
  { code: 'PNK',     name: 'Pink',         hex: '#ec4899' },
  { code: 'TUR',     name: 'Turquoise',    hex: '#14b8a6' }
];

// Other spellings that are accepted and turned into the codes above.
export const CABLE_COLOUR_ALIASES = {
  BN: 'BRN', BROWN: 'BRN', BK: 'BLK', BLACK: 'BLK', GY: 'GRY', GREY: 'GRY', GRAY: 'GRY', GR: 'GRY',
  BU: 'BLU', BLUE: 'BLU', GN: 'GRN', GREEN: 'GRN', YE: 'YEL', YELLOW: 'YEL', YL: 'YEL',
  'GN/YE': 'GRN/YEL', 'GNYE': 'GRN/YEL', 'GN-YE': 'GRN/YEL', 'GRN/YE': 'GRN/YEL', 'GRN-YEL': 'GRN/YEL',
  'GREEN/YELLOW': 'GRN/YEL', 'GREEN-YELLOW': 'GRN/YEL', 'G/Y': 'GRN/YEL', 'GYE': 'GRN/YEL', EARTH: 'GRN/YEL',
  WH: 'WHT', WHITE: 'WHT', RD: 'RED', OG: 'ORG', OR: 'ORG', ORANGE: 'ORG', VT: 'VIO', VIOLET: 'VIO', PURPLE: 'VIO',
  PK: 'PNK', PINK: 'PNK', TQ: 'TUR', TURQUOISE: 'TUR'
};

// The order cores are coloured in when "standard colours" is asked for.
export const STANDARD_COLOUR_SEQUENCE = ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL', 'WHT', 'ORG', 'VIO', 'PNK', 'TUR', 'RED', 'YEL', 'GRN'];

// Fixed colour sets for the common core counts (an earthed cable carries GRN/YEL).
export const STANDARD_COLOUR_SETS = {
  2: ['BRN', 'BLU'],
  3: ['BRN', 'BLK', 'GRY'],
  4: ['BRN', 'BLK', 'GRY', 'BLU'],
  5: ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL']
};

export const DEFAULT_CABLES = [
  { name: '2C 1.5 control',  cableType: 'Control', coreCount: 2,  csa: '1.5', description: '2-core control cable, 1.5 mm²',            coreColours: ['BRN', 'BLU'] },
  { name: '3C 1.5 control',  cableType: 'Control', coreCount: 3,  csa: '1.5', description: '3-core control cable, 1.5 mm²',            coreColours: ['BRN', 'BLK', 'GRY'] },
  { name: '4C 1.5 control',  cableType: 'Control', coreCount: 4,  csa: '1.5', description: '4-core control cable, 1.5 mm²',            coreColours: ['BRN', 'BLK', 'GRY', 'BLU'] },
  { name: '3C+E 1.5 SWA',    cableType: 'SWA',     coreCount: 4,  csa: '1.5', description: '3-core plus earth armoured cable, 1.5 mm²', coreColours: ['BRN', 'BLK', 'GRY', 'GRN/YEL'] },
  { name: '4C 2.5 SWA',      cableType: 'SWA',     coreCount: 4,  csa: '2.5', description: '4-core armoured cable, 2.5 mm²',            coreColours: ['BRN', 'BLK', 'GRY', 'BLU'] },
  { name: '4C 4 SWA',        cableType: 'SWA',     coreCount: 4,  csa: '4',   description: '4-core armoured cable, 4 mm²',              coreColours: ['BRN', 'BLK', 'GRY', 'BLU'] },
  { name: '5C 1.5 power',    cableType: 'Power',   coreCount: 5,  csa: '1.5', description: '5-core power cable, 1.5 mm² (3-phase, N, E)', coreColours: ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL'] },
  { name: '5C 2.5 power',    cableType: 'Power',   coreCount: 5,  csa: '2.5', description: '5-core power cable, 2.5 mm² (3-phase, N, E)', coreColours: ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL'] },
  { name: '7C 0.75 control', cableType: 'Control', coreCount: 7,  csa: '0.75', description: '7-core control cable, 0.75 mm²',           coreColours: ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL', 'WHT', 'ORG'] },
  { name: '12C 0.75 control', cableType: 'Control', coreCount: 12, csa: '0.75', description: '12-core control cable, 0.75 mm²',         coreColours: ['BRN', 'BLK', 'GRY', 'BLU', 'GRN/YEL', 'WHT', 'ORG', 'VIO', 'PNK', 'TUR', 'RED', 'YEL'] }
];

// A fresh copy with ids, so editing one in a project can never change this list.
export function freshDefaultCableLibrary() {
  const base = Date.now();
  return DEFAULT_CABLES.map((c, i) => ({ id: base + i, ...c, coreColours: c.coreColours.slice() }));
}
