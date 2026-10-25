// ==========================================
// 27. TITLE BLOCK TEMPLATES (files and saved designs, screen code)
// ==========================================
// Share a design as a file, and keep designs in the account (Pro) to reuse in any project.
// A design here is the set of layouts on the designer's board: { default, A4, A3, A2 }.
import { appAlert, appConfirm, appPrompt, saveTextFile } from './1_config_state.js';
import { cleanTitleBlockSettings, TB_SIZES } from './25_title_block.js';
import { getDraftLayouts, setDraftLayouts, designerOpen } from './26_title_block_designer.js';

const FILE_MARKER = 'schematicStudioTitleBlock';
const MAX_FILE_BYTES = 300000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A design read from a file or the server, made safe. Returns the custom layouts, or null.
function readDesign(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.layouts || raw.custom;
  if (!src || typeof src !== 'object') return null;
  const c = cleanTitleBlockSettings({ templateId: 'custom', custom: src }).custom;
  return c && c.default ? c : null;
}
const toData = () => ({ layouts: getDraftLayouts() });
const safeName = (n) => String(n || 'title-block').replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'title-block';

function fileText(name, layouts) {
  return JSON.stringify({ [FILE_MARKER]: 1, name, layouts }, null, 2);
}

// ---------- files ----------
export async function exportTitleBlockFile() {
  if (!designerOpen()) return;
  const name = await appPrompt('Name this title block design:', 'My title block', 'Export title block');
  if (name === null) return;
  const clean = String(name).trim().slice(0, 80) || 'My title block';
  await saveTextFile(fileText(clean, getDraftLayouts()), `${safeName(clean)}.titleblock.json`, 'application/json', 'Title block design (JSON)');
}

export function importTitleBlockFile() {
  if (!designerOpen()) return;
  const inp = $('tbdFileInput');
  inp.value = '';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { appAlert('That file is too large to be a title block design.'); return; }
    const r = new FileReader();
    r.onload = async () => {
      let obj = null;
      try { obj = JSON.parse(String(r.result)); } catch (e) { /* not JSON */ }
      const design = obj && obj[FILE_MARKER] ? readDesign(obj) : null;
      if (!design) { appAlert('That file is not a SchematicStudio title block design.'); return; }
      const name = String(obj.name || f.name).slice(0, 80);
      if (!(await appConfirm(`Replace the design on the board with "${name}"? Nothing changes in the project until you press Apply.`))) return;
      setDraftLayouts(design);
    };
    r.readAsText(f);
  };
  inp.click();
}

// ---------- saved designs (account) ----------
let list = [];
let max = 25;

async function api(options) {
  const headers = { 'X-CSRF-Token': window.csrfToken || '' };
  if (options && options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/titleblocks/api.php', Object.assign({ credentials: 'same-origin', headers }, options));
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { ok: res.ok && data && data.success, data };
}

async function refresh() {
  const host = $('tbtList');
  host.innerHTML = '<div class="modal-hint">Loading&hellip;</div>';
  let r;
  try { r = await api({}); } catch (e) { r = { ok: false, data: null }; }
  if (!r.ok) { host.innerHTML = `<div class="modal-hint">${esc((r.data && r.data.message) || 'Could not reach the server. Check your connection and try again.')}</div>`; list = []; return; }
  list = r.data.templates || []; max = r.data.max || 25;
  if (!list.length) { host.innerHTML = '<div class="modal-hint">Nothing saved yet. Name the design on the board above and press Save.</div>'; return; }
  host.innerHTML = list.map((t, i) => `<div class="tbt-row"><div class="tbt-name">${esc(t.name)}<span>${esc(String(t.updated_at || '').slice(0, 10))}</span></div>
    <button type="button" class="btn btn-ghost" data-act="load" data-i="${i}">Use</button>
    <button type="button" class="btn btn-ghost" data-act="file" data-i="${i}">File</button>
    <button type="button" class="btn btn-ghost" data-act="del" data-i="${i}">Delete</button></div>`).join('');
  host.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => rowAction(b.dataset.act, list[Number(b.dataset.i)]); });
}

async function rowAction(act, t) {
  if (!t) return;
  if (act === 'load') {
    const design = readDesign(t.data);
    if (!design) { appAlert('That saved design could not be read.'); return; }
    if (!(await appConfirm(`Replace the design on the board with "${t.name}"? Nothing changes in the project until you press Apply.`))) return;
    setDraftLayouts(design); closeTitleBlockTemplates();
  } else if (act === 'file') {
    const design = readDesign(t.data);
    if (design) await saveTextFile(fileText(t.name, design), `${safeName(t.name)}.titleblock.json`, 'application/json', 'Title block design (JSON)');
  } else if (act === 'del') {
    if (!(await appConfirm(`Delete the saved design "${t.name}"? This cannot be undone.`))) return;
    const r = await api({ method: 'POST', body: JSON.stringify({ action: 'delete', id: t.id }) });
    if (!r.ok) appAlert((r.data && r.data.message) || 'Could not delete it.');
    refresh();
  }
}

export async function saveTitleBlockTemplate() {
  const input = $('tbtName');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const exists = list.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (exists && !(await appConfirm(`You already have a design called "${exists.name}". Replace it?`))) return;
  const r = await api({ method: 'POST', body: JSON.stringify({ action: 'save', name, data: toData() }) });
  if (!r.ok) { appAlert((r.data && r.data.message) || 'Could not save it.'); return; }
  input.value = '';
  refresh();
}

export function openTitleBlockTemplates() {
  if (!designerOpen()) return;
  $('tbtModal').style.display = 'flex';
  refresh();
}
export function closeTitleBlockTemplates() { $('tbtModal').style.display = 'none'; }
