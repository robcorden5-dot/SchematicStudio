// ==========================================
// 10. TERMINAL LINKS
// ==========================================
// A terminal link says "these two terminals are physically joined": the same
// terminal drawn twice (a cable's end and the next cable's start), or two
// terminals bridged on a strip. It is not a wire, so it carries no wire ID of
// its own and never affects junction dots or cable crossings. It does make the
// two terminals one electrical point for numbering: the wires on them share one
// wire ID (see propagateWireIds in 3_schematic_engine.js).
//
// Links live on their sheet as sheet.terminalLinks = [{ id, a, b }], where a and
// b are the ids of the two terminal components. A link stores no coordinates:
// its route is worked out from where the terminals currently are, so it follows
// them when they move.
//
// This module is pure geometry and data — no drawing — so it can be tested on
// its own. The tool itself and the drawing live in 3_schematic_engine.js.

export const LINK_BRACKET_OFFSET = 14;     // how far the first bracket stands off the row of terminals
export const LINK_BRACKET_STEP = 8;        // each further level of bracket stands this much further off
const BRACKET_LEVELS = 4;
const BRACKET_GAP = 25;                    // brackets on one line stay at least this far apart (a little more than a terminal pitch), or the next one drops a level
export const TERMINAL_PICK_RADIUS = 9;     // how close a click must be to a terminal's centre to pick it
const CLEARANCE = 6;                       // a link never passes closer than this to a terminal it isn't joining
const EPS = 0.5;                           // coordinates this close are "the same line"

export function getTerminals(sheet) {
  return (sheet?.components || []).filter(c => c.type === 'terminal');
}

// A terminal has one pin, at its own origin (see getPinsForType).
export function terminalPin(comp) {
  return { x: comp.x, y: comp.y };
}

// The terminal whose centre is nearest (x, y), if any is within `radius`.
export function findTerminalAt(sheet, x, y, radius = TERMINAL_PICK_RADIUS) {
  let best = null, bestDist = radius;
  getTerminals(sheet).forEach(t => {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= bestDist) { best = t; bestDist = d; }
  });
  return best;
}

export function findTerminalLink(sheet, idA, idB) {
  return (sheet?.terminalLinks || []).find(l => (l.a === idA && l.b === idB) || (l.a === idB && l.b === idA));
}

// Adds a link between two terminals, unless they are the same terminal or are
// already linked (either way round). Returns { link, created }, or null if the
// pair isn't a valid link at all.
export function addTerminalLink(sheet, idA, idB) {
  if (idA === idB) return null;
  const ids = new Set(getTerminals(sheet).map(t => t.id));
  if (!ids.has(idA) || !ids.has(idB)) return null;

  const existing = findTerminalLink(sheet, idA, idB);
  if (existing) return { link: existing, created: false };

  if (!sheet.terminalLinks) sheet.terminalLinks = [];
  let id = Date.now();
  while (sheet.terminalLinks.some(l => l.id === id)) id++;
  const link = { id, a: idA, b: idB };
  sheet.terminalLinks.push(link);
  return { link, created: true };
}

