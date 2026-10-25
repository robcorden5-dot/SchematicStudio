// ==========================================
// 26. TITLE BLOCK DESIGNER (screen code for a custom title block, Pro)
// ==========================================
// A drawing board for the template objects in 25_title_block.js. It is plain SVG and HTML (no Konva),
// edits a copy, and only changes the project when Apply is pressed.
import { state, getActiveSheet, getSchematicSheetNumber, getTotalSchematicSheets, appConfirm, scheduleAutosave, isFreePlan } from './1_config_state.js';
import { renderSheetBorder } from './3_schematic_engine.js';
import {
  TB_STANDARD, TB_ISO7200, TB_LIMITS, TB_SIZES, cleanTemplate, cloneTemplate, cleanTitleBlockSettings, titleBlockValues
} from './25_title_block.js';

const FIELDS = [
  ['title', 'Sheet title'], ['description', 'Description'], ['author', 'Created by'], ['approvedBy', 'Approved by'],
  ['createdDate', 'Date'], ['rev', 'Revision (from the log)'], ['sheetLabel', 'SHEET or PANEL'], ['sheetNum', 'Sheet number'],
  ['sheetTotal', 'Total sheets'], ['docNumber', 'Document / identification number'], ['docType', 'Document type'],
  ['docStatus', 'Document status'], ['language', 'Language'], ['legalOwner', 'Legal owner'], ['projectNumber', 'Project number'],
  ['customer', 'Customer'], ['site', 'Site'], ['locationTag', 'Location (+CP)'],
  ['functionTag', 'Function (=P1)'], ['sheetRef', 'Function and location (=P1+CP)']
];
const SNAPS = [['1', 'Snap 1'], ['2', 'Snap 2'], ['5', 'Snap 5'], ['10', 'Snap 10'], ['0', 'Snap off']];
const SIZE_LABEL = { default: 'All sizes', A4: 'A4', A3: 'A3', A2: 'A2' };

let draft = null;        // { default, A4, A3, A2 } - each a template or null
let cur = 'default';     // the layout being edited
let sel = -1;            // selected item index, 'logo', or -1
let snap = 5;
let showNames = false;
let values = null;
let svg = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fillText = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined || v[k] === null) ? '' : String(v[k]));
const layout = () => draft[cur];
const snapTo = (n) => snap ? Math.round(n / snap) * snap : Math.round(n * 10) / 10;

export function openTitleBlockDesigner() {
  if (isFreePlan()) return;
  const tb = state.titleBlock || {};
  const c = tb.custom || {};
  draft = { default: null, A4: null, A3: null, A2: null };
  if (c.default) {
    draft.default = cloneTemplate(c.default);
    TB_SIZES.forEach(sz => { if (c[sz]) draft[sz] = cloneTemplate(c[sz]); });
  } else {
    // start from whichever block is showing now
    const from = tb.templateId === 'iso7200' ? TB_ISO7200 : TB_STANDARD;
    draft.default = cleanTemplate(cloneTemplate(from));
  }
  cur = 'default'; sel = -1;
  const sheet = getActiveSheet();
  values = sheet ? titleBlockValues(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets()) : {};
  $('tbDesigner').style.display = 'flex';
  buildChrome();
  draw();
  props();
}

// For the template file / saved-designs code (27_title_block_library.js): the layouts on the board, and a way to replace them.
export const designerOpen = () => !!draft;
export function getDraftLayouts() {
  if (!draft) return null;
  const out = {};
  ['default', ...TB_SIZES].forEach(k => { if (draft[k]) out[k] = cloneTemplate(draft[k]); });
  return out;
}
export function setDraftLayouts(custom) {
  if (!draft || !custom || !custom.default) return;
  draft = { default: null, A4: null, A3: null, A2: null };
  draft.default = cloneTemplate(custom.default);
  TB_SIZES.forEach(sz => { if (custom[sz]) draft[sz] = cloneTemplate(custom[sz]); });
  cur = 'default'; sel = -1;
  buildChrome(); draw(); props();
}

