// ==========================================
// 0. DEFAULT SYMBOL LIBRARY
// ==========================================
// Deliberately EMPTY. A brand-new session (a first-ever visit, or explicitly
// starting a new project) begins with no custom symbols at all — see
// window.customSymbolDefinitions' own initialization in 1_config_state.js —
// and the person adds the "Basic" library themselves from Browse Libraries
// in the sidebar. That library is the file symbol-libraries/basic.json on the
// server, which symbol-libraries/list.php lists automatically; to change what
// people get when they import it, replace that file with a fresh export.
//
// This module is kept, rather than deleted, so the starting point stays one
// clearly-named place (put symbols here to give every new session a built-in
// starter set again), and so a stale, populated copy of this file left behind
// on a server gets overwritten instead of lingering. A saved project always
// keeps its own symbols regardless — this is only ever the starting point,
// never something re-applied to existing work.
export const DEFAULT_SYMBOL_LIBRARY = {};
