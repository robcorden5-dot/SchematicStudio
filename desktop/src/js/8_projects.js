// ==========================================
// 8. SERVER-SIDE PROJECT STORAGE
// ==========================================
// Talks to /projects/*.php. The actual free-tier sheet limit is enforced
// server-side in save.php — this module just surfaces whatever it says.
import { state, buildPortfolioSnapshot, appAlert, appConfirm, appPrompt } from './1_config_state.js';
import { applyPortfolioData } from './5_portfolio_sheets.js';

let currentProjectId = null; // null = not yet saved to the server
let currentProjectName = '';
let cachedProjectList = [];

// What the read-only Project field shows before a project has a name. It's a
// label, not a name — it must never be offered as one (it used to be, which is
// how several projects ended up saved as "(unsaved project)").
const UNSAVED_PLACEHOLDER = '(unsaved project)';
const DEFAULT_PROJECT_NAME = 'My Project';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// All requests go through here so the CSRF header and JSON parsing are
// handled consistently in one place.
async function apiFetch(url, options = {}) {
  const headers = Object.assign({ 'X-CSRF-Token': window.csrfToken || '' }, options.headers);
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options, { headers }));
  let data = null;
  try { data = await res.json(); } catch (err) { /* non-JSON error response */ }
  // A request that comes back "not signed in" (or with a stale security token, which is the same thing: the
  // login the page was loaded with has ended) means the work on screen can no longer be saved - say so, plainly.
  if (res.status === 401 || (res.status === 403 && data?.error === 'csrf')) markSessionLost(data?.message);
  return { ok: res.ok, status: res.status, data };
}

// ---- keeping the login alive, and noticing when it has ended ----
// The server forgets an idle login after a while, and the editor can sit open for hours. So: a small request
// every few minutes (which also marks the device as in use), another the moment the tab is looked at again, and
// if the login has gone anyway, a clear note beside the save status instead of a cryptic "Autosave failed".
// The drawing on screen is never touched, and saving resumes by itself once signed in again.
let sessionLost = false;
let sessionNoticeShown = false;
let lastPing = 0;

function markSessionLost(message) {
  sessionLost = true;
  const indicator = document.getElementById('autosaveIndicator');
  if (indicator) {
    indicator.innerHTML = '<a href="/auth/login.php" target="_blank" rel="noopener" style="color:var(--err); text-decoration:underline;" title="Opens the sign-in page in a new tab">Signed out \u2014 sign in again to keep saving</a>';
  }
  if (!sessionNoticeShown) {
    sessionNoticeShown = true;
    appAlert((message || 'Your login has ended.') + '\n\nYour drawing is still here and nothing has been lost. Click "Signed out" at the top of the screen to sign in again in a new tab, then come back to this one \u2014 it will start saving again by itself.');
  }
}