export function closeTitleBlockDesigner() {
  $('tbDesigner').style.display = 'none';
  draft = null;
}

export function applyTitleBlockDesign() {
  if (!draft) return;
  const custom = {};
  ['default', ...TB_SIZES].forEach(k => { if (draft[k]) custom[k] = draft[k]; });
  state.titleBlock = cleanTitleBlockSettings({ templateId: 'custom', custom });
  const sheet = getActiveSheet();
  if (sheet) renderSheetBorder(sheet, getSchematicSheetNumber(state.activeSheetIndex), getTotalSchematicSheets());
  scheduleAutosave();
  closeTitleBlockDesigner();
  if (typeof window.openProjectInfoModal === 'function' && $('projectInfoModal').style.display === 'flex') window.openProjectInfoModal();
}

// ---------- toolbar ----------
function buildChrome() {
  const sizeOpts = ['default', ...TB_SIZES].map(k => `<option value="${k}">${SIZE_LABEL[k]}${k !== 'default' && draft[k] ? ' (own layout)' : ''}</option>`).join('');
  $('tbdBar').innerHTML = `
    <label>Layout for <select id="tbdLayout">${sizeOpts}</select></label>
    <span class="tbd-sep"></span>
    <button type="button" class="btn btn-ghost" data-add="cell">+ Field</button>
    <button type="button" class="btn btn-ghost" data-add="text">+ Text</button>
    <button type="button" class="btn btn-ghost" data-add="line">+ Line</button>
    <button type="button" class="btn btn-ghost" data-add="rect">+ Box</button>
    <button type="button" class="btn btn-ghost" data-add="logo">+ Logo</button>
    <span class="tbd-sep"></span>
    <select id="tbdSnap">${SNAPS.map(([v, l]) => `<option value="${v}"${Number(v) === snap ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <label class="tbd-check"><input type="checkbox" id="tbdNames"${showNames ? ' checked' : ''}> Show field names</label>`;
  $('tbdLayout').value = cur;
  $('tbdLayout').onchange = (e) => { cur = e.target.value; sel = -1; buildChrome(); draw(); props(); };
  $('tbdSnap').onchange = (e) => { snap = Number(e.target.value); };
  $('tbdNames').onchange = (e) => { showNames = e.target.checked; draw(); };
  $('tbdBar').querySelectorAll('[data-add]').forEach(b => { b.onclick = () => addItem(b.dataset.add); });
}

function addItem(kind) {
  const t = layout();
  if (!t) return;
  if (t.items.length >= TB_LIMITS.maxItems) return;
  const x = snapTo(10), y = snapTo(10);
  if (kind === 'logo') { if (!t.logo) t.logo = { x, y, w: 60, h: 60, pad: 4, center: true }; sel = 'logo'; }
  else {
    const it = kind === 'cell' ? { t: 'cell', x, y, w: 100, h: 28, label: 'LABEL', text: '{title}', size: 10, bold: false, wrap: false }
      : kind === 'text' ? { t: 'text', x, y, text: 'Text {title}', size: 10, bold: false }
      : kind === 'line' ? { t: 'line', pts: [x, y, x + 80, y], sw: 1 }
      : { t: 'rect', x, y, w: 80, h: 30, sw: 1, fill: null };
    t.items.push(it); sel = t.items.length - 1;
  }
  draw(); props();
}

// ---------- the drawing board ----------
const clip = (n) => `tbdclip${n}`;
function draw() {
  const host = $('tbdCanvas');
  const own = layout();
  const t = own || draft.default;
  const pad = 14, W = t.width + pad * 2, H = t.height + pad * 2;
  let body = '';
  // grid
  const gs = snap || 10;
  body += `<rect x="0" y="0" width="${t.width}" height="${t.height}" fill="#fff"/>`;
  for (let x = gs; x < t.width; x += gs) body += `<line x1="${x}" y1="0" x2="${x}" y2="${t.height}" stroke="#e2e8f0" stroke-width="0.3"/>`;
  for (let y = gs; y < t.height; y += gs) body += `<line x1="0" y1="${y}" x2="${t.width}" y2="${y}" stroke="#e2e8f0" stroke-width="0.3"/>`;
  if (t.logo) {
    const L = t.logo;
    body += `<g data-i="logo" style="cursor:move"><rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="4 3"/><text x="${L.x + L.w / 2}" y="${L.y + L.h / 2 + 3}" font-size="9" text-anchor="middle" fill="#64748b" font-family="Arial">LOGO</text></g>`;
  }
  const show = (s) => showNames ? String(s || '') : fillText(s, values || {});
  t.items.forEach((it, i) => {
    let g = '';
    if (it.t === 'rect') {
      g = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${it.fill || 'none'}" stroke="${it.sw ? '#000' : 'none'}" stroke-width="${it.sw}" pointer-events="all"/>`;
    } else if (it.t === 'line') {
      g = `<line x1="${it.pts[0]}" y1="${it.pts[1]}" x2="${it.pts[2]}" y2="${it.pts[3]}" stroke="#000" stroke-width="${it.sw}"/><line x1="${it.pts[0]}" y1="${it.pts[1]}" x2="${it.pts[2]}" y2="${it.pts[3]}" stroke="transparent" stroke-width="8"/>`;
    } else if (it.t === 'text') {
      g = `<text x="${it.x}" y="${it.y + it.size * 0.85}" font-size="${it.size}" font-family="Arial" font-weight="${it.bold ? 700 : 400}">${esc(show(it.text))}</text>`;
    } else if (it.t === 'cell') {
      const top = it.label ? 11 : 4;
      g = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="#fff" fill-opacity="0.01" stroke="#000" stroke-width="1"/>` +
        (it.label ? `<text x="${it.x + 3}" y="${it.y + 2 + 6.5 * 0.85}" font-size="6.5" font-family="Arial" fill="#475569">${esc(show(it.label))}</text>` : '') +
        `<svg x="${it.x + 4}" y="${it.y + top}" width="${Math.max(1, it.w - 8)}" height="${Math.max(1, it.h - top - 2)}"><text x="0" y="${it.size * 0.85}" font-size="${it.size}" font-family="Arial" font-weight="${it.bold ? 700 : 400}">${esc(show(it.text))}</text></svg>`;
    }
    body += `<g data-i="${i}" style="cursor:move">${g}</g>`;
  });
  // selection
  if (own && sel !== -1) {
    const it = sel === 'logo' ? t.logo : t.items[sel];
    if (it) {
      if (it.t === 'line') {
        body += `<rect class="tbd-h" data-h="p0" x="${it.pts[0] - 3}" y="${it.pts[1] - 3}" width="6" height="6"/><rect class="tbd-h" data-h="p1" x="${it.pts[2] - 3}" y="${it.pts[3] - 3}" width="6" height="6"/>`;
      } else {
        const b = bounds(it);
        body += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#2563eb" stroke-width="1.2" stroke-dasharray="3 2" pointer-events="none"/>`;
        if (it.t === 'rect' || it.t === 'cell' || sel === 'logo') body += `<rect class="tbd-h" data-h="br" x="${b.x + b.w - 3}" y="${b.y + b.h - 3}" width="6" height="6"/>`;
      }
    }
  }
  body += `<rect x="0" y="0" width="${t.width}" height="${t.height}" fill="none" stroke="#475569" stroke-width="0.6" stroke-dasharray="2 2" pointer-events="none"/>`;
  host.innerHTML = `<svg id="tbdSvg" viewBox="${-pad} ${-pad} ${W} ${H}" width="100%" style="max-width:${Math.max(560, W * 1.6)}px;touch-action:none"><g>${body}</g></svg>` +
    (own ? '' : `<div class="tbd-note">${SIZE_LABEL[cur]} uses the main layout. <button type="button" class="btn btn-ghost" id="tbdOwn">Give ${SIZE_LABEL[cur]} its own layout</button></div>`);
  svg = $('tbdSvg');
  if (!own) $('tbdOwn').onclick = () => { draft[cur] = cloneTemplate(draft.default); sel = -1; buildChrome(); draw(); props(); };
  if (own) wire();
}

