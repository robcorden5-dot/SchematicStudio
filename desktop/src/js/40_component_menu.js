// ==========================================
// 40. COMPONENT RIGHT-CLICK MENU AND SWAP DIALOG
// ==========================================
// Right-click a part on the sheet: Swap component, Edit details, Delete. Swap opens a list of symbols to pick from; the part
// keeps its designator, position and links, its wires stay attached (only their ends move to the new symbol's pins) and so
// every wire keeps its ID. See swapComponent in 3_schematic_engine.js.

import { state, getActiveSheet, getPinsForType, getSchematicSheetNumber, pushHistory, scheduleAutosave } from './1_config_state.js';
import { goToLocation } from './31_find.js';
import { swapComponent, canSwapComponent, renderComponents, deleteSelectedComponent } from './3_schematic_engine.js';
import { openEditModal, findComponentById } from './5_portfolio_sheets.js';
import { placedKeys } from './21_panel_data.js';
import { goToPanelItem } from './22_panel_layout.js';
import { isAssignedTerminal, blockKey, terminalLocationId } from './11_terminal_blocks.js';
import { buildSymbolThumbnailSvg } from './9_symbol_thumbnails.js';

let menuEl = null;

function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}
function onOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function onKey(e) { if (e.key === 'Escape') closeMenu(); }

function menuItem(text, onClick, disabled = false, title = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.disabled = disabled;
  b.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 14px;background:none;border:0;color:var(--text);font:inherit;font-size:13px;cursor:pointer;' + (disabled ? 'opacity:.4;cursor:not-allowed;' : '');
  if (!disabled) {
    b.onmouseenter = () => { b.style.background = 'var(--btn-hover, rgba(127,127,127,.2))'; };
    b.onmouseleave = () => { b.style.background = 'none'; };
    b.onclick = () => { closeMenu(); onClick(); };
  }
  return b;
}

// A small menu of { text, onClick, disabled?, title? } at a screen position (used by the panel layout sheet).
export function showSimpleMenu(x, y, entries) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.id = 'componentMenu';
  menuEl.style.cssText = 'position:fixed;z-index:1100;min-width:190px;padding:4px 0;background:var(--bg-panel);color:var(--text);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow-lg, 0 6px 20px rgba(0,0,0,.3));';
  entries.forEach(en => menuEl.appendChild(menuItem(en.text, en.onClick, !!en.disabled, en.title || '')));
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  setTimeout(() => { document.addEventListener('mousedown', onOutside, true); document.addEventListener('keydown', onKey, true); }, 0);
}

export function showComponentMenu(compId, x, y) {
  closeMenu();
  const sheet = getActiveSheet();
  const comp = (sheet.components || []).find(c => c.id === compId);
  if (!comp) return;
  menuEl = document.createElement('div');
  menuEl.id = 'componentMenu';
  menuEl.style.cssText = 'position:fixed;z-index:1100;min-width:190px;padding:4px 0;background:var(--bg-panel);color:var(--text);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow-lg, 0 6px 20px rgba(0,0,0,.35));';
  const canSwap = canSwapComponent(comp);
  menuEl.appendChild(menuItem('Swap component…', () => openSwapDialog(compId), !canSwap, canSwap ? 'Replace this symbol with another, keeping the wires and their IDs' : 'This kind of part cannot be swapped'));
  menuEl.appendChild(menuItem('Edit details…', () => openEditModal(comp)));
  // Placed on a panel layout sheet: go there (the sheet opens with the part selected)
  {
    const placed = placedKeys(state.sheets);
    let hit = placed.get(`${sheet.id}:${comp.id}`);
    if (!hit && comp.jointToId) { const m = findComponentById(comp.jointToId); const ms = m && state.sheets.find(sh => (sh.components || []).includes(m)); if (ms) hit = placed.get(`${ms.id}:${m.id}`); }
    if (!hit && comp.type === 'terminal' && isAssignedTerminal(comp)) {   // one physical terminal, drawn once per level: any of its symbols stands for it
      const bk = blockKey(comp.label, terminalLocationId(comp, sheet));
      state.sheets.forEach(sh => (sh.components || []).forEach(c => {
        if (hit || c.type !== 'terminal' || c.position !== comp.position || !isAssignedTerminal(c) || blockKey(c.label, terminalLocationId(c, sh)) !== bk) return;
        hit = placed.get(`${sh.id}:${c.id}`);
      }));
    }
    if (hit) menuEl.appendChild(menuItem('Show in panel layout', () => goToPanelItem(hit.panelSheetId, hit.item.id), false, 'Open the panel layout sheet this part is placed on, with it selected'));
  }
  // A generated terminal table: put the external side on the left and the internal on the right (or back).
  const tdef = window.customSymbolDefinitions && window.customSymbolDefinitions[comp.type];
  if (String(comp.type).startsWith('custom_terminaltable_')) {
    const spec = tdef && tdef.tableSpec;
    menuEl.appendChild(menuItem(spec && spec.swap ? 'Swap sides: internal on the left' : 'Swap sides: external on the left', () => {
      pushHistory();
      spec.swap = !spec.swap;
      if (typeof window.refreshTerminalTables === 'function') window.refreshTerminalTables();
      renderComponents(openEditModal);
      scheduleAutosave();
    }, !spec, spec ? 'Swap which side the internal and external wires are shown on' : 'Generate this table again with the current generator to use this'));
  }
  // Parent and child contacts, anywhere in the project: go to the other part (its sheet opens, it is selected and centred).
  const related = [];
  const here = state.sheets.indexOf(sheet);
  state.sheets.forEach((sh, si) => (sh.components || []).forEach(c => {
    if (comp.parentId && String(c.id) === String(comp.parentId)) related.push({ kind: 'parent', c, si });
    else if (c.parentId && String(c.parentId) === String(comp.id)) related.push({ kind: 'child', c, si });
  }));
  const where = (si) => (si === here ? '' : `  \u2014 sheet ${getSchematicSheetNumber(si) || si + 1}`);
  const goTo = (r) => goToLocation({ sheetIdx: r.si, sel: { selectedComponentId: r.c.id }, x: r.c.x, y: r.c.y });
  if (related.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;margin:4px 0;background:var(--border);';
    menuEl.appendChild(sep);
    related.filter(r => r.kind === 'parent').forEach(r => menuEl.appendChild(menuItem(`Go to parent ${r.c.label || ''}${where(r.si)}`, () => goTo(r), false, 'Open the sheet this part belongs to and select the parent')));
    const kids = related.filter(r => r.kind === 'child');
    kids.slice(0, 15).forEach(r => menuEl.appendChild(menuItem(`Go to child ${r.c.label || ''}${where(r.si)}`, () => goTo(r), false, 'Open the sheet this child is on and select it')));
    if (kids.length > 15) menuEl.appendChild(menuItem(`\u2026and ${kids.length - 15} more (use Find)`, () => {}, true));
    const sep2 = document.createElement('div');
    sep2.style.cssText = 'height:1px;margin:4px 0;background:var(--border);';
    menuEl.appendChild(sep2);
  }
  menuEl.appendChild(menuItem('Delete', () => deleteSelectedComponent(() => renderComponents(openEditModal))));
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  setTimeout(() => { document.addEventListener('mousedown', onOutside, true); document.addEventListener('keydown', onKey, true); }, 0);
}

