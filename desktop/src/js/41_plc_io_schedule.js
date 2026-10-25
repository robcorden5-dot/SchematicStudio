// ==========================================
// 41. PLC I/O SCHEDULE (Reports)
// ==========================================
// Every input and output of every PLC module placed on the schematic sheets, one row each: the module, its address, whether it is
// a digital or analogue input or output, the function, the wire connected to it, what that wire goes to, and where on the sheet it
// is. Channels with no wire are listed too (they are the spares), unless "Wired only" is chosen. Saved as a CSV or printed.

import { state, saveTextFile, getSchematicSheetNumber, getRefText, getPageType, flipSX, flipSY, appAlert } from './1_config_state.js';
import { plcChannels, plcFunctionFor, PLC_SIGNAL_TYPES } from './16_plc_modules.js';
import { pinAt, endText } from './28_wire_markers.js';
import { findOpenWireEndpoints } from './3_schematic_engine.js';

const TOL = 1.5;

function pinWorld(comp, pin) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  return { x: comp.x + flipSX(comp) * pin.relX * c - flipSY(comp) * pin.relY * s, y: comp.y + flipSX(comp) * pin.relX * s + flipSY(comp) * pin.relY * c };
}

const near = (x, y, q) => Math.abs(x - q.x) <= TOL && Math.abs(y - q.y) <= TOL;

// The wire(s) ending exactly on a point: [{ wire, far: {x, y} }]
function wiresAt(sheet, q) {
  const out = [];
  (sheet.wires || []).forEach(w => {
    const p = w.points;
    if (!p || p.length < 4) return;
    if (near(p[0], p[1], q)) out.push({ wire: w, far: { x: p[p.length - 2], y: p[p.length - 1] } });
    if (near(p[p.length - 2], p[p.length - 1], q)) out.push({ wire: w, far: { x: p[0], y: p[1] } });
  });
  return out;
}

// The first devices on the net a wire belongs to, on this sheet: every wire joined to it (end to end, or a wire ending part-way
// along another), up to the pins they reach. A net does not run on through a pin: that device is as far as it goes.
function onSegment(w, x, y) {
  const p = w.points || [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2));
    if (Math.hypot(x1 + t * dx - x, y1 + t * dy - y) <= TOL) return true;
  }
  return false;
}

function walkNet(sheet, startWire, from, plcComp) {
  const net = new Set([startWire]);
  const ends = (w) => { const p = w.points; return [{ x: p[0], y: p[1] }, { x: p[p.length - 2], y: p[p.length - 1] }]; };
  const atPin = (q) => pinAt(sheet, q.x, q.y);
  let grew = true;
  while (grew) {
    grew = false;
    (sheet.wires || []).forEach(w => {
      if (net.has(w) || !w.points || w.points.length < 4) return;
      const mine = ends(w);
      const joins = Array.from(net).some(n => {
        const theirs = ends(n);
        return mine.some(m => !atPin(m) && (theirs.some(t => near(m.x, m.y, t)) || onSegment(n, m.x, m.y))) ||
          theirs.some(t => !atPin(t) && onSegment(w, t.x, t.y));
      });
      if (joins) { net.add(w); grew = true; }
    });
  }
  const devices = [], open = [], seen = new Set();
  net.forEach(w => ends(w).forEach(q => {
    if (near(q.x, q.y, from) && w === startWire) return;   // the PLC's own pin
    const hit = atPin(q);
    if (hit) {
      if (hit.comp === plcComp) return;
      const t = endText(hit, sheet);
      if (t && !seen.has(t)) { seen.add(t); devices.push(t); }
    } else if (w.wireId && !Array.from(net).some(n => n !== w && onSegment(n, q.x, q.y))) open.push(w.wireId);
  }));
  return { devices, open };
}

// Where a wire goes from the PLC: the first devices on its net. When the net runs off this sheet (an open end), the same
// wire ID is followed onto the other sheet(s) and the first devices there are named.
function destinationOf(sheet, sIdx, hit, plcComp, from) {
  const here = walkNet(sheet, hit.wire, from, plcComp);
  let found = here.devices.slice();
  const ids = Array.from(new Set(here.open.concat(hit.wire.wireId ? [hit.wire.wireId] : [])));
  if (!found.length && ids.length) {
    const openMap = findOpenWireEndpoints();
    ids.forEach(id => (openMap.get(id) || []).forEach(m => {
      const other = state.sheets[m.sheetIdx];
      if (!other || m.sheetIdx === sIdx || m.wire === hit.wire) return;
      walkNet(other, m.wire, { x: m.x, y: m.y }, null).devices.forEach(t => { if (!found.includes(t)) found.push(t); });
    }));
  }
  // a shared net (a supply or common feeding many devices): name the net rather than list every device on it
  if (found.length > 2) return hit.wire.wireId ? String(hit.wire.wireId) : found.slice(0, 2).join(', ') + ', …';
  return found.join(', ');
}

