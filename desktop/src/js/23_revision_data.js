// ==========================================
// 23. REVISION LOG (rules only - no screen code)
// ==========================================
// Drawing revisions the way a drawing office keeps them: a project-wide log of
// revisions (A, B, C ... or 1, 2, 3 ...), each saying when, what changed, who made
// it and which sheets it covers. A sheet's title block shows the latest revision that
// covers it, and the last few rows of the log are drawn as a table above the title
// block. Each revision also remembers what every sheet looked like when it was issued,
// so the Revisions window can point out the sheets that have changed since.
//
// state.revisions = [{ id, rev, date, description, by, sheets: [sheetId], hashes: { sheetId: hash } }], oldest first.

export const REV_MAX_ROWS = 5;     // rows of the log drawn above a title block
export const REV_ROW_H = 14;       // height of one row, heading included
export const REV_MAX = { rev: 12, description: 120, by: 30 };

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const type = (s) => s.pageType || 'schematic';

// The sheets a revision can cover: drawing sheets (schematic and panel), not the generated pages.
export const trackableSheets = (sheets) => (sheets || []).filter(s => type(s) === 'schematic' || type(s) === 'panel');

// The next revision name after the last one: A -> B ... Z -> AA, 1 -> 2, 1.0 -> 2.0, nothing yet -> A.
export function nextRevisionName(list) {
  const last = list && list.length ? String(list[list.length - 1].rev || '').trim() : '';
  if (!last) return 'A';
  if (/^[A-Za-z]+$/.test(last)) {
    const up = last === last.toUpperCase();
    const chars = last.toUpperCase().split('');
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] === 'Z') { chars[i] = 'A'; i--; } else { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); break; }
    }
    if (i < 0) chars.unshift('A');
    const out = chars.join('');
    return up ? out : out.toLowerCase();
  }
  const m = last.match(/^(\d+)(\.\d+)?$/);
  if (m) return String(Number(m[1]) + 1) + (m[2] ? '.0' : '');
  return last + '+';
}

// A short fingerprint of everything on a sheet that counts as a change (not its revision or whether its tab is open).
export function sheetHash(sheet) {
  const s = JSON.stringify(sheet, (k, v) => (k === 'rev' || k === 'tabClosed') ? undefined : v) || '';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

export function cleanRevision(r) {
  if (!r || typeof r !== 'object') return null;
  const rev = text(r.rev, REV_MAX.rev);
  if (!rev) return null;
  const hashes = {};
  if (r.hashes && typeof r.hashes === 'object') Object.keys(r.hashes).forEach(k => { if (typeof r.hashes[k] === 'string') hashes[k] = r.hashes[k]; });
  return {
    id: r.id, rev, date: text(r.date, 10), description: text(r.description, REV_MAX.description), by: text(r.by, REV_MAX.by),
    sheets: Array.isArray(r.sheets) ? r.sheets.filter(x => x !== null && x !== undefined) : [], hashes
  };
}

// The revisions that cover a sheet, oldest first.
export const revisionsFor = (list, sheet) => (list || []).filter(r => (r.sheets || []).some(id => String(id) === String(sheet.id)));

// The revision a sheet is at: the latest one covering it, else whatever the sheet itself says.
export function currentRev(list, sheet) {
  const mine = revisionsFor(list, sheet);
  return mine.length ? mine[mine.length - 1].rev : (sheet.rev || '1.0');
}

// How tall the revision table above a title block is for this sheet (0 when it has no revisions).
export function revTableHeight(list, sheet) {
  const n = Math.min(REV_MAX_ROWS, revisionsFor(list, sheet).length);
  return n ? (n + 1) * REV_ROW_H : 0;
}

// The rows to draw for a sheet, oldest first, the latest nearest the title block.
export const revTableRows = (list, sheet) => revisionsFor(list, sheet).slice(-REV_MAX_ROWS);

// What each sheet looked like at the latest revision: { sheetId: hash }.
function baseline(list) {
  return list && list.length ? (list[list.length - 1].hashes || {}) : {};
}

// The ids of the sheets that have changed since they were last issued (all of them when nothing has been issued).
export function changedSheetIds(list, sheets) {
  const base = baseline(list);
  return trackableSheets(sheets).filter(s => base[s.id] !== sheetHash(s)).map(s => s.id);
}

function checkFields(list, fields, ignoreId) {
  const rev = text(fields.rev, REV_MAX.rev);
  if (!rev) return { error: 'Give the revision a name, such as A or 2.' };
  if ((list || []).some(r => r.id !== ignoreId && r.rev.toLowerCase() === rev.toLowerCase())) return { error: `Revision ${rev} has already been issued.` };
  const description = text(fields.description, REV_MAX.description);
  if (!description) return { error: 'Say what changed in this revision.' };
  return { rev, description, by: text(fields.by, REV_MAX.by), date: text(fields.date, 10) };
}

// Issues a revision covering the given sheets and records how every sheet looks now.
export function issueRevision(list, sheets, fields) {
  const ok = checkFields(list, fields);
  if (ok.error) return { ok: false, error: ok.error };
  const track = trackableSheets(sheets);
  const ids = (fields.sheetIds || []).filter(id => track.some(s => String(s.id) === String(id)));
  if (!ids.length) return { ok: false, error: 'Pick at least one sheet for this revision.' };
  const hashes = { ...baseline(list) };
  track.forEach(s => { if (ids.some(id => String(id) === String(s.id))) hashes[s.id] = sheetHash(s); });
  const id = list.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), Date.now()) + 1;
  const revision = { id, rev: ok.rev, date: ok.date, description: ok.description, by: ok.by, sheets: ids, hashes };
  list.push(revision);
  return { ok: true, revision };
}

// Changes the wording of a revision already issued (not what it covers or the snapshot).
export function editRevision(list, id, fields) {
  const r = list.find(x => x.id === id);
  if (!r) return { ok: false, error: 'That revision is no longer in the log.' };
  const ok = checkFields(list, fields, id);
  if (ok.error) return { ok: false, error: ok.error };
  r.rev = ok.rev; r.description = ok.description; r.by = ok.by; r.date = ok.date;
  if (fields.sheetIds && fields.sheetIds.length) r.sheets = fields.sheetIds.slice();
  return { ok: true, revision: r };
}

export function deleteRevision(list, id) {
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// For a revision list read from a saved project.
export function cleanRevisionList(raw) {
  return (Array.isArray(raw) ? raw : []).map(cleanRevision).filter(Boolean);
}