// ---- the swap dialog ----
function symbolGroups(filter, currentType) {
  const defs = window.customSymbolDefinitions || {};
  const groups = new Map();
  Object.keys(defs).forEach(key => {
    const d = defs[key];
    if (d.hidden || key === currentType) return;
    const name = String(d.name ?? key);
    if (filter && !name.toLowerCase().includes(filter)) return;
    const lib = d.library || 'Other';
    if (!groups.has(lib)) groups.set(lib, []);
    groups.get(lib).push({ key, name, d });
  });
  return Array.from(groups.keys()).sort((a, b) => a.localeCompare(b)).map(n => ({ name: n, items: groups.get(n).sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function openSwapDialog(compId) {
  const sheet = getActiveSheet();
  const comp = (sheet.components || []).find(c => c.id === compId);
  if (!comp || !canSwapComponent(comp)) return;
  const oldPinCount = getPinsForType(comp.type).length;
  const current = window.customSymbolDefinitions[comp.type];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'swapComponentModal';
  overlay.style.cssText = 'display:flex;z-index:1110;';
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.style.cssText = 'width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;';
  overlay.appendChild(card);

  const head = document.createElement('div');
  head.className = 'modal-header';
  const h = document.createElement('h3');
  h.textContent = 'Swap component';
  head.appendChild(h);
  card.appendChild(head);

  const info = document.createElement('div');
  info.style.cssText = 'font-size:13px;color:var(--text-muted);margin-bottom:10px;';
  info.textContent = `${comp.label || 'This part'} is a ${current ? current.name : comp.type}. Choose its replacement: it keeps the designator, position and links, and its wires stay attached and keep their IDs. Make, model and description are cleared.`;
  card.appendChild(info);

  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search symbols…';
  search.style.cssText = 'margin-bottom:8px;width:100%;box-sizing:border-box;';
  card.appendChild(search);

  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1 1 auto;min-height:200px;border:1px solid var(--border);border-radius:6px;';
  card.appendChild(list);

  const foot = document.createElement('div');
  foot.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
  foot.appendChild(cancel);
  card.appendChild(foot);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  cancel.onclick = close;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc, true);

  const fill = () => {
    list.textContent = '';
    const groups = symbolGroups(search.value.trim().toLowerCase(), comp.type);
    if (!groups.length) { const n = document.createElement('div'); n.style.cssText = 'padding:14px;color:var(--text-muted);font-size:13px;'; n.textContent = 'No symbols match.'; list.appendChild(n); return; }
    groups.forEach(g => {
      const gh = document.createElement('div');
      gh.textContent = g.name;
      gh.style.cssText = 'padding:6px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);background:var(--bg-panel-deep, rgba(127,127,127,.12));position:sticky;top:0;';
      list.appendChild(gh);
      g.items.forEach(it => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:6px 10px;background:none;border:0;border-bottom:1px solid var(--border);color:var(--text);font:inherit;font-size:13px;cursor:pointer;';
        row.onmouseenter = () => { row.style.background = 'var(--btn-hover, rgba(127,127,127,.2))'; };
        row.onmouseleave = () => { row.style.background = 'none'; };
        const thumb = document.createElement('span');
        thumb.style.cssText = 'flex:0 0 auto;display:inline-block;';
        thumb.innerHTML = buildSymbolThumbnailSvg(it.d.pathData, it.d.pins || [], { width: 56, height: 40, texts: it.d.texts || [] });   // numbers and checked path data only
        const label = document.createElement('span');
        label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        label.textContent = it.name;
        const pc = (it.d.pins || []).length;
        const note = document.createElement('span');
        note.style.cssText = 'flex:0 0 auto;font-size:11px;color:var(--text-faint);';
        note.textContent = pc === oldPinCount ? `${pc} pins` : `${pc} pins (was ${oldPinCount})`;
        row.append(thumb, label, note);
        row.onclick = () => {
          close();
          swapComponent(compId, it.key, () => renderComponents(openEditModal));
        };
        list.appendChild(row);
      });
    });
  };
  search.oninput = fill;
  fill();
  document.body.appendChild(overlay);
  search.focus();
}