function bounds(it) {
  if (it.t === 'text') return { x: it.x - 1, y: it.y - 1, w: Math.max(10, String(fillText(it.text, values || {})).length * it.size * 0.55) + 2, h: it.size * 1.25 + 2 };
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

function pt(e) {
  const m = svg.getScreenCTM().inverse();
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(m);
  return { x: q.x, y: q.y };
}

function wire() {
  svg.onpointerdown = (e) => {
    const t = layout();
    const h = e.target.closest && e.target.closest('[data-h]');
    const g = e.target.closest && e.target.closest('[data-i]');
    const start = pt(e);
    if (h) { startDrag(e, start, 'handle', h.dataset.h); return; }
    if (g) {
      const k = g.dataset.i === 'logo' ? 'logo' : Number(g.dataset.i);
      if (sel !== k) { sel = k; draw(); props(); }
      startDrag(e, start, 'move');
      return;
    }
    if (sel !== -1) { sel = -1; draw(); props(); }
  };
}

function startDrag(e, start, mode, which) {
  const t = layout();
  const it = sel === 'logo' ? t.logo : t.items[sel];
  if (!it) return;
  const orig = JSON.parse(JSON.stringify(it));
  svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
  const mv = (ev) => {
    const p = pt(ev), dx = p.x - start.x, dy = p.y - start.y;
    if (mode === 'move') {
      if (it.t === 'line') {
        const ox = snapTo(dx), oy = snapTo(dy);
        it.pts = [orig.pts[0] + ox, orig.pts[1] + oy, orig.pts[2] + ox, orig.pts[3] + oy];
      } else { it.x = snapTo(orig.x + dx); it.y = snapTo(orig.y + dy); }
    } else if (which === 'br') {
      it.w = Math.max(8, snapTo(orig.w + dx)); it.h = Math.max(8, snapTo(orig.h + dy));
    } else if (which === 'p0') { it.pts[0] = snapTo(orig.pts[0] + dx); it.pts[1] = snapTo(orig.pts[1] + dy); }
    else if (which === 'p1') { it.pts[2] = snapTo(orig.pts[2] + dx); it.pts[3] = snapTo(orig.pts[3] + dy); }
    clampItem(it, t);
    draw();
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    props();
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

function clampItem(it, t) {
  const cx = (v) => Math.min(TB_LIMITS.maxW, Math.max(0, v)), cy = (v) => Math.min(TB_LIMITS.maxH, Math.max(0, v));
  if (it.pts) { it.pts = [cx(it.pts[0]), cy(it.pts[1]), cx(it.pts[2]), cy(it.pts[3])]; }
  else { it.x = cx(it.x); it.y = cy(it.y); }
}

// ---------- properties ----------
function props() {
  const host = $('tbdProps');
  const t = layout();
  if (!t) { host.innerHTML = '<div class="modal-hint">Give this paper size its own layout to edit it.</div>'; return; }
  const row = (label, k, val, type = 'number', extra = '') => `<label>${label}<input type="${type}" data-k="${k}" value="${esc(val)}" ${extra}></label>`;
  let html = `<div class="tbd-h3">Block</div><div class="modal-row">${row('Width', 'W', t.width, 'number', `min="${TB_LIMITS.minW}" max="${TB_LIMITS.maxW}"`)}${row('Height', 'H', t.height, 'number', `min="${TB_LIMITS.minH}" max="${TB_LIMITS.maxH}"`)}</div>`;
  const it = sel === 'logo' ? t.logo : (sel === -1 ? null : t.items[sel]);
  if (!it) {
    html += '<div class="tbd-h3">Layout</div><div class="modal-hint">Click an item on the board to edit it, drag to move it, drag the square handle to resize.</div>';
    html += `<div class="tbd-btns">
      <button type="button" class="btn btn-ghost" id="tbdPresetStd">Start again from Standard</button>
      <button type="button" class="btn btn-ghost" id="tbdPresetIso">Start again from ISO 7200</button>
      ${cur !== 'default' ? '<button type="button" class="btn btn-ghost" id="tbdUseMain">Use the main layout for ' + SIZE_LABEL[cur] + '</button>' : ''}
    </div>`;
  } else {
    const kind = sel === 'logo' ? 'Logo box' : { cell: 'Field', text: 'Text', line: 'Line', rect: 'Box' }[it.t];
    html += `<div class="tbd-h3">${kind}</div>`;
    if (it.t === 'cell') {
      html += row('Caption', 'label', it.label, 'text', 'maxlength="40"');
      html += fieldText('Value', it.text);
      html += `<div class="modal-row">${row('Size', 'size', it.size)}<div class="tbd-checks"><label class="tbd-check"><input type="checkbox" data-k="bold"${it.bold ? ' checked' : ''}> Bold</label><label class="tbd-check"><input type="checkbox" data-k="wrap"${it.wrap ? ' checked' : ''}> Wrap</label></div></div>`;
      html += `<div class="modal-row">${row('X', 'x', it.x)}${row('Y', 'y', it.y)}</div><div class="modal-row">${row('Width', 'w', it.w)}${row('Height', 'h', it.h)}</div>`;
    } else if (it.t === 'text') {
      html += fieldText('Text', it.text);
      html += `<div class="modal-row">${row('Size', 'size', it.size)}<div class="tbd-checks"><label class="tbd-check"><input type="checkbox" data-k="bold"${it.bold ? ' checked' : ''}> Bold</label></div></div>`;
      html += `<div class="modal-row">${row('X', 'x', it.x)}${row('Y', 'y', it.y)}</div>`;
    } else if (it.t === 'line') {
      html += `<div class="modal-row">${row('X1', 'p0', it.pts[0])}${row('Y1', 'p1', it.pts[1])}</div><div class="modal-row">${row('X2', 'p2', it.pts[2])}${row('Y2', 'p3', it.pts[3])}</div>${row('Thickness', 'sw', it.sw, 'number', 'step="0.5"')}`;
    } else if (it.t === 'rect') {
      html += `<div class="modal-row">${row('X', 'x', it.x)}${row('Y', 'y', it.y)}</div><div class="modal-row">${row('Width', 'w', it.w)}${row('Height', 'h', it.h)}</div>${row('Border', 'sw', it.sw, 'number', 'step="0.5"')}<label class="tbd-check"><input type="checkbox" data-k="white"${it.fill ? ' checked' : ''}> White fill</label>`;
    } else {   // logo
      html += `<div class="modal-row">${row('X', 'x', it.x)}${row('Y', 'y', it.y)}</div><div class="modal-row">${row('Width', 'w', it.w)}${row('Height', 'h', it.h)}</div><div class="modal-row">${row('Margin', 'pad', it.pad)}<div class="tbd-checks"><label class="tbd-check"><input type="checkbox" data-k="center"${it.center ? ' checked' : ''}> Centre it</label></div></div>`;
    }
    html += `<div class="tbd-btns">
      ${sel === 'logo' ? '' : '<button type="button" class="btn btn-ghost" id="tbdDup">Duplicate</button><button type="button" class="btn btn-ghost" id="tbdUp">Bring forward</button><button type="button" class="btn btn-ghost" id="tbdDown">Send back</button>'}
      <button type="button" class="btn btn-ghost" id="tbdDel">Delete</button></div>`;
  }
  host.innerHTML = html;
  const bound = cur;
  host.querySelectorAll('[data-k]').forEach(inp => {
    inp.oninput = () => edit(inp);
    // on leaving a box, show the value that was actually kept (a width of 5000 becomes 700)
    inp.onchange = () => {
      if (!draft || cur !== bound || inp.type === 'checkbox' || inp.tagName === 'SELECT') return;
      const v = keptValue(inp.dataset.k);
      if (v !== undefined && String(v) !== inp.value && inp.type === 'number') inp.value = v;
    };
  });
  const fld = host.querySelector('#tbdField');
  if (fld) fld.onchange = () => {
    const box = host.querySelector('[data-k="text"]'); if (!fld.value || !box) return;
    box.value += `{${fld.value}}`; fld.value = ''; edit(box);
  };
  const on = (id, fn) => { const b = host.querySelector('#' + id); if (b) b.onclick = fn; };
  on('tbdDel', () => { if (sel === 'logo') t.logo = null; else t.items.splice(sel, 1); sel = -1; draw(); props(); });
  on('tbdDup', () => { const c = JSON.parse(JSON.stringify(t.items[sel])); if (c.pts) c.pts = c.pts.map(v => v + 10); else { c.x += 10; c.y += 10; } t.items.push(c); sel = t.items.length - 1; clampItem(c, t); draw(); props(); });
  on('tbdUp', () => { if (sel < t.items.length - 1) { [t.items[sel], t.items[sel + 1]] = [t.items[sel + 1], t.items[sel]]; sel++; draw(); props(); } });
  on('tbdDown', () => { if (sel > 0) { [t.items[sel], t.items[sel - 1]] = [t.items[sel - 1], t.items[sel]]; sel--; draw(); props(); } });
  on('tbdUseMain', () => { draft[cur] = null; sel = -1; buildChrome(); draw(); props(); });
  const preset = (src, name) => async () => {
    if (!(await appConfirm(`Replace this layout with the ${name} block? Your changes to it will be lost.`))) return;
    draft[cur] = cleanTemplate(cloneTemplate(src)); sel = -1; draw(); props();
  };
  on('tbdPresetStd', preset(TB_STANDARD, 'Standard'));
  on('tbdPresetIso', preset(TB_ISO7200, 'ISO 7200'));
}

// What the model holds for a properties box (so a typed 5000 can show as the 700 that was kept).
function keptValue(k) {
  const t = layout();
  if (!t) return undefined;
  if (k === 'W') return t.width;
  if (k === 'H') return t.height;
  const it = sel === 'logo' ? t.logo : (sel === -1 ? null : t.items[sel]);
  if (!it) return undefined;
  if (/^p[0-3]$/.test(k)) return it.pts && it.pts[Number(k[1])];
  return it[k];
}

function fieldText(label, val) {
  return `<label>${label}<input type="text" data-k="text" value="${esc(val)}" maxlength="${TB_LIMITS.text}"></label>
    <select id="tbdField"><option value="">Insert a field&hellip;</option>${FIELDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
}

function edit(inp) {
  const t = draft && layout();
  if (!t) return;
  const it = sel === 'logo' ? t.logo : t.items[sel];
  const k = inp.dataset.k, isCheck = inp.type === 'checkbox';
  if (k === 'W' || k === 'H') {
    const n = Number(inp.value);
    if (!Number.isFinite(n)) return;
    if (k === 'W') t.width = Math.min(TB_LIMITS.maxW, Math.max(TB_LIMITS.minW, n)); else t.height = Math.min(TB_LIMITS.maxH, Math.max(TB_LIMITS.minH, n));
    draw(); return;
  }
  if (!it) return;
  if (['label', 'text'].includes(k)) it[k] = inp.value;
  else if (isCheck) { if (k === 'white') it.fill = inp.checked ? '#fff' : null; else it[k] = inp.checked; }
  else {
    const n = Number(inp.value);
    if (!Number.isFinite(n)) return;
    if (/^p[0-3]$/.test(k)) it.pts[Number(k[1])] = n; else it[k] = n;
  }
  const clean = cleanTemplate({ ...t, items: sel === 'logo' ? t.items : t.items.map((x, i) => i === sel ? it : x) });
  // keep what was typed within the allowed ranges
  if (clean) {
    if (sel === 'logo') draft[cur].logo = clean.logo;
    else draft[cur].items[sel] = clean.items[sel];
  }
  draw();
}
