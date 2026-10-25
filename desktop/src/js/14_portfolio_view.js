// ==========================================
// 14. PORTFOLIO VIEW
// ==========================================
// A list of every sheet in the project, for projects too large to keep a tab for
// each one. A sheet's tab can be shown or hidden here; hiding it only removes the
// tab (the sheet stays in the project and in the numbering, Contents and BOM), and
// clicking a sheet's name opens it and goes to it. The sheet being worked on always
// keeps its tab. Which tabs are open is saved with the project.

import { state, getPageType, appConfirm, appPrompt, appAlert, inSection, sectionDepth, SECTION_MAX_DEPTH, sheetGroupsOn, sheetGroupOf, sheetReviewOf, sheetReferenceOf, SHEET_REVIEW_STATES } from './1_config_state.js';
import { duplicateSheet, duplicateSheetCheck, setSheetReview } from './32_sheet_tools.js';
import { sectionPaths, addSection, renameSection, deleteSection, moveSection, draggedSheetIndex, setSheetGroup, toggleGroupTabs, switchSheet, removeSheet, isSheetTabOpen, sheetTabLabel, openSheetTab, closeSheetTab, setSheetTabs, makeSheetDraggable } from './5_portfolio_sheets.js';

const el = (id) => document.getElementById(id);
let wired = false;

// The text the search box looks through for a sheet.
export function sheetSearchText(sheet, idx) {
  const review = sheetReviewOf(sheet);
  return [sheetTabLabel(sheet, idx), sheet.title, sheet.description, sheet.location, sheet.customer, sheetGroupOf(sheet), sheetReferenceOf(sheet), review && review.label, sheetGroupsOn() ? sheet.note : '']
    .filter(Boolean).join(' ').toLowerCase();
}

// Which sheets (by index) match what was typed: every word must appear somewhere.
export function matchingSheetIndexes(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const filter = el('portfolioReviewFilter') ? el('portfolioReviewFilter').value : '*';
  const out = [];
  state.sheets.forEach((sheet, idx) => {
    if (filter !== '*') {
      const review = sheetReviewOf(sheet);
      if ((review ? review.id : '') !== filter) return;
    }
    const text = sheetSearchText(sheet, idx);
    if (words.every(w => text.includes(w))) out.push(idx);
  });
  return out;
}

// ---- the tree ----
// Sections come from the sheet order: each sheet's `group` is its section path ('Power/Motors'). Items keep the exact
// order of the sheets (a section appears where its first sheet is), so what you see is the numbering order.
const collapsed = new Set();   // section paths folded shut (this session only)
let dragSection = null;

function buildTree(visibleIdx) {
  const root = { path: '', name: '', items: [], count: 0, kids: new Map() };
  const nodeFor = (path) => {
    let node = root;
    if (!path) return node;
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      let next = node.kids.get(p);
      if (!next) {
        next = { path: p, name: parts[i - 1], items: [], count: 0, kids: new Map(), parent: node };
        node.kids.set(p, next);
        node.items.push({ section: next });
      }
      node = next;
    }
    return node;
  };
  const grouped = sheetGroupsOn();
  state.sheets.forEach((sheet, idx) => {
    if (!visibleIdx.has(idx)) return;
    const node = nodeFor(grouped ? sheetGroupOf(sheet) : '');
    node.items.push({ idx });
    for (let n = node; n; n = n.parent) n.count++;
  });
  if (grouped && visibleIdx.size === state.sheets.length) sectionPaths().forEach(p => nodeFor(p));   // empty sections too (not while searching)
  return root;
}

function sectionLabel(path) { return path.split('/').join(' › '); }