export async function checkSession() {
  lastPing = Date.now();
  let r;
  try { r = await apiFetch('/auth/ping.php'); } catch (err) { return null; }   // offline or the server is briefly unreachable: nothing to conclude
  if (r.ok && r.data?.success) {
    if (r.data.csrf) window.csrfToken = r.data.csrf;
    if (sessionLost) {
      sessionLost = false; sessionNoticeShown = false;
      const indicator = document.getElementById('autosaveIndicator');
      if (indicator) indicator.textContent = 'Signed in again \u2014 saving\u2026';
      if (typeof window.autosaveToServer === 'function') window.autosaveToServer();
    }
    return true;
  }
  return false;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  setInterval(() => { checkSession(); }, 4 * 60 * 1000);
  const wake = () => { if (!document.hidden && Date.now() - lastPing > 20000) checkSession(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', () => { checkSession(); });
}

function updateProjectNameDisplay() {
  const el = document.getElementById('projectNameInput');
  if (el) el.value = currentProjectName || UNSAVED_PLACEHOLDER;
}

// ---- the My Projects window ----
// Everyone gets the plain list. Pro accounts also get folders, search and sorting, a status and tags on each project,
// duplicating, and templates (the server decides: list.php says "organise" only for a Pro account whose database has
// the extra columns, and organise.php refuses anyone else).
const STATUS_LABELS = { draft: 'Draft', review: 'In review', issued: 'Issued', archived: 'Archived' };
const STATUS_COLOURS = { draft: '#64748b', review: '#d97706', issued: '#16a34a', archived: '#94a3b8' };
let cachedTemplates = [];
let organiseEnabled = false;
let pendingFolders = [];                 // folders made in this window that do not hold a project yet
const projectView = { q: '', sort: 'updated', status: 'active', folder: '*' };   // folder: '*' all, '' unfiled, else a name
let folderChoices = [];                   // the folder names shown in the side list, in order (so a click can refer to them by number)
let dialogMode = 'browse';               // 'browse' = My Projects; 'saveas' = the same window used to choose where a copy goes

// Opens the window. openMyProjectsModal('saveas') is "Save As": pick a folder (Pro), name the copy and save it here.
export async function openMyProjectsModal(mode) {
  dialogMode = mode === 'saveas' ? 'saveas' : 'browse';
  const modal = document.getElementById('myProjectsModal');
  if (modal) modal.style.display = 'flex';

  const listEl = document.getElementById('myProjectsList');
  if (listEl) listEl.innerHTML = '<div style="padding:16px; color:var(--text-faint);">Loading…</div>';

  const { ok, data } = await apiFetch('/projects/list.php');
  if (!ok || !data?.success) {
    if (listEl) listEl.innerHTML = '<div style="padding:16px; color:var(--danger);">Could not load your projects. Please try again.</div>';
    return;
  }

  cachedProjectList = data.projects;
  cachedTemplates = Array.isArray(data.templates) ? data.templates : [];
  organiseEnabled = !!data.organise;
  if (dialogMode === 'saveas') {
    // Start from the open project's own folder, and offer a name that is not taken.
    const open = cachedProjectList.find(p => p.id === currentProjectId);
    projectView.folder = organiseEnabled && open && open.folder ? open.folder : (organiseEnabled ? '' : '*');
    projectView.q = ''; projectView.status = 'all';
    const base = (currentProjectName || DEFAULT_PROJECT_NAME).replace(/\s*\(copy( \d+)?\)$/i, '');
    let name = `${base} (copy)`;
    for (let n = 2; cachedProjectList.some(p => sameName(p.name, name)); n++) name = `${base} (copy ${n})`;
    const input = document.getElementById('projectSaveAsName');
    if (input) { input.value = name; setTimeout(() => { input.focus(); input.select(); }, 0); }
  } else {
    projectView.status = projectView.status === 'all' && dialogMode === 'browse' ? 'active' : projectView.status;
  }
  renderProjectList();
}

function projectMatches(p, q) {
  if (!q) return true;
  const hay = [p.name, p.folder, ...(p.tags || []), STATUS_LABELS[p.status] || ''].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
}

function visibleProjects() {
  const v = projectView;
  let list = cachedProjectList.filter(p => {
    if (v.folder !== '*' && (p.folder || '') !== v.folder) return false;
    if (v.status === 'active' ? p.status === 'archived' : (v.status !== 'all' && p.status !== v.status)) return false;
    return projectMatches(p, v.q);
  });
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
  if (v.sort === 'name') list.sort(byName);
  else if (v.sort === 'oldest') list.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id - b.id);
  else list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id);
  return list;
}

