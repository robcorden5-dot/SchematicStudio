// ==========================================
// 0. DEFAULT TERMINAL MODELS
// ==========================================
// The terminal types every new project starts with, so nobody has to type in
// the common ones. They are generic on purpose (no manufacturer or part number)
// - add make and part number to your own copies, or import a file of your own.
//
// Only a brand-new project starts from this list (see terminalModels in
// 1_config_state.js); a saved project always keeps whatever models it had, and
// "Add standard set" in the Terminal Models window adds any that are missing.
// To change what new people get, edit this list - nothing else needs touching.
// Each needs a unique name (40 characters at most) and 1 to 4 levels.
export const DEFAULT_TERMINAL_MODELS = [
  { name: 'Feed-through 2.5', make: '', modelNo: '', description: 'Single-level feed-through terminal, 2.5 mm²', levels: 1 },
  { name: 'Feed-through 4',   make: '', modelNo: '', description: 'Single-level feed-through terminal, 4 mm²',   levels: 1 },
  { name: 'Feed-through 6',   make: '', modelNo: '', description: 'Single-level feed-through terminal, 6 mm²',   levels: 1 },
  { name: 'Feed-through 10',  make: '', modelNo: '', description: 'Single-level feed-through terminal, 10 mm²',  levels: 1 },
  { name: 'Double-level 2.5', make: '', modelNo: '', description: 'Double-level terminal, 2.5 mm²',              levels: 2 },
  { name: 'Double-level 4',   make: '', modelNo: '', description: 'Double-level terminal, 4 mm²',                levels: 2 },
  { name: 'Triple-level 1.5', make: '', modelNo: '', description: 'Triple-level terminal, 1.5 mm²',              levels: 3 },
  { name: 'Triple-level 2.5', make: '', modelNo: '', description: 'Triple-level terminal, 2.5 mm²',              levels: 3 }
];

// A fresh copy with ids, so editing one in a project can never change this list.
export function freshDefaultTerminalModels() {
  const base = Date.now();
  return DEFAULT_TERMINAL_MODELS.map((m, i) => ({ id: base + i, ...m }));
}
