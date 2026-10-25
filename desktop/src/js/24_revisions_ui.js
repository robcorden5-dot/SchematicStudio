// ==========================================
// 24. REVISIONS WINDOW
// ==========================================
// The revision log of the drawing: issue a new revision (A, B, C ...), say what changed and
// on which sheets, and see which sheets have changed since the last one was issued. The rules
// are in 23_revision_data.js. What is drawn on the sheets (the REV box and the table above the
// title block) is done in 3_schematic_engine.js from the same log.
import { state, todayStr, appConfirm, scheduleAutosave, getPageType, getSchematicSheetNumber } from './1_config_state.js';
import { loadActiveSheet } from './5_portfolio_sheets.js';
import * as RV from './23_revision_data.js';

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const log = () => (state.revisions || (state.revisions = []));

let editingId = null;      // the revision on the form; null = issuing a new one
let message = { text: '', kind: '' };
let lastBy = '';

function sheetLabel(s) {
  const idx = state.sheets.indexOf(s);
  const num = getPageType(s) === 'panel' ? `P${state.sheets.filter(x => getPageType(x) === 'panel').indexOf(s) + 1}` : getSchematicSheetNumber(idx);
  return `${num}  ${s.title || 'Untitled'}`;
}

function ensureModal() {
  let m = el('revisionsModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'revisionsModal';
  m.className = 'modal-overlay';
  m.style.zIndex = '1030';
  m.innerHTML = '<div class="modal-card" style="width:620px; max-width:94vw; max-height:92vh; overflow:auto;"><div id="rvBody"></div></div>';
  document.body.appendChild(m);
  m.addEventListener('click', onClick);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRevisionsModal(); });
  return m;
}

export function openRevisionsModal() {
  const m = ensureModal();
  editingId = null; message = { text: '', kind: '' };
  if (!lastBy) lastBy = (state.sheets.find(s => getPageType(s) === 'schematic' && s.author) || {}).author || '';
  render(null);
  m.style.display = 'flex';
}

export function closeRevisionsModal() {
  const m = el('revisionsModal'); if (m) m.style.display = 'none';
}

// `form` carries what is typed in the form when the window is redrawn, so nothing is lost.
function readForm() {
  if (!el('rvRev')) return null;
  return {
    rev: el('rvRev').value, date: el('rvDate').value, by: el('rvBy').value, description: el('rvDesc').value,
    sheetIds: Array.from(document.querySelectorAll('#rvSheets input[type=checkbox]')).filter(c => c.checked).map(c => Number(c.value))
  };
}