function badgeHtml(status) {
  return `<span class="project-badge" style="background:${STATUS_COLOURS[status] || '#64748b'};">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function renderFolderList() {
  const el = document.getElementById('projectFolders');
  if (!el) return;
  const names = new Set(pendingFolders);
  cachedProjectList.forEach(p => { if (p.folder) names.add(p.folder); });
  folderChoices = Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const count = (f) => cachedProjectList.filter(p => (p.folder || '') === f && (projectView.status !== 'active' || p.status !== 'archived')).length;
  const total = cachedProjectList.filter(p => projectView.status !== 'active' || p.status !== 'archived').length;
  const item = (label, key, n, extra = '', dropIdx = null) => `
    <div class="folder-item${projectView.folder === key ? ' folder-item-active' : ''}" onclick="selectProjectFolder(${dropIdx === null ? (key === '*' ? "'*'" : "''") : dropIdx})"
         ondragover="event.preventDefault(); this.classList.add('folder-item-drop')" ondragleave="this.classList.remove('folder-item-drop')"
         ondrop="dropProjectOnFolder(event, ${dropIdx === null ? (key === '*' ? 'null' : "''") : dropIdx}); this.classList.remove('folder-item-drop')">
      <span class="folder-item-name">${label}</span><span class="folder-item-count">${n}</span>${extra}
    </div>`;
  el.innerHTML =
    item('All projects', '*', total) +
    item('Unfiled', '', count('')) +
    folderChoices.map((f, i) => item('&#128193; ' + escapeHtml(f), f, count(f),
      `<button type="button" class="btn-icon folder-item-edit" title="Rename this folder, or empty it" onclick="event.stopPropagation(); renameProjectFolder(${i})">&#9998;</button>`, i)).join('') +
    `<div class="folder-item folder-item-new" onclick="newProjectFolder()">+ New folder</div>`;
}

function renderTemplates() {
  const el = document.getElementById('projectTemplates');
  if (!el) return;
  if (!organiseEnabled || dialogMode === 'saveas') { el.style.display = 'none'; return; }
  el.style.display = '';
  const rows = cachedTemplates.map(t => `
    <div class="project-row">
      <div class="project-row-info"><div class="project-row-name">${escapeHtml(t.name)}</div>
        <div class="project-row-meta">${t.sheet_count} sheet${t.sheet_count === 1 ? '' : 's'} · saved ${escapeHtml(t.updated_at)}</div></div>
      <div class="project-row-actions">
        <button class="btn btn-primary" onclick="useProjectTemplate(${t.id})">New project from this</button>
        <button class="btn-icon" onclick="deleteProjectTemplate(${t.id})" title="Delete this template">&#128465;</button>
      </div>
    </div>`).join('');
  el.innerHTML = `<div class="projects-section-title">Templates</div>` +
    (rows || '<div style="padding:8px 12px; font-size:12px; color:var(--text-faint);">No templates yet. Set a project up the way you start every job (title block, cable library, terminal models, standard sheets), then use <b>Save as template</b>.</div>');
}