const typeText = (side, kind) => {
  const t = PLC_SIGNAL_TYPES[kind] || PLC_SIGNAL_TYPES.digital;
  return kind === 'comms' || kind === 'other' ? t.label : `${t.label} ${side === 'in' ? 'input' : 'output'}`;
};

export function buildPlcSchedule({ module = '', wiredOnly = false } = {}) {
  const rows = [];
  const modules = [];
  (state.sheets || []).forEach((sheet, sIdx) => {
    if (getPageType(sheet) !== 'schematic') return;
    (sheet.components || []).forEach(comp => {
      const def = window.customSymbolDefinitions && window.customSymbolDefinitions[comp.type];
      if (!def || !def.plc) return;
      const key = String(comp.id);
      modules.push({ key, label: comp.label || def.prefix || 'PLC', model: def.plc.model || def.name || '' });
      if (module && module !== key) return;
      const pins = Array.isArray(def.pins) ? def.pins : [];
      plcChannels(def).forEach((ch, order) => {
        const pin = pins.find(p => (p.name || p.id) === ch.address);
        let wireId = '', to = '', ref = '';
        if (pin) {
          const q = pinWorld(comp, pin);
          ref = getRefText(q.x, q.y, sIdx);
          const hits = wiresAt(sheet, q);
          if (hits.length) {
            const hit = hits.find(h => h.wire.wireId) || hits[0];
            wireId = hit.wire.wireId ? String(hit.wire.wireId) : '';
            to = destinationOf(sheet, sIdx, hit, comp, q);
          }
        }
        if (wiredOnly && !wireId && !to) return;
        rows.push({
          module: comp.label || def.prefix || 'PLC', model: def.plc.model || '',
          sheet: getSchematicSheetNumber(sIdx),
          address: ch.address,
          type: typeText(ch.side, ch.kind),
          fn: plcFunctionFor(comp, ch.address, ch.fn || ''),
          wireId, to, ref, _order: order
        });
      });
      // a relay common is listed too, with the net it is on rather than the devices
      (Array.isArray(def.plc.supplies) ? def.plc.supplies : []).forEach((sp, i) => {
        if (!sp || sp.type !== 'relay_common') return;
        const pin = pins.find(p => (p.name || p.id) === sp.name);
        let wireId = '', ref = '';
        if (pin) {
          const q = pinWorld(comp, pin);
          ref = getRefText(q.x, q.y, sIdx);
          const hits = wiresAt(sheet, q);
          if (hits.length) { const hit = hits.find(h => h.wire.wireId) || hits[0]; wireId = hit.wire.wireId ? String(hit.wire.wireId) : ''; }
        }
        if (wiredOnly && !wireId) return;
        rows.push({ module: comp.label || def.prefix || 'PLC', model: def.plc.model || '', sheet: getSchematicSheetNumber(sIdx), address: sp.name, type: 'Relay common', fn: sp.value || '', wireId, to: wireId, ref, _order: 1000 + i });
      });
    });
  });
  rows.sort((a, b) => a.module.localeCompare(b.module, undefined, { numeric: true }) || a._order - b._order);
  return { rows, modules };
}

