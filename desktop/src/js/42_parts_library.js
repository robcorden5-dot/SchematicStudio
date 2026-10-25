// ==========================================
// 42. PARTS LIBRARY (screen code)
// ==========================================
// The make, model / part number and description of parts a person keeps using, saved against their account (parts/api.php) so
// they can be picked in any project, and shared as a JSON or CSV file. Included with the free trial and Pro.
//   - openPartsLibrary()            the window to add, change, delete, import and export parts
//   - openPartsPicker(onPick)       a searchable list; the chosen part is handed to onPick
//   - pickPartForEdit()             fills Value / Make / Model / Description of the Edit Component Details dialog from a pick
//   - savePartFromEdit()            saves what is in those fields to the library
import { appAlert, appConfirm, saveTextFile } from './1_config_state.js';

const FILE_MARKER = 'schematicStudioParts';
const MAX_FILE_BYTES = 1500000;
let parts = [];
let loaded = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (p) => ({
  id: p.id, category: String(p.category || ''), make: String(p.make || ''), model_no: String(p.model_no ?? p.modelNo ?? ''),
  description: String(p.description || ''), value: String(p.value || ''),
  extra: (p.extra && typeof p.extra === 'object' && (p.extra.auxItems || p.extra.contacts)) ? p.extra : null
});
const extraText = (x) => { if (!x) return ''; const n = (x.auxItems || []).length; const c = (x.contacts || []).length + (x.auxItems || []).reduce((t, a) => t + (a.contacts || []).length, 0); return [n ? `${n} aux item${n === 1 ? '' : 's'}` : '', c ? `${c} contact${c === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '); };

async function api(options) {
  const headers = { 'X-CSRF-Token': window.csrfToken || '' };
  if (options && options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/parts/api.php', Object.assign({ credentials: 'same-origin', headers }, options));
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { ok: !!(res.ok && data && data.success), data };
}
const post = (body) => api({ method: 'POST', body: JSON.stringify(body) });
const msg = (r, fallback) => (r.data && r.data.message) || fallback;

async function load(force) {
  if (loaded && !force) return true;
  let r;
  try { r = await api({}); } catch (e) { r = { ok: false, data: null }; }
  if (!r.ok) { await appAlert(msg(r, 'The parts library could not be reached. Check your connection and try again.')); return false; }
  parts = (r.data.parts || []).map(norm);
  loaded = true;
  return true;
}

const matches = (p, q) => !q || [p.category, p.make, p.model_no, p.description, p.value].join(' ').toLowerCase().includes(q);

// ---------- the modal frame ----------
function frame(id, title, width, hint) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id;
  overlay.style.cssText = 'display:flex;z-index:1120;';
  overlay.innerHTML = `<div class="modal-card" style="width:${width}px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;">
    <div class="modal-header"><h3>${esc(title)}</h3><button type="button" class="btn-icon" data-close>&#10005;</button></div>
    ${hint ? `<p class="modal-hint">${hint}</p>` : ''}<div data-body style="display:flex;flex-direction:column;min-height:0;flex:1 1 auto;"></div></div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  overlay.querySelector('[data-close]').onclick = close;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  return { overlay, body: overlay.querySelector('[data-body]'), close };
}

const cellStyle = 'padding:4px 6px;border-bottom:1px solid var(--border);font-size:12px;text-align:left;vertical-align:top;';

// ---------- the picker ----------
export async function openPartsPicker(onPick) {
  if (!(await load(false))) return;
  const f = frame('partsPickerModal', 'Parts library', 760, parts.length ? 'Choose a part to fill in its make, model / part number and description.' : 'The library is empty. Add parts with <b>Parts Library</b> in the sidebar, or use <i>Save to parts library</i> on a part you have filled in.');
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'Search make, model, description…'; search.setAttribute('autocomplete', 'off');
  search.style.cssText = 'margin-bottom:8px;width:100%;box-sizing:border-box;';
  const list = document.createElement('div');
  list.style.cssText = 'overflow:auto;flex:1 1 auto;min-height:160px;border:1px solid var(--border);border-radius:6px;';
  f.body.append(search, list);
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    const rows = parts.filter(p => matches(p, q));
    list.innerHTML = rows.length
      ? `<table style="width:100%;border-collapse:collapse;"><thead><tr>${['Category', 'Make', 'Model / Part No.', 'Description'].map(h => `<th style="${cellStyle}font-weight:600;color:var(--text-muted);">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((p, i) => `<tr data-i="${i}" style="cursor:pointer;"><td style="${cellStyle}">${esc(p.category)}</td><td style="${cellStyle}">${esc(p.make)}</td><td style="${cellStyle}">${esc(p.model_no)}</td><td style="${cellStyle}">${esc(p.description)}${p.extra ? `<div style="color:var(--text-muted);font-size:11px;">+ ${esc(extraText(p.extra))}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div style="padding:14px;color:var(--text-muted);font-size:13px;">${parts.length ? 'No parts match.' : 'Nothing here yet.'}</div>`;
    list.querySelectorAll('tr[data-i]').forEach(tr => {
      tr.onmouseenter = () => { tr.style.background = 'var(--btn-hover, rgba(127,127,127,.2))'; };
      tr.onmouseleave = () => { tr.style.background = ''; };
      tr.onclick = () => { const p = rows[Number(tr.dataset.i)]; f.close(); if (p && typeof onPick === 'function') onPick(p); };
    });
  };
  search.oninput = fill;
  fill();
  search.focus();
}

// ---------- Edit Component Details ----------
const setField = (id, text) => {
  const el = document.getElementById(id);
  if (!el || el.disabled) return;
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

// A part saved with aux items and contact assignments brings them into the dialog (they belong to a parent).
async function bringExtras(p) {
  if (!document.getElementById('editCompIsParent')?.checked) { await appAlert(`${[p.make, p.model_no].filter(Boolean).join(' ') || 'This part'} has ${extraText(p.extra)} saved with it. Tick Is Parent to bring them in, then choose it again.`); return; }
  const has = document.querySelector('#auxItemsList .aux-item-row, #ownContactsList .contact-row');
  if (has && !(await appConfirm(`Replace the aux items and contacts on this part with the ${extraText(p.extra)} saved in the library?`))) return;
  if (typeof window.applyPartExtras === 'function') window.applyPartExtras(p.extra);
}

export function pickPartForEdit() {
  openPartsPicker((p) => {
    if (p.value) setField('editCompValue', p.value);
    setField('editCompMake', p.make);
    setField('editCompModel', p.model_no);
    // The description belongs to this component: only prefill it when empty, never overwrite one already written.
    if (!(document.getElementById('editCompDesc')?.value || '').trim()) setField('editCompDesc', p.description);
    if (p.extra) bringExtras(p);
  });
}

export async function savePartFromEdit() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const extra = typeof window.collectPartExtras === 'function' ? window.collectPartExtras() : null;
  const entry = { category: '', make: val('editCompMake'), model_no: val('editCompModel'), description: val('editCompDesc'), value: val('editCompValue'), extra };
  if (!entry.make && !entry.model_no && !entry.description) { await appAlert('Fill in the make, model / part number or description first.'); return; }
  await savePartEntry(entry);
}

// Adds a part to the library (with its aux items and contact assignments, when it has them). One with the same make and model no.
// is kept, its description never changed; the aux items and contacts are updated when asked.
export async function savePartEntry(entry) {
  if (!entry.make && !entry.model_no && !entry.description) { await appAlert('Fill in the make, model / part number or description first.'); return; }
  await load(false);
  const same = parts.find(p => p.make.toLowerCase() === entry.make.toLowerCase() && p.model_no.toLowerCase() === entry.model_no.toLowerCase());
  const name = same ? ([same.make, same.model_no].filter(Boolean).join(' ') || 'That part') : '';
  if (same) {
    if (entry.extra && JSON.stringify(entry.extra) !== JSON.stringify(same.extra)) {
      if (!(await appConfirm(`${name} is already in the parts library. Update its saved aux items and contacts (${extraText(entry.extra)})? Its library description is left unchanged.`))) return;
      const r = await post({ action: 'save', id: same.id, category: same.category, make: same.make, model_no: same.model_no, description: same.description, value: same.value, extra: entry.extra });
      if (!r.ok) { await appAlert(msg(r, 'The part could not be saved.')); return; }
      await load(true);
      await appAlert('Updated in the parts library.');
      return;
    }
    // A component's own description never changes the library entry.
    await appAlert(`${name} is already in the parts library. Its library description was left unchanged; edit it from Parts Library if needed.`);
    return;
  }
  const r = await post({ action: 'save', ...entry });
  if (!r.ok) { await appAlert(msg(r, 'The part could not be saved.')); return; }
  await load(true);
  await appAlert(entry.extra ? `Saved to the parts library with ${extraText(entry.extra)}.` : 'Saved to the parts library.');
}

// A picker for an auxiliary item's row (Type, Make, Model No., Description).
export function pickPartForAuxRow(row) {
  openPartsPicker((p) => {
    const set = (cls, text) => { const el = row.querySelector(cls); if (el) el.value = text; };
    if (p.category && !row.querySelector('.aux-type')?.value.trim()) set('.aux-type', p.category);
    set('.aux-make', p.make); set('.aux-model', p.model_no);
    if (!(row.querySelector('.aux-desc')?.value || '').trim()) set('.aux-desc', p.description);
  });
}

// ---------- files ----------
const FILE_COLUMNS = ['category', 'make', 'model_no', 'description', 'value'];
const CSV_HEAD = ['Category', 'Make', 'Model / Part No.', 'Description', 'Value'];

function toCsv(list, d) {
  const cell = (v) => { const s = String(v ?? ''); return (s.includes(d) || /["\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [CSV_HEAD.join(d)].concat(list.map(p => FILE_COLUMNS.map(k => cell(p[k])).join(d))).join('\r\n') + '\r\n';
}

function parseCsv(text) {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const d = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
  const idx = { category: col('categor', 'type'), make: col('make', 'manufact', 'mfr'), model_no: col('model', 'part', 'mfr no'), description: col('desc'), value: col('value', 'rating') };
  const hasHead = idx.make >= 0 || idx.model_no >= 0 || idx.description >= 0;
  const body = hasHead ? rows.slice(1) : rows;
  const at = (r, k, fb) => String((hasHead ? (idx[k] >= 0 ? r[idx[k]] : '') : r[fb]) ?? '').trim();
  return body.map(r => ({ category: at(r, 'category', 0), make: at(r, 'make', 1), model_no: at(r, 'model_no', 2), description: at(r, 'description', 3), value: at(r, 'value', 4) }));
}

function exportFile(kind) {
  if (!parts.length) { appAlert('There are no parts to export yet.'); return; }
  if (kind === 'csv') return saveTextFile('﻿' + toCsv(parts, ','), 'parts_library.csv', 'text/csv', 'Parts library (CSV)');
  return saveTextFile(JSON.stringify({ [FILE_MARKER]: 1, parts: parts.map(({ id, ...rest }) => rest) }, null, 2), 'parts_library.parts.json', 'application/json', 'Parts library (JSON)');
}

function importFile(done) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.csv,.txt';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { appAlert('That file is too large to be a parts library.'); return; }
    const r = new FileReader();
    r.onload = async () => {
      const text = String(r.result);
      let list = null;
      try { const obj = JSON.parse(text); if (obj && obj[FILE_MARKER] && Array.isArray(obj.parts)) list = obj.parts.map(norm); } catch (e) { /* not JSON: try CSV */ }
      if (!list && !/\.json$/i.test(file.name)) list = parseCsv(text);
      list = (list || []).filter(p => p.make || p.model_no || p.description);
      if (!list.length) { await appAlert('No parts were found in that file. Use a parts library file saved from here, or a CSV with Category, Make, Model / Part No., Description and Value columns.'); return; }
      if (!(await appConfirm(`Add ${list.length} part${list.length === 1 ? '' : 's'} from "${file.name}" to your library? A part with the same make and model no. is updated instead of added twice.`))) return;
      const res = await post({ action: 'import', parts: list });
      if (!res.ok) { await appAlert(msg(res, 'The parts could not be imported.')); return; }
      await load(true);
      await appAlert(`Imported: ${res.data.added} added, ${res.data.updated} updated${res.data.skipped ? `, ${res.data.skipped} skipped` : ''}.`);
      done();
    };
    r.readAsText(file);
  };
  inp.click();
}

// ---------- the library window ----------
export async function openPartsLibrary() {
  if (!(await load(true))) return;
  const f = frame('partsLibraryModal', 'Parts Library', 900, 'Parts you keep using, saved to your account. In <b>Edit Component Details</b> choose <i>From parts library</i> to fill in a part’s make, model and description, or <i>Save to parts library</i> to add what you have typed. Share a library as a file.');
  const form = document.createElement('div');
  form.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;';
  const inp = (key, ph, flex) => { const i = document.createElement('input'); i.type = 'text'; i.placeholder = ph; i.dataset.k = key; i.style.cssText = `flex:${flex};min-width:90px;`; i.setAttribute('autocomplete', 'off'); return i; };
  const catList = document.createElement('datalist');   // the categories already used, offered as a drop-down
  catList.id = 'partsCategoryList';
  const fields = [inp('category', 'Category (pick or type)', 1.2), inp('make', 'Make', 1), inp('model_no', 'Model / Part No.', 1), inp('description', 'Description', 1.6), inp('value', 'Value', 0.6)];
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Add part';
  const clearBtn = document.createElement('button'); clearBtn.type = 'button'; clearBtn.className = 'btn btn-ghost'; clearBtn.textContent = 'Clear'; clearBtn.style.display = 'none';
  fields[0].setAttribute('list', 'partsCategoryList');
  form.append(...fields, saveBtn, clearBtn, catList);
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;';
  const search = document.createElement('input'); search.type = 'text'; search.placeholder = 'Search…'; search.setAttribute('autocomplete', 'off'); search.style.cssText = 'flex:1;min-width:140px;';
  const mkBtn = (t, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost'; b.textContent = t; b.onclick = fn; return b; };
  bar.append(search, mkBtn('Import file', () => importFile(render)), mkBtn('Export file', () => exportFile('json')), mkBtn('Export CSV', () => exportFile('csv')));
  const count = document.createElement('div'); count.className = 'modal-hint'; count.style.margin = '0 0 4px';
  const list = document.createElement('div');
  list.style.cssText = 'overflow:auto;flex:1 1 auto;min-height:180px;border:1px solid var(--border);border-radius:6px;';
  f.body.append(form, bar, count, list);

  let editing = null;
  const note = document.createElement('div'); note.className = 'modal-hint'; note.style.cssText = 'display:none;margin:0 0 6px;font-weight:600;';
  form.after(note);
  const reset = () => { editing = null; fields.forEach(i => { i.value = ''; }); saveBtn.textContent = 'Add part'; clearBtn.textContent = 'Clear'; clearBtn.style.display = 'none'; note.style.display = 'none'; render(); };
  const startEdit = (p) => { editing = p; fields.forEach(i => { i.value = p[i.dataset.k] || ''; }); saveBtn.textContent = 'Save changes'; clearBtn.textContent = 'Cancel'; clearBtn.style.display = ''; note.textContent = `Changing: ${[p.make, p.model_no].filter(Boolean).join(' ') || p.description}`; note.style.display = ''; render(); form.scrollIntoView({ block: 'nearest' }); fields[1].focus(); };
  clearBtn.onclick = reset;
  saveBtn.onclick = async () => {
    const entry = {}; fields.forEach(i => { entry[i.dataset.k] = i.value.trim(); });
    if (!entry.make && !entry.model_no && !entry.description) { fields[1].focus(); return; }
    const r = await post({ action: 'save', id: editing ? editing.id : undefined, ...entry, extra: editing ? editing.extra : null });
    if (!r.ok) { await appAlert(msg(r, 'The part could not be saved.')); return; }
    await load(true); reset();
  };
  function render() {
    const cats = Array.from(new Set(parts.map(p => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    catList.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
    const q = search.value.trim().toLowerCase();
    const rows = parts.filter(p => matches(p, q));
    count.textContent = `${parts.length} part${parts.length === 1 ? '' : 's'}${q ? `, ${rows.length} shown` : ''}`;
    list.innerHTML = rows.length
      ? `<table style="width:100%;border-collapse:collapse;"><thead><tr>${['Category', 'Make', 'Model / Part No.', 'Description', 'Value', ''].map(h => `<th style="${cellStyle}font-weight:600;color:var(--text-muted);">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((p, i) => `<tr data-row="${i}" title="Double-click to change" style="${editing && editing.id === p.id ? 'background:var(--btn-hover, rgba(56,189,248,.18));' : ''}"><td style="${cellStyle}">${esc(p.category)}</td><td style="${cellStyle}">${esc(p.make)}</td><td style="${cellStyle}">${esc(p.model_no)}</td><td style="${cellStyle}">${esc(p.description)}${p.extra ? `<div style="color:var(--text-muted);font-size:11px;">+ ${esc(extraText(p.extra))}</div>` : ''}</td><td style="${cellStyle}">${esc(p.value)}</td><td style="${cellStyle}white-space:nowrap;"><button type="button" class="btn btn-ghost" data-act="edit" data-i="${i}" style="padding:1px 8px;font-size:11px;">Edit</button> <button type="button" class="btn btn-ghost" data-act="del" data-i="${i}" style="padding:1px 8px;font-size:11px;">Delete</button></td></tr>`).join('')}</tbody></table>`
      : `<div style="padding:14px;color:var(--text-muted);font-size:13px;">${parts.length ? 'No parts match.' : 'No parts yet. Add one above, or import a file.'}</div>`;
    list.querySelectorAll('tr[data-row]').forEach(tr => { tr.ondblclick = () => { const p = rows[Number(tr.dataset.row)]; if (p) startEdit(p); }; });
    list.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = async () => {
        const p = rows[Number(b.dataset.i)];
        if (!p) return;
        if (b.dataset.act === 'edit') { startEdit(p); return; }
        if (!(await appConfirm(`Delete ${[p.make, p.model_no].filter(Boolean).join(' ') || 'this part'} from the library? Parts already used in projects are not changed.`))) return;
        const r = await post({ action: 'delete', id: p.id });
        if (!r.ok) { await appAlert(msg(r, 'It could not be deleted.')); return; }
        await load(true); if (editing && editing.id === p.id) reset(); render();
      };
    });
  }
  search.oninput = render;
  render();
}