function renderProjectList() {
  const listEl = document.getElementById('myProjectsList');
  if (!listEl) return;

  // Plain list for a Free account (or when the database has no room for the extra columns).
  const organise = organiseEnabled;
  const saveAsMode = dialogMode === 'saveas';
  { const tb = document.getElementById('projectsToolbar'); if (tb) tb.style.display = organise && !saveAsMode ? '' : 'none'; const fl = document.getElementById('projectFolders'); if (fl) fl.style.display = organise ? '' : 'none'; }
  const teaser = document.getElementById('projectsProTeaser');
  if (teaser) teaser.style.display = organise ? 'none' : '';
  const card = document.getElementById('myProjectsCard');
  if (card) card.style.width = organise ? '900px' : '520px';
  const saveAs = dialogMode === 'saveas';
  const tmplBtn = document.getElementById('projectsSaveTemplateBtn');
  if (tmplBtn) tmplBtn.style.display = organise && !saveAs ? '' : 'none';
  const bar = document.getElementById('projectSaveAsBar');
  if (bar) bar.style.display = saveAs ? '' : 'none';
  const title = document.getElementById('myProjectsTitle');
  if (title) title.textContent = saveAs ? 'Save As' : 'My Projects';
  const where = document.getElementById('projectSaveAsWhere');
  if (where) where.textContent = !organise ? '' : (projectView.folder === '*' || projectView.folder === '' ? 'Folder: Unfiled' : 'Folder: ' + projectView.folder);
  [['projectsNewBtn', !saveAs], ['projectsSaveAsBtn', !saveAs]].forEach(([id, show]) => { const b = document.getElementById(id); if (b) b.style.display = show ? '' : 'none'; });
  const tmplSection = document.getElementById('projectTemplates');
  if (saveAs && tmplSection) tmplSection.style.display = 'none';
  renderTemplates();

  if (cachedProjectList.length === 0 && dialogMode !== 'saveas') {
    listEl.innerHTML = '<div style="padding:16px; color:var(--text-faint);">No saved projects yet — use "Save" to create your first one.</div>';
    if (organise) renderFolderList();
    return;
  }

  const list = organise ? visibleProjects() : cachedProjectList;
  if (organise) renderFolderList();
  if (list.length === 0 && dialogMode !== 'saveas') {
    listEl.innerHTML = '<div style="padding:16px; color:var(--text-faint);">No projects match. Clear the search, or choose another folder or status.</div>';
    return;
  }

  if (saveAs) {
    // Save As: the projects already here are only shown as a guide. Clicking one puts its name in the box (replacing it).
    listEl.innerHTML = list.map(p => `
      <div class="project-row project-row-pick${p.id === currentProjectId ? ' project-row-active' : ''}" onclick="pickSaveAsName(${p.id})" title="Use this name (replaces this project)">
        <div class="project-row-info"><div class="project-row-name">${escapeHtml(p.name)}${organise ? ' ' + badgeHtml(p.status) : ''}</div>
          <div class="project-row-meta">${p.sheet_count} sheet${p.sheet_count === 1 ? '' : 's'} · updated ${escapeHtml(p.updated_at)}</div></div>
      </div>`).join('') || '<div style="padding:16px; color:var(--text-faint);">Nothing saved in this folder yet.</div>';
    return;
  }

  listEl.innerHTML = list.map(p => `
    <div class="project-row${p.id === currentProjectId ? ' project-row-active' : ''}"${organise ? ` draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${p.id}')"` : ''}>
      <div class="project-row-info">
        <div class="project-row-name">${escapeHtml(p.name)}${organise ? ' ' + badgeHtml(p.status) : ''}</div>
        <div class="project-row-meta">${p.sheet_count} sheet${p.sheet_count === 1 ? '' : 's'} · updated ${escapeHtml(p.updated_at)}${organise && p.folder ? ' · &#128193; ' + escapeHtml(p.folder) : ''}</div>
        ${organise && p.tags && p.tags.length ? `<div class="project-row-tags">${p.tags.map(t => `<span class="project-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="project-row-actions">
        <button class="btn btn-primary" onclick="openProjectFromServer(${p.id})">Open</button>
        ${organise ? `<button class="btn btn-ghost" onclick="openProjectDetails(${p.id})" title="Folder, status, tags and name">Details</button>
        <button class="btn-icon" onclick="duplicateProject(${p.id})" title="Make a copy of this project">&#10697;</button>` : ''}
        <button class="btn-icon" onclick="deleteProjectFromServer(${p.id}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" title="Delete">&#128465;</button>
      </div>
    </div>
  `).join('');
}

export function setProjectView(key, value) {
  projectView[key] = value;
  renderProjectList();
}

export function selectProjectFolder(f) {
  projectView.folder = (typeof f === 'number') ? folderChoices[f] : f;
  renderProjectList();
}

async function organiseRequest(body) {
  const { ok, data } = await apiFetch('/projects/organise.php', { method: 'POST', body: JSON.stringify(body) });
  if (!ok || !data?.success) { await appAlert(data?.message || 'That did not work. Please try again.'); return null; }
  return data;
}

export async function newProjectFolder() {
  const name = await appPrompt('Name the new folder (a client, a site or a job number):', '', 'New folder');
  if (!name || !name.trim()) return;
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!pendingFolders.includes(clean)) pendingFolders.push(clean);
  projectView.folder = clean;
  renderProjectList();
}

export async function renameProjectFolder(i) {
  const from = folderChoices[i];
  if (from === undefined) return;
  const to = await appPrompt(`Rename the folder "${from}". Leave the name empty to take its projects out of the folder (the projects are kept):`, from, 'Rename folder');
  if (to === null || to === undefined) return;
  const clean = to.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (clean === from) return;
  if (await organiseRequest({ action: 'renameFolder', from, to: clean }) === null) return;
  pendingFolders = pendingFolders.filter(f => f !== from);
  if (projectView.folder === from) projectView.folder = clean === '' ? '*' : clean;
  openMyProjectsModal();
}

// A project dragged onto a folder in the side list (folder null = "All projects", which does nothing).
export async function dropProjectOnFolder(ev, f) {
  ev.preventDefault();
  if (f === null) return;
  const id = parseInt(ev.dataTransfer.getData('text/plain'), 10);
  const folder = typeof f === 'number' ? folderChoices[f] : f;
  if (!id || folder === undefined) return;
  if (await organiseRequest({ action: 'details', id, folder }) === null) return;
  openMyProjectsModal();
}

let detailsId = null;

export function openProjectDetails(id) {
  const p = cachedProjectList.find(x => x.id === id);
  if (!p) return;
  detailsId = id;
  document.getElementById('projDetName').value = p.name;
  document.getElementById('projDetFolder').value = p.folder || '';
  document.getElementById('projDetStatus').value = p.status || 'draft';
  document.getElementById('projDetTags').value = (p.tags || []).join(', ');
  const list = document.getElementById('projDetFolderList');
  if (list) {
    const names = new Set(pendingFolders); cachedProjectList.forEach(x => { if (x.folder) names.add(x.folder); });
    list.innerHTML = Array.from(names).sort().map(f => `<option value="${escapeHtml(f)}"></option>`).join('');
  }
  document.getElementById('projectDetailsModal').style.display = 'flex';
}

export function closeProjectDetails() {
  document.getElementById('projectDetailsModal').style.display = 'none';
  detailsId = null;
}

export async function saveProjectDetails() {
  if (detailsId === null) return;
  const id = detailsId;
  const name = document.getElementById('projDetName').value.trim();
  if (!name) { await appAlert('A project needs a name.'); return; }
  const clash = cachedProjectList.find(x => x.id !== id && sameName(x.name, name));
  if (clash) { await appAlert(`You already have a project called "${clash.name}". Choose another name.`); return; }
  const body = {
    action: 'details', id, name,
    folder: document.getElementById('projDetFolder').value,
    status: document.getElementById('projDetStatus').value,
    tags: document.getElementById('projDetTags').value
  };
  if (await organiseRequest(body) === null) return;
  if (id === currentProjectId && name !== currentProjectName) { currentProjectName = name; updateProjectNameDisplay(); }   // autosave sends the name each time, so it must follow
  closeProjectDetails();
  openMyProjectsModal();
}

export async function duplicateProject(id) {
  const p = cachedProjectList.find(x => x.id === id);
  if (!p) return;
  let name = `${p.name} (copy)`;
  for (let n = 2; cachedProjectList.some(x => sameName(x.name, name)); n++) name = `${p.name} (copy ${n})`;
  const chosen = await appPrompt('Name the copy:', name, 'Duplicate project');
  if (!chosen || !chosen.trim()) return;
  if (cachedProjectList.some(x => sameName(x.name, chosen))) { await appAlert(`You already have a project called "${chosen.trim()}".`); return; }
  if (id === currentProjectId && typeof window.autosaveToServer === 'function') await window.autosaveToServer();   // so the copy has the latest edits
  if (await organiseRequest({ action: 'duplicate', id, name: chosen.trim() }) === null) return;
  openMyProjectsModal();
}

export async function saveCurrentAsTemplate() {
  const base = (document.getElementById('projectNameInput')?.value || '').trim();
  const suggested = (base && base !== UNSAVED_PLACEHOLDER ? base : DEFAULT_PROJECT_NAME) + ' template';
  const name = await appPrompt('Name this template. It keeps a copy of the project as it is now (sheets, title block, cable library, terminal models and so on):', suggested, 'Save as template');
  if (!name || !name.trim()) return;
  if (await organiseRequest({ action: 'saveTemplate', name: name.trim(), data: buildPortfolioSnapshot() }) === null) return;
  openMyProjectsModal();
}

export async function useProjectTemplate(id) {
  const t = cachedTemplates.find(x => x.id === id);
  if (!t) return;
  let suggested = t.name.replace(/\s*template\s*$/i, '').trim() || 'New project';
  for (let n = 2; cachedProjectList.some(x => sameName(x.name, suggested)); n++) suggested = `${t.name.replace(/\s*template\s*$/i, '').trim() || 'New project'} (${n})`;
  const name = await appPrompt('Name the new project:', suggested, 'New project from template');
  if (!name || !name.trim()) return;
  if (cachedProjectList.some(x => sameName(x.name, name))) { await appAlert(`You already have a project called "${name.trim()}". Choose another name.`); return; }
  const folder = projectView.folder !== '*' ? projectView.folder : '';
  const res = await organiseRequest({ action: 'useTemplate', id, name: name.trim(), folder });
  if (res === null) return;
  await openProjectFromServer(res.id);
}

export async function deleteProjectTemplate(id) {
  const t = cachedTemplates.find(x => x.id === id);
  if (!t || !(await appConfirm(`Delete the template "${t.name}"? Projects already made from it are not affected.`))) return;
  if (await organiseRequest({ action: 'deleteTemplate', id }) === null) return;
  openMyProjectsModal();
}

export function closeMyProjectsModal() {
  const modal = document.getElementById('myProjectsModal');
  if (modal) modal.style.display = 'none';
}

export async function openProjectFromServer(id) {
  const { ok, data } = await apiFetch(`/projects/load.php?id=${encodeURIComponent(id)}`);
  if (!ok || !data?.success) {
    await appAlert(data?.message || 'Could not open that project.');
    return;
  }

  applyPortfolioData(data.data);
  currentProjectId = data.id;
  currentProjectName = data.name;
  updateProjectNameDisplay();
  closeMyProjectsModal();
}

export async function deleteProjectFromServer(id, name) {
  const proceed = await appConfirm(`Delete "${name}"? This can't be undone.`);
  if (!proceed) return;

  const { ok, data } = await apiFetch('/projects/delete.php', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

  if (!ok || !data?.success) {
    await appAlert(data?.message || 'Could not delete that project.');
    return;
  }

  if (id === currentProjectId) {
    currentProjectId = null;
    currentProjectName = '';
    updateProjectNameDisplay();
  }
  openMyProjectsModal(); // refresh the list in place
}

// Compared the way the database compares them: ignoring case and any spaces
// round the edges — so "my project " is the same name as "My Project".
function sameName(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

// Always a fresh copy from the server (never the list cached when My Projects
// was last opened), since this decides whether something gets overwritten.
async function fetchProjectList() {
  const { ok, data } = await apiFetch('/projects/list.php');
  if (!ok || !data?.success || !Array.isArray(data.projects)) return null;
  cachedProjectList = data.projects;
  return data.projects;
}

// The name offered when saving a new project. A name that came in with an
// imported file is offered as it is; otherwise "My Project", or "My Project
// (2)", "(3)"... if that's already taken — so a plain Enter never makes a clash.
function suggestProjectName(list) {
  const fieldValue = (document.getElementById('projectNameInput')?.value || '').trim();
  if (fieldValue && fieldValue !== UNSAVED_PLACEHOLDER) return fieldValue;
  if (!list || !list.some(p => sameName(p.name, DEFAULT_PROJECT_NAME))) return DEFAULT_PROJECT_NAME;
  for (let n = 2; ; n++) {
    const candidate = `${DEFAULT_PROJECT_NAME} (${n})`;
    if (!list.some(p => sameName(p.name, candidate))) return candidate;
  }
}

// Asks for a name for a brand-new project, and settles what to do if that name
// is already in use. Returns { name, overwriteId } — overwriteId is the id of an
// existing project to replace, or null to create a new one — or null if the
// person backed out (or the check couldn't be made).
async function chooseNewProjectName() {
  let suggested = suggestProjectName(await fetchProjectList());

  for (;;) {
    const entered = await appPrompt('Name this project:', suggested, 'Save Project');
    if (!entered || !entered.trim()) return null;
    const name = entered.trim();

    const list = await fetchProjectList();
    if (!list) {
      // Don't save "blind": going ahead without checking is exactly how duplicates happen.
      await appAlert('Couldn\'t check your existing projects just now, so this hasn\'t been saved. Please try again.', 'Save Project');
      return null;
    }

    // Newest first, so if there are already several with this name (from
    // before this check existed) the most recently touched one is the target.
    const clashes = list
      .filter(p => sameName(p.name, name))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id);
    if (clashes.length === 0) return { name, overwriteId: null };

    const target = clashes[0];
    const sheets = `${target.sheet_count} sheet${target.sheet_count === 1 ? '' : 's'}`;
    let message = `A project named "${target.name}" already exists (${sheets}, last updated ${target.updated_at}).`;
    if (clashes.length > 1) {
      message += `\n\nYou have ${clashes.length} projects with this name — this would overwrite the most recently updated one.`;
    }
    message += `\n\nOverwrite it with the project you're working on now? Its current contents will be replaced and can't be recovered.`;

    const overwrite = await appConfirm(message, 'Project name already in use', { okText: 'Overwrite', cancelText: 'Choose another name' });
    if (overwrite) return { name: target.name, overwriteId: target.id }; // keep the stored name exactly as it was
    suggested = name; // back to the name prompt, with what they typed still there to edit
  }
}

let saveInFlight = false;

export async function saveProjectToServer() {
  // A second click (or trigger) while this one is still in a dialog or a request
  // would race it — and could create the very duplicate this is here to prevent.
  if (saveInFlight) return;
  saveInFlight = true;
  try {
    await saveProjectFlow(false); // false: reuse the already-open project if there is one — a plain Save
  } finally {
    saveInFlight = false;
  }
}

// "Save As": opens the My Projects window as a place to put a copy: choose a folder (Pro), give the copy a name and
// "Save here". The original is left exactly as it was and work carries on in the new copy, the same as Save As anywhere
// else. Typing the name of an existing project asks before replacing it.
export async function saveProjectAsToServer() {
  await openMyProjectsModal('saveas');
}

export function pickSaveAsName(id) {
  const p = cachedProjectList.find(x => x.id === id);
  const input = document.getElementById('projectSaveAsName');
  if (p && input) { input.value = p.name; input.focus(); }
}

export async function confirmSaveAs() {
  if (saveInFlight) return;
  const input = document.getElementById('projectSaveAsName');
  const name = (input?.value || '').trim();
  if (!name) { await appAlert('Type a name for the copy.', 'Save As'); return; }
  saveInFlight = true;
  try {
    const list = await fetchProjectList();
    if (!list) { await appAlert('Couldn\'t check your existing projects just now, so this hasn\'t been saved. Please try again.', 'Save As'); return; }
    const folder = organiseEnabled && projectView.folder !== '*' ? projectView.folder : '';

    let targetId = null, saveName = name;
    const clashes = list.filter(p => sameName(p.name, name)).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id);
    if (clashes.length) {
      const target = clashes[0];
      const overwrite = await appConfirm(`A project named "${target.name}" already exists (${target.sheet_count} sheet${target.sheet_count === 1 ? '' : 's'}, last updated ${target.updated_at}).\n\nReplace it with the project you're working on now? Its current contents can't be recovered.`, 'Project name already in use', { okText: 'Replace', cancelText: 'Choose another name' });
      if (!overwrite) return;
      targetId = target.id; saveName = target.name;
    }

    const { ok, data } = await apiFetch('/projects/save.php', { method: 'POST', body: JSON.stringify({ id: targetId, name: saveName, data: buildPortfolioSnapshot() }) });
    if (!ok || !data?.success) { await appAlert(data?.message || 'Could not save this project. Please try again.', 'Save As'); return; }

    if (organiseEnabled) {
      // Filed where it was saved. (If this fails the copy is still saved, just unfiled.)
      await apiFetch('/projects/organise.php', { method: 'POST', body: JSON.stringify({ action: 'details', id: data.id, folder }) });
    }
    currentProjectId = data.id;
    currentProjectName = saveName;
    updateProjectNameDisplay();
    closeMyProjectsModal();

    const indicator = document.getElementById('autosaveIndicator');
    if (indicator) {
      indicator.textContent = folder ? `Saved to ${folder}` : 'Saved to your account';
      setTimeout(() => { if (indicator.textContent.startsWith('Saved to')) indicator.textContent = ''; }, 2500);
    }
  } finally {
    saveInFlight = false;
  }
}

async function saveProjectFlow(forcePrompt) {
  let name = currentProjectName;
  let targetId = currentProjectId; // null = create a new project

  if (targetId === null || forcePrompt) {
    const chosen = await chooseNewProjectName();
    if (!chosen) return;
    name = chosen.name;
    targetId = chosen.overwriteId; // null unless they agreed to overwrite an existing (possibly different) project
  }

  const snapshot = buildPortfolioSnapshot();
  const { ok, data } = await apiFetch('/projects/save.php', {
    method: 'POST',
    body: JSON.stringify({ id: targetId, name, data: snapshot }),
  });

  if (!ok || !data?.success) {
    await appAlert(data?.message || 'Could not save this project. Please try again.');
    return;
  }

  currentProjectId = data.id;
  currentProjectName = name;
  updateProjectNameDisplay();

  const indicator = document.getElementById('autosaveIndicator');
  if (indicator) {
    indicator.textContent = 'Saved to your account';
    setTimeout(() => { if (indicator.textContent === 'Saved to your account') indicator.textContent = ''; }, 2500);
  }
}

export async function startNewProject() {
  const proceed = await appConfirm('Start a new project? Anything unsaved in the current one will be lost.');
  if (!proceed) return;
  // Consumed once by resumeMostRecentProject() below, on the reload this
  // triggers — otherwise startup would just resume the very project being
  // left, since it's still the most recently updated one until something
  // new gets saved.
  sessionStorage.setItem('ssStartBlankProject', '1');
  location.reload();
}

let autosaveInFlight = false;

// The server-side replacement for the old localStorage autosave — called
// via window.autosaveToServer from scheduleAutosave() in 1_config_state.js.
// Updates whichever project is already open (currentProjectId), the same
// way an explicit Save does but without the name prompt; the very first
// autosave of a brand-new, never-saved session instead creates one
// silently, under a name nobody has to choose in the moment — they can
// always rename it later from the Project field or My Projects.
export async function autosaveToServer() {
  if (autosaveInFlight || saveInFlight) return; // never race an explicit Save, or pile up overlapping autosaves
  autosaveInFlight = true;
  try {
    let targetId = currentProjectId;
    let name = currentProjectName;

    if (targetId === null) {
      name = suggestProjectName(await fetchProjectList());
    }

    const snapshot = buildPortfolioSnapshot();
    const { ok, data } = await apiFetch('/projects/save.php', {
      method: 'POST',
      body: JSON.stringify({ id: targetId, name, data: snapshot }),
    });

    const indicator = document.getElementById('autosaveIndicator');
    if (!ok || !data?.success) {
      console.warn('Autosave to server failed:', data?.message || `HTTP ${data ? '' : 'error'}`);
      if (sessionLost) return;   // markSessionLost() has already said why, next to the save status
      if (indicator) indicator.textContent = data?.message ? `Autosave failed: ${data.message}` : 'Autosave failed — click Save to see why';
      return;
    }

    currentProjectId = data.id;
    currentProjectName = name;
    updateProjectNameDisplay();

    if (indicator) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      indicator.textContent = `Autosaved ${hh}:${mm}:${ss}`;
    }
  } catch (err) {
    // No connection (or the server did not answer): keep the work on screen and try again when it is back.
    const indicator = document.getElementById('autosaveIndicator');
    if (indicator) indicator.textContent = 'Offline \u2014 will save when the connection returns';
    const retry = () => { window.removeEventListener('online', retry); if (typeof window.autosaveToServer === 'function') window.autosaveToServer(); };
    window.addEventListener('online', retry);
  } finally {
    autosaveInFlight = false;
  }
}

// Called once at startup (see main.js). Loads whichever of this user's own
// saved projects was most recently updated, so logging in resumes where
// they left off — no "restore?" prompt needed, since (unlike the old
// localStorage approach) a server-side project is already unambiguously
// this account's own; there's nothing to ask permission about. A brand-new
// account with nothing saved yet, or a tab that just explicitly started a
// new project, gets a blank sheet instead — never a stale prompt.
export async function resumeMostRecentProject() {
  if (sessionStorage.getItem('ssStartBlankProject')) {
    sessionStorage.removeItem('ssStartBlankProject');
    return false;
  }

  const list = await fetchProjectList();
  if (!list || list.length === 0) return false;

  const mostRecent = [...list].sort((a, b) =>
    String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id
  )[0];
  await openProjectFromServer(mostRecent.id);
  return true;
}