// Drops links that no longer make sense: a terminal was deleted, a link points
// at itself, or the same pair is linked twice. Returns how many were removed.
// Run whenever links are drawn, so however a terminal disappears (deleted,
// rubber-banded away, undone) its links go with it.
export function pruneTerminalLinks(sheet) {
  if (!sheet?.terminalLinks || sheet.terminalLinks.length === 0) return 0;
  const ids = new Set(getTerminals(sheet).map(t => t.id));
  const seen = new Set();
  const kept = sheet.terminalLinks.filter(l => {
    if (!l || l.a === l.b || !ids.has(l.a) || !ids.has(l.b)) return false;
    const key = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const removed = sheet.terminalLinks.length - kept.length;
  if (removed) sheet.terminalLinks = kept;
  return removed;
}

// ---- routing ----

const isHorizontal = s => Math.abs(s.y1 - s.y2) < EPS;
const isVertical = s => Math.abs(s.x1 - s.x2) < EPS;

function pointsToSegments(pts) {
  const out = [];
  for (let i = 0; i + 3 < pts.length; i += 2) out.push({ x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] });
  return out;
}

function distToSegment(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

// How badly a candidate route clashes with what's already on the sheet — lower is better.
//   passing over a terminal it isn't joining:  worst (it would look joined to that one too)
//   running along a wire (laid on top of it):  bad
//   crossing a wire:                           mild
function routeScore(pts, others, wireSegs) {
  let score = 0;
  const segs = pointsToSegments(pts);
  segs.forEach(s => {
    others.forEach(o => { if (distToSegment(o.x, o.y, s) < CLEARANCE) score += 1000; });
    wireSegs.forEach(w => {
      if (isHorizontal(s) && isHorizontal(w) && Math.abs(s.y1 - w.y1) < EPS) {
        score += 4 * Math.max(0, Math.min(Math.max(s.x1, s.x2), Math.max(w.x1, w.x2)) - Math.max(Math.min(s.x1, s.x2), Math.min(w.x1, w.x2)));
      } else if (isVertical(s) && isVertical(w) && Math.abs(s.x1 - w.x1) < EPS) {
        score += 4 * Math.max(0, Math.min(Math.max(s.y1, s.y2), Math.max(w.y1, w.y2)) - Math.max(Math.min(s.y1, s.y2), Math.min(w.y1, w.y2)));
      } else if (isHorizontal(s) && isVertical(w)) {
        if (w.x1 > Math.min(s.x1, s.x2) + EPS && w.x1 < Math.max(s.x1, s.x2) - EPS && s.y1 > Math.min(w.y1, w.y2) + EPS && s.y1 < Math.max(w.y1, w.y2) - EPS) score += 1;
      } else if (isVertical(s) && isHorizontal(w)) {
        if (w.y1 > Math.min(s.y1, s.y2) + EPS && w.y1 < Math.max(s.y1, s.y2) - EPS && s.x1 > Math.min(w.x1, w.x2) + EPS && s.x1 < Math.max(w.x1, w.x2) - EPS) score += 1;
      }
    });
  });
  return score;
}

// The line a bracket's crossbar lies on and how far along it runs — the middle
// leg of an 8-number bracket route — or null for a straight bar or an L.
function bracketBar(route) {
  if (!route || route.length !== 8) return null;
  if (route[3] === route[5]) return { horizontal: true, at: route[3], from: Math.min(route[2], route[4]), to: Math.max(route[2], route[4]) };
  return { horizontal: false, at: route[2], from: Math.min(route[3], route[5]), to: Math.max(route[3], route[5]) };
}

// Would a crossbar here run into (or read as continuing) one already drawn on the same line?
function barsCollide(bar, priorBars) {
  return priorBars.some(p => p.horizontal === bar.horizontal && Math.abs(p.at - bar.at) < 4 &&
    bar.from - BRACKET_GAP < p.to && p.from - BRACKET_GAP < bar.to);
}

// Routes one link, given the routes already chosen for the links before it.
function routeOne(link, sheet, priorRoutes) {
  const terms = getTerminals(sheet);
  const A = terms.find(t => t.id === link.a), B = terms.find(t => t.id === link.b);
  if (!A || !B || A === B) return null;

  const a = terminalPin(A), b = terminalPin(B);
  const others = terms.filter(t => t !== A && t !== B).map(terminalPin);
  const wireSegs = [];
  (sheet.wires || []).forEach(w => { if (w.points) wireSegs.push(...pointsToSegments(w.points)); });

  const alignedH = Math.abs(a.y - b.y) < EPS, alignedV = Math.abs(a.x - b.x) < EPS;
  const candidates = []; // { pts, penalty }

  if (alignedH || alignedV) {
    const straight = [a.x, a.y, b.x, b.y];
    if (routeScore(straight, others, []) < 1000) return straight; // nothing of ours in the way
    // Brackets: each side of the row, each level out. The shallowest level whose crossbar keeps clear
    // of the brackets already drawn wins — so neighbouring brackets stagger rather than run together.
    const priorBars = [...priorRoutes.values()].map(bracketBar).filter(Boolean);
    [1, -1].forEach(dir => {
      for (let level = 0; level < BRACKET_LEVELS; level++) {
        const off = dir * (LINK_BRACKET_OFFSET + level * LINK_BRACKET_STEP);
        const pts = alignedH ? [a.x, a.y, a.x, a.y + off, b.x, b.y + off, b.x, b.y] : [a.x, a.y, a.x + off, a.y, b.x + off, b.y, b.x, b.y];
        const bar = bracketBar(pts);
        candidates.push({ pts, penalty: (barsCollide(bar, priorBars) ? 500 : 0) + level });
      }
    });
  } else {
    candidates.push({ pts: [a.x, a.y, b.x, a.y, b.x, b.y], penalty: 0 });
    candidates.push({ pts: [a.x, a.y, a.x, b.y, b.x, b.y], penalty: 0 });
  }

  let best = candidates[0].pts, bestScore = Infinity;
  candidates.forEach(c => {
    const s = routeScore(c.pts, others, wireSegs) + c.penalty;
    if (s < bestScore) { best = c.pts; bestScore = s; }
  });
  return best;
}

// The points [x1, y1, x2, y2, ...] a link is drawn along, or null if either of
// its terminals is missing.
//   - terminals in a line with nothing between them: a straight bar;
//   - in a line but with other terminals between: a bracket standing off the row,
//     on whichever side clashes least with the wires (below / right on a tie), so the
//     bar never runs through — and so never appears to join — the terminals in between.
//     Brackets that would run together on one line stagger to different depths;
//   - not in a line: an L, taking whichever corner clashes least.
// Links are routed in the order they were made, each aware of the ones before it.
export function getTerminalLinkRoute(link, sheet) {
  const prior = new Map();
  for (const other of sheet?.terminalLinks || []) {
    if (other === link || other.id === link.id) break;
    const r = routeOne(other, sheet, prior);
    if (r) prior.set(other.id, r);
  }
  return routeOne(link, sheet, prior);
}

// Every link's route in one pass (the same answers as getTerminalLinkRoute, without redoing the earlier ones each time).
export function getAllTerminalLinkRoutes(sheet) {
  const routes = new Map();
  (sheet?.terminalLinks || []).forEach(link => {
    const r = routeOne(link, sheet, routes);
    if (r) routes.set(link.id, r);
  });
  return routes;
}