function csvCell(val, d) {
  const s = String(val ?? '');
  return (s.includes(d) || /["\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function plcScheduleToCsv(rows, delimiter = ',') {
  const d = delimiter;
  const lines = [['Module', 'Model', 'Sheet', 'Address', 'Type', 'Function', 'Wire ID', 'Connected to', 'Reference'].join(d)];
  rows.forEach(r => lines.push([r.module, r.model, r.sheet ?? '', r.address, r.type, r.fn, r.wireId, r.to, r.ref].map(v => csvCell(v, d)).join(d)));
  return lines.join('\r\n') + '\r\n';
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function printable(rows, title) {
  let body = '', last = null;
  rows.forEach(r => {
    if (r.module !== last) { body += `<tr class="h"><td colspan="8">${esc(r.module)}${r.model ? ' &ndash; ' + esc(r.model) : ''}</td></tr>`; last = r.module; }
    body += `<tr><td>${esc(r.address)}</td><td>${esc(r.type)}</td><td>${esc(r.fn)}</td><td>${esc(r.wireId)}</td><td>${esc(r.to)}</td><td>${esc(r.sheet ?? '')}</td><td>${esc(r.ref)}</td></tr>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:12px/1.35 "Segoe UI",Arial,sans-serif;color:#0f172a;margin:16px}h1{font-size:16px;margin:0 0 10px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #94a3b8;padding:3px 6px;text-align:left}th{background:#e2e8f0}
    tr.h td{background:#f1f5f9;font-weight:600}</style></head><body><h1>${esc(title)}</h1>
    <table><thead><tr><th>Address</th><th>Type</th><th>Function</th><th>Wire ID</th><th>Connected to</th><th>Sheet</th><th>Ref.</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function ensureModal() {
  let m = document.getElementById('plcScheduleModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'plcScheduleModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card" style="width: 920px; max-width: 94vw;">
    <div class="modal-header"><h3>PLC I/O Schedule</h3><button type="button" class="btn-icon" id="psClose">&#10005;</button></div>
    <p class="modal-hint">Every input and output of the PLC modules on your sheets: its address, function, the wire connected to it and what that wire goes to. Channels with no wire are the spares.</p>
    <div class="modal-row"><label>Module</label><select id="psModule"></select></div>
    <div class="modal-row"><label>Show</label>
      <select id="psWired"><option value="all">All inputs and outputs (spares included)</option><option value="wired">Wired channels only</option></select></div>
    <div class="modal-row"><label>Separator</label>
      <select id="psDelim"><option value=",">Comma ( , )</option><option value=";">Semicolon ( ; )</option><option value="&#9;">Tab</option></select></div>
    <div class="modal-row"><label><input type="checkbox" id="psBom" checked> UTF-8 with BOM (keeps accents and &Omega; correct)</label></div>
    <p class="modal-hint" id="psSummary"></p>
    <div style="max-height: 42vh; overflow:auto; border:1px solid var(--border-light); border-radius:var(--radius-md);">
      <table class="bom-table"><thead><tr><th>Module</th><th>Address</th><th>Type</th><th>Function</th><th>Wire ID</th><th>Connected to</th><th>Ref.</th></tr></thead><tbody id="psBody"></tbody></table>
    </div>
    <div class="modal-actions"><button type="button" class="btn-ghost" id="psCancel">Close</button><button type="button" class="btn-ghost" id="psPrint">Print</button><button type="button" class="btn-primary" id="psSave">Save CSV</button></div>
  </div>`;
  document.body.appendChild(m);
  const opts = () => ({ module: m.querySelector('#psModule').value, wiredOnly: m.querySelector('#psWired').value === 'wired' });
  const fillModules = () => {
    const sel = m.querySelector('#psModule'), keep = sel.value;
    const { modules } = buildPlcSchedule();
    sel.innerHTML = '<option value="">All modules</option>' + modules.map(x => `<option value="${esc(x.key)}">${esc(x.label)}${x.model ? ' – ' + esc(x.model) : ''}</option>`).join('');
    if (modules.some(x => x.key === keep)) sel.value = keep;
  };
  const refresh = () => {
    const { rows } = buildPlcSchedule(opts());
    m._rows = rows;
    const wired = rows.filter(r => r.wireId || r.to).length;
    m.querySelector('#psSummary').textContent = rows.length
      ? `${rows.length} channel${rows.length === 1 ? '' : 's'}, ${wired} wired.`
      : 'No PLC modules on the sheets yet. Add a PLC module from the sidebar, then wire its inputs and outputs.';
    m.querySelector('#psBody').innerHTML = rows.slice(0, 600).map(r => `<tr><td>${esc(r.module)}</td><td>${esc(r.address)}</td><td>${esc(r.type)}</td><td>${esc(r.fn)}</td><td>${esc(r.wireId)}</td><td>${esc(r.to)}</td><td>${esc(r.ref)}</td></tr>`).join('');
  };
  m._open = () => { fillModules(); refresh(); };
  ['psModule', 'psWired', 'psDelim', 'psBom'].forEach(id => m.querySelector('#' + id).addEventListener('change', refresh));
  const close = () => { m.style.display = 'none'; };
  m.querySelector('#psClose').addEventListener('click', close);
  m.querySelector('#psCancel').addEventListener('click', close);
  m.querySelector('#psSave').addEventListener('click', async () => {
    if (!m._rows || !m._rows.length) { appAlert('There are no PLC inputs or outputs to save yet.'); return; }
    let csv = plcScheduleToCsv(m._rows, m.querySelector('#psDelim').value);
    if (m.querySelector('#psBom').checked) csv = '﻿' + csv;
    const name = (document.getElementById('projectNameInput')?.value || 'schematic').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'schematic';
    await saveTextFile(csv, `${name}_plc_io_schedule.csv`, 'text/csv', 'PLC I/O schedule (CSV)');
  });
  m.querySelector('#psPrint').addEventListener('click', () => {
    if (!m._rows || !m._rows.length) { appAlert('There are no PLC inputs or outputs to print yet.'); return; }
    const name = (document.getElementById('projectNameInput')?.value || '').trim();
    const w = window.open('', '_blank');
    if (!w) { appAlert('The print window was blocked. Allow pop-ups for this site, or save the CSV instead.'); return; }
    w.document.open(); w.document.write(printable(m._rows, `PLC I/O Schedule${name ? ' – ' + name : ''}`)); w.document.close();
    w.focus(); setTimeout(() => w.print(), 200);
  });
  return m;
}

export function openPlcScheduleModal() {
  const m = ensureModal();
  m.style.display = 'flex';
  m._open();
}
export function closePlcScheduleModal() { const m = document.getElementById('plcScheduleModal'); if (m) m.style.display = 'none'; }