function renderList() {
  const list = el('portfolioList');
  if (!list) return;
  const query = el('portfolioSearch') ? el('portfolioSearch').value : '';
  const filtering = !!el('portfolioReviewFilter') && el('portfolioReviewFilter').value !== '*';
  const searching = !!query.trim() || filtering;
  const matches = matchingSheetIndexes(query);
  list.innerHTML = '';
  list.classList.remove('dragging-section');

  const groupsOn = sheetGroupsOn();
  const tree = buildTree(new Set(matches));
  const sections = groupsOn ? sectionPaths() : [];

  const buildRow = (idx, depth) => {
    const sheet = state.sheets[idx];
    const active = idx === state.activeSheetIndex;
    const row = document.createElement('div');
    row.className = 'portfolio-row' + (active ? ' active' : '');
    if (groupsOn && depth) row.style.paddingLeft = (10 + depth * 18) + 'px';
    makeSheetDraggable(row, idx, 'y', refresh);

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = isSheetTabOpen(sheet) || active;
    box.disabled = active;
    box.title = active ? 'The sheet you are on always has a tab' : 'Show this sheet as a tab';
    box.onchange = () => {
      if (box.checked) openSheetTab(idx);
      else if (!closeSheetTab(idx)) box.checked = true;   // the last open tab stays
      refresh();
    };
    row.appendChild(box);

    const text = document.createElement('div');
    text.className = 'portfolio-text';
    text.title = 'Open this sheet';
    const name = document.createElement('div');
    name.className = 'portfolio-name';
    name.textContent = sheetTabLabel(sheet, idx);
    text.appendChild(name);
    const ref = sheetReferenceOf(sheet);
    const detail = [ref, sheet.description, sheet.location, groupsOn ? sheet.note : ''].filter(Boolean).join(' · ');
    if (detail) {
      const sub = document.createElement('div');
      sub.className = 'portfolio-sub';
      sub.textContent = detail;
      text.appendChild(sub);
    }
    text.onclick = () => { switchSheet(idx); closePortfolioView(); };
    row.appendChild(text);

    if (groupsOn) {
      const g = document.createElement('select');
      g.className = 'portfolio-group-input';
      g.title = 'Which section this sheet is in. Sheets in a section are kept together, and a section can be folded away here or hidden from the tab bar.';
      const none = document.createElement('option'); none.value = ''; none.textContent = '(no section)'; g.appendChild(none);
      sections.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = '  '.repeat(p.split('/').length - 1) + p.split('/').pop(); g.appendChild(o); });
      g.value = sheetGroupOf(sheet);
      g.onchange = () => { setSheetGroup(idx, g.value); refresh(); };
      row.appendChild(g);

      const rv = document.createElement('select');
      const cur = sheetReviewOf(sheet);
      rv.className = 'portfolio-review' + (cur ? ' set' : '');
      if (cur) rv.style.color = cur.colour;
      rv.title = 'Review state: where this sheet is in your checking process';
      SHEET_REVIEW_STATES.forEach(r => { const o = document.createElement('option'); o.value = r.id; o.textContent = r.label; rv.appendChild(o); });
      rv.value = cur ? cur.id : '';
      rv.onchange = () => { setSheetReview(idx, rv.value); refresh(); };
      row.appendChild(rv);

      const dup = document.createElement('button');
      dup.type = 'button';
      dup.className = 'btn-icon';
      dup.innerHTML = '&#10697;';
      const why = duplicateSheetCheck(idx);
      dup.disabled = !!why;
      dup.title = why || 'Duplicate this sheet (with its own sheet number and part designators)';
      dup.onclick = async () => { const made = await duplicateSheet(idx); if (made) { closePortfolioView(); } };
      row.appendChild(dup);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-icon';
    del.innerHTML = '&#128465;';
    del.title = 'Delete this sheet from the project';
    del.disabled = state.sheets.length <= 1;
    del.onclick = async () => { await removeSheet(idx); refresh(); };
    row.appendChild(del);
    return row;
  };

  const sheetsIn = (node, out = []) => { node.items.forEach(it => { if (it.section) sheetsIn(it.section, out); else out.push(it.idx); }); return out; };
  const fail = async (msg) => { if (msg) await appAlert(msg); refresh(); };

  const buildHead = (node, depth) => {
    const path = node.path;
    const isOpen = searching || !collapsed.has(path);
    const head = document.createElement('div');
    head.className = 'portfolio-section' + (isOpen ? '' : ' folded');
    head.style.paddingLeft = (6 + (depth - 1) * 18) + 'px';
    head.draggable = true;
    head.title = 'Drag a sheet onto this section to put it in here, or drag this section onto another to nest it';

    const chev = document.createElement('button');
    chev.type = 'button'; chev.className = 'portfolio-chev';
    chev.textContent = isOpen ? '▾' : '▸';
    chev.title = isOpen ? 'Fold this section' : 'Unfold this section';
    chev.onclick = () => { if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path); refresh(); };
    head.appendChild(chev);

    const title = document.createElement('span');
    title.className = 'portfolio-section-name';
    title.textContent = node.name;
    title.onclick = chev.onclick;
    head.appendChild(title);

    const count = document.createElement('span');
    count.className = 'portfolio-section-count';
    count.textContent = `${node.count} sheet${node.count === 1 ? '' : 's'}`;
    head.appendChild(count);

    const mk = (label, tip, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-ghost portfolio-section-btn';
      b.textContent = label; b.title = tip; b.disabled = !!disabled;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      head.appendChild(b);
    };
    const members = state.sheets.map((s, i) => i).filter(i => inSection(sheetGroupOf(state.sheets[i]), path));
    if (members.length) {
      const anyOpen = members.some(i => isSheetTabOpen(state.sheets[i]) && i !== state.activeSheetIndex);
      mk(anyOpen ? 'Hide tabs' : 'Show tabs', 'Show or hide the tabs of every sheet in this section', () => { toggleGroupTabs(members); refresh(); });
    }
    mk('+ Sub', 'Add a section inside this one', async () => {
      const n = await appPrompt('Name for the new section inside "' + node.name + '":', '');
      if (n === null || n === undefined) return;
      collapsed.delete(path);
      await fail(addSection(path, n));
    }, sectionDepth(path) >= SECTION_MAX_DEPTH);
    mk('Rename', 'Rename this section', async () => {
      const n = await appPrompt('New name for "' + node.name + '":', node.name);
      if (n === null || n === undefined) return;
      await fail(renameSection(path, n));
    });
    mk('Delete', 'Delete this section. Its sheets are kept and move up a level.', async () => {
      const ok = await appConfirm(`Delete the section "${node.name}"? Its ${node.count} sheet${node.count === 1 ? '' : 's'} (and any sections inside it) are kept and move up a level.`);
      if (!ok) return;
      deleteSection(path); collapsed.delete(path); refresh();
    });

    // drag a section to nest it; drop a sheet or section onto the heading
    head.addEventListener('dragstart', (e) => {
      dragSection = path;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', path); } catch (err) { /* some browsers refuse */ }
      list.classList.add('dragging-section');
    });
    head.addEventListener('dragend', () => { dragSection = null; list.classList.remove('dragging-section'); list.querySelectorAll('.drop-into').forEach(x => x.classList.remove('drop-into')); });
    head.addEventListener('dragover', (e) => {
      const sheetDrag = draggedSheetIndex() !== null;
      if (!sheetDrag && !(dragSection !== null && dragSection !== path && !inSection(path, dragSection))) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      head.classList.add('drop-into');
    });
    head.addEventListener('dragleave', () => head.classList.remove('drop-into'));
    head.addEventListener('drop', async (e) => {
      head.classList.remove('drop-into');
      const fromSheet = draggedSheetIndex();
      if (fromSheet !== null) { e.preventDefault(); e.stopPropagation(); setSheetGroup(fromSheet, path); refresh(); return; }
      if (dragSection !== null) { e.preventDefault(); const src = dragSection; dragSection = null; await fail(moveSection(src, path)); }
    });
    return head;
  };

  const renderNode = (node, depth) => {
    node.items.forEach(item => {
      if (!item.section) { list.appendChild(buildRow(item.idx, depth)); return; }
      const child = item.section;
      list.appendChild(buildHead(child, depth + 1));
      if (searching || !collapsed.has(child.path)) renderNode(child, depth + 1);
    });
  };
  // (a section with nothing matching a search is not worth showing)
  if (searching) {
    const prune = (node) => { node.items = node.items.filter(it => !it.section || (prune(it.section), it.section.count > 0)); };
    prune(tree);
  }
  renderNode(tree, 0);

  if (groupsOn) {
    const top = document.createElement('div');
    top.className = 'portfolio-toplevel';
    top.textContent = 'Drop here to move this section to the top level';
    top.addEventListener('dragover', (e) => { if (dragSection !== null) { e.preventDefault(); top.classList.add('drop-into'); } });
    top.addEventListener('dragleave', () => top.classList.remove('drop-into'));
    top.addEventListener('drop', async (e) => { e.preventDefault(); const src = dragSection; dragSection = null; await fail(moveSection(src, '')); });
    list.appendChild(top);
  }

  if (!matches.length) {
    const none = document.createElement('div');
    none.className = 'portfolio-sub';
    none.style.padding = '14px 4px';
    none.textContent = 'No sheets match that search.';
    list.appendChild(none);
  }

  const total = state.sheets.length;
  const open = state.sheets.filter(isSheetTabOpen).length;
  const summary = el('portfolioSummary');
  const secCount = sections.length;
  if (summary) summary.textContent = `${total} sheet${total === 1 ? '' : 's'} in the project · ${open} with a tab`
    + (secCount ? ` · ${secCount} section${secCount === 1 ? '' : 's'}` : '')
    + (searching ? ` · ${matches.length} match${matches.length === 1 ? '' : 'es'}` : '');
  const matchBtn = el('portfolioShowMatchingBtn');
  if (matchBtn) matchBtn.style.display = searching ? '' : 'none';
}

