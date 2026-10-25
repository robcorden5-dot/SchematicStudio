// ==========================================
// 37. TERMINAL GROUPS
// ==========================================
// The PLC module and drive creators let terminals be grouped: A, A_, B, B_, Z, Z_, V+, V- can be
// grouped as "X3" with the description "Encoder". A group is drawn as a frame around its terminals,
// with its name and description written in it. Every terminal in a group sits next to the others
// on the same edge. This file holds the rules, shared by both creators.
//
// A module keeps `groups: [{ id, name, description }]`, and each grouped terminal has `group: id`.

export const GROUP_LIMITS = { name: 12, description: 30 };

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export const groupTitle = (g) => [clean(g.name), clean(g.description)].filter(Boolean).join(' ');

export function nextGroupId(groups) {
  const ids = new Set((groups || []).map(g => g.id));
  let n = 1;
  while (ids.has(`g${n}`)) n++;
  return `g${n}`;
}

// X1, X2... the first not already used by a group
export function nextGroupName(groups) {
  const used = new Set((groups || []).map(g => clean(g.name).toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`x${n}`)) return `X${n}`;
}

// The groups as they are kept: trimmed, and only those that have a terminal in them.
// `items` are every terminal of the module (each with an optional `group`).
export function normaliseGroups(groups, items) {
  const used = new Set((items || []).map(t => t && t.group).filter(Boolean));
  const seen = new Set();
  return (Array.isArray(groups) ? groups : []).map(g => ({ id: clean(g && g.id), name: clean(g && g.name).slice(0, GROUP_LIMITS.name), description: clean(g && g.description).slice(0, GROUP_LIMITS.description) }))
    .filter(g => g.id && used.has(g.id) && !seen.has(g.id) && seen.add(g.id));
}

// What is wrong with the groups, as { error text by group id }. `lists` are the places terminals sit (an edge each),
// in order, each a list of terminals with an optional `group`: a group's terminals must be together, in one list.
export function groupProblems(groups, lists) {
  const problems = {};
  const names = new Map();
  (groups || []).forEach(g => {
    const name = clean(g.name);
    if (!name) problems[g.id] = 'A group needs a name, e.g. X3.';
    else if (name.length > GROUP_LIMITS.name) problems[g.id] = `A group name is at most ${GROUP_LIMITS.name} characters.`;
    else if (names.has(name.toLowerCase())) problems[g.id] = `The group name ${name} is used twice.`;
    else names.set(name.toLowerCase(), g.id);
    if (!problems[g.id] && clean(g.description).length > GROUP_LIMITS.description) problems[g.id] = `Group ${name}: a description is at most ${GROUP_LIMITS.description} characters.`;
    if (problems[g.id]) return;
    const where = [];
    lists.forEach((list, li) => list.forEach((t, i) => { if (t && t.group === g.id) where.push([li, i]); }));
    if (!where.length) return;
    if (where.some(([li]) => li !== where[0][0])) { problems[g.id] = `Group ${name}: its terminals must all be on the same edge.`; return; }
    const idx = where.map(([, i]) => i);
    if (Math.max(...idx) - Math.min(...idx) + 1 !== idx.length) problems[g.id] = `Group ${name}: its terminals must sit next to each other. Drag them together, or take the ones between out of the group.`;
  });
  return problems;
}

// ---- the title block ----
// The label block at the left of a PLC module or drive (model, make, description...). Turned to stand upright, its
// width becomes its height, so it is sized to the stack of title lines plus padding above and below, and only made wider
// than that when the longest line would not fit (with a little padding at its ends). Rounded up to the 20 grid.
export const TITLE_PAD = 10;      // above and below the stack of lines
export const TITLE_SIDE_PAD = 3;  // either end of the longest line
export const titleBlockWidth = (widestLine, stackHeight) => Math.max(40, Math.ceil(Math.max(stackHeight + 2 * TITLE_PAD, widestLine + 2 * TITLE_SIDE_PAD) / 20) * 20);

// The title block width a library symbol was drawn with, read from its divider line (the second path segment), so a
// placed module's texts are laid out on the box its symbol really has, whatever size rule it was drawn under.
export function savedLabelW(def) {
  const d = def && Array.isArray(def.pathData) && def.pathData[1] && def.pathData[1].d;
  const m = /^M\s*(\d+(?:\.\d+)?)\s+0\s+L/.exec(String(d || ''));
  return m ? Number(m[1]) : null;
}