function render(form) {
  const body = el('rvBody'); if (!body) return;
  const list = log();
  const track = RV.trackableSheets(state.sheets);
  const changed = new Set(RV.changedSheetIds(list, state.sheets).map(String));
  const editing = editingId !== null ? list.find(r => r.id === editingId) : null;
  const f = form || (editing
    ? { rev: editing.rev, date: editing.date, by: editing.by, description: editing.description, sheetIds: editing.sheets }
    : { rev: RV.nextRevisionName(list), date: todayStr, by: lastBy, description: '', sheetIds: track.filter(s => changed.has(String(s.id))).map(s => s.id) });
  const picked = new Set((f.sheetIds || []).map(String));

  let h = '<div class="modal-header"><h3>Revisions</h3><button type="button" class="btn-icon" data-act="close">&#10005;</button></div>';
  h += '<p class="modal-hint">Each revision says what changed and on which sheets. A sheet\'s title block shows the latest revision that covers it, and the latest revisions are listed in a table above the title block.</p>';
  if (message.text) h += `<p class="modal-hint" style="color:${message.kind === 'error' ? '#f87171' : '#4ade80'};">${esc(message.text)}</p>`;

  if (list.length) {
    h += '<div style="max-height:200px; overflow:auto; border:1px solid var(--border-light); border-radius:6px;"><table style="width:100%; border-collapse:collapse; font-size:12px;"><tr style="text-align:left; color:var(--text-faint);"><th style="padding:4px 6px;">Rev</th><th>Date</th><th>Description</th><th>By</th><th>Sheets</th><th></th></tr>';
    list.slice().reverse().forEach(r => {
      h += `<tr style="border-top:1px solid var(--border-light);${r.id === editingId ? 'background:var(--bg-field);' : ''}"><td style="padding:4px 6px;"><b>${esc(r.rev)}</b></td><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td>${esc(r.by)}</td><td>${r.sheets.length}</td>
        <td style="white-space:nowrap;"><button type="button" class="btn-icon" data-act="edit" data-id="${r.id}" title="Edit">✎</button><button type="button" class="btn-icon" data-act="delete" data-id="${r.id}" title="Delete">🗑</button></td></tr>`;
    });
    h += '</table></div>';
  } else h += '<p class="modal-hint"><i>No revisions have been issued yet. Sheets show their own revision until the first one is issued.</i></p>';

  h += `<h4 style="margin:14px 0 4px;">${editing ? `Edit revision ${esc(editing.rev)}` : 'Issue a new revision'}</h4>`;
  h += `<div class="terminal-two-col"><div style="flex:1;"><label for="rvRev">Revision</label><input type="text" id="rvRev" maxlength="${RV.REV_MAX.rev}" value="${esc(f.rev)}" autocomplete="off"></div>
    <div style="flex:1;"><label for="rvDate">Date</label><input type="date" id="rvDate" value="${esc(f.date)}"></div>
    <div style="flex:1;"><label for="rvBy">By</label><input type="text" id="rvBy" maxlength="${RV.REV_MAX.by}" value="${esc(f.by)}" autocomplete="off"></div></div>
    <label for="rvDesc">What changed</label><input type="text" id="rvDesc" maxlength="${RV.REV_MAX.description}" value="${esc(f.description)}" placeholder="e.g. Added second motor starter, updated cable schedule" autocomplete="off">`;

  h += `<div style="display:flex; align-items:center; gap:8px; margin-top:10px;"><label style="margin:0;">Sheets covered</label><span style="flex:1;"></span>
    <button type="button" class="btn btn-ghost" data-act="pick-changed" ${editing ? 'disabled' : ''}>Changed only</button><button type="button" class="btn btn-ghost" data-act="pick-all">All</button><button type="button" class="btn btn-ghost" data-act="pick-none">None</button></div>`;
  h += '<div id="rvSheets" style="max-height:170px; overflow:auto; border:1px solid var(--border-light); border-radius:6px; padding:4px 8px; margin-top:4px;">';
  track.forEach(s => {
    const cur = RV.currentRev(list, s), isChanged = changed.has(String(s.id)) && list.length > 0;
    h += `<label style="display:flex; align-items:center; gap:8px; padding:2px 0; font-size:12px; cursor:pointer;"><input type="checkbox" value="${s.id}" ${picked.has(String(s.id)) ? 'checked' : ''} style="width:auto; margin:0;">
      <span style="flex:1;">${esc(sheetLabel(s))}</span><span style="color:var(--text-faint);">${list.some(r => r.sheets.some(id => String(id) === String(s.id))) ? 'Rev ' + esc(cur) : 'not issued'}</span>
      ${isChanged ? '<span style="color:var(--warn); font-weight:600;">changed</span>' : ''}</label>`;
  });
  h += '</div>';
  h += `<div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="${editing ? 'cancel-edit' : 'close'}">${editing ? 'Cancel edit' : 'Close'}</button><button type="button" class="btn btn-primary" data-act="${editing ? 'save-edit' : 'issue'}">${editing ? 'Save changes' : 'Issue revision'}</button></div>`;
  body.innerHTML = h;
}

function refreshSheets() {
  const s = state.sheets[state.activeSheetIndex];
  if (s) loadActiveSheet();
}

async function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) { if (e.target === el('revisionsModal')) closeRevisionsModal(); return; }
  const act = t.dataset.act, list = log();
  const form = readForm();
  switch (act) {
    case 'close': closeRevisionsModal(); break;
    case 'pick-all': case 'pick-none': case 'pick-changed': {
      const changed = new Set(RV.changedSheetIds(list, state.sheets).map(String));
      const ids = RV.trackableSheets(state.sheets).filter(s => act === 'pick-all' || (act === 'pick-changed' && changed.has(String(s.id)))).map(s => s.id);
      render({ ...form, sheetIds: ids }); break;
    }
    case 'issue': {
      const r = RV.issueRevision(list, state.sheets, form);
      if (!r.ok) { message = { text: r.error, kind: 'error' }; render(form); break; }
      lastBy = form.by || lastBy;
      message = { text: `Revision ${r.revision.rev} issued on ${r.revision.sheets.length} sheet${r.revision.sheets.length === 1 ? '' : 's'}.`, kind: 'ok' };
      scheduleAutosave(); render(null); refreshSheets(); break;
    }
    case 'edit': editingId = Number(t.dataset.id); message = { text: '', kind: '' }; render(null); break;
    case 'cancel-edit': editingId = null; message = { text: '', kind: '' }; render(null); break;
    case 'save-edit': {
      const r = RV.editRevision(list, editingId, form);
      if (!r.ok) { message = { text: r.error, kind: 'error' }; render(form); break; }
      editingId = null; message = { text: 'Saved.', kind: 'ok' };
      scheduleAutosave(); render(null); refreshSheets(); break;
    }
    case 'delete': {
      const r = list.find(x => x.id === Number(t.dataset.id)); if (!r) break;
      if (!(await appConfirm(`Delete revision ${r.rev}? Sheets it covered go back to their earlier revision, and changes since will show as changed again.`))) break;
      RV.deleteRevision(list, r.id);
      if (editingId === r.id) editingId = null;
      message = { text: `Revision ${r.rev} deleted.`, kind: 'ok' };
      scheduleAutosave(); render(null); refreshSheets(); break;
    }
    default: break;
  }
}