function refresh() { renderList(); }

export function openPortfolioView() {
  const modal = el('portfolioModal');
  if (!modal) return;
  const search = el('portfolioSearch');
  if (search) search.value = '';
  if (el('portfolioReviewFilter')) el('portfolioReviewFilter').value = '*';
  renderList();
  if (!wired) {
    wired = true;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePortfolioView(); } });
    if (search) search.addEventListener('input', renderList);
    const filter = el('portfolioReviewFilter');
    if (filter) filter.addEventListener('change', renderList);
  }
  modal.style.display = 'flex';
  if (search && search.focus) search.focus();
}

export function closePortfolioView() {
  const modal = el('portfolioModal');
  if (modal) modal.style.display = 'none';
}

// "New section" at the top level.
export async function portfolioNewSection() {
  const n = await appPrompt('Name for the new section:', '');
  if (n === null || n === undefined) return;
  const msg = addSection('', n);
  if (msg) await appAlert(msg);
  refresh();
}
// Fold every section away, or open them all again.
export function portfolioFoldAll(fold) {
  collapsed.clear();
  if (fold) sectionPaths().forEach(p => collapsed.add(p));
  refresh();
}

export function portfolioShowAll() { setSheetTabs(() => true); refresh(); }
export function portfolioOnlyCurrent() { setSheetTabs(() => false); refresh(); }

// Show exactly the sheets the search found (plus the one you are on).
export function portfolioShowMatching() {
  const keep = new Set(matchingSheetIndexes(el('portfolioSearch') ? el('portfolioSearch').value : ''));   // honours the review filter too
  setSheetTabs((sheet, idx) => keep.has(idx));
  refresh();
}

window.openPortfolioView = openPortfolioView;
window.portfolioNewSection = portfolioNewSection;
window.portfolioFoldAll = portfolioFoldAll;
