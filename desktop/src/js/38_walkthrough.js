// The welcome tour: a short spotlight walk round the editor, then two hands-on steps (place two symbols, wire
// them together). It starts by itself for a new account (window.autoTour, set by index.php) and can be taken again
// from the Tour button. Finishing or skipping it is remembered on the account (auth/tour.php) and in the browser.
//
// The spotlight is a hole drawn over the real control with a huge shadow around it, so the page stays live under it:
// the hands-on steps need the person to drag and click the real editor. Steps that only explain put an invisible
// layer over the page so a stray click cannot change anything while reading.
import { getActiveSheet } from './1_config_state.js';

const SEEN_KEY = 'schematicstudio_tour_seen';
const sheetCount = (key) => (getActiveSheet()?.[key] || []).length;

const WIRE_BTN = '#ribbonContent-home button[onclick="setTool(\'wire\')"]';
const NEW_PROJECT_BTN = '#ribbonContent-project button[onclick="startNewProject()"]';
const SHEET_PROPS_BTN = '#ribbonContent-project button[onclick="openSheetPropsModal()"]';
const LIBRARY_BTN = '#sidebar button[onclick="openBrowseLibrariesModal()"]';
const symbolCount = () => Object.keys(window.customSymbolDefinitions || {}).length;
const modalOpen = (id) => { const m = document.getElementById(id); return !!m && getComputedStyle(m).display !== 'none'; };

// kind 'info': read and press Next. kind 'action': do it in the editor; Next lights up when it is done.
const STEPS = [
  { kind: 'info', title: 'Welcome to SchematicStudio',
    text: 'A two-minute tour of the editor, then you will draw your first little circuit. You can stop at any time and come back to it with the Tour button.',
    next: 'Start the tour' },
  { kind: 'info', target: '.ribbon-tabs', place: 'bottom', title: 'The ribbon',
    text: 'Everything you can do is in these tabs: Home for the drawing tools, Project for sheets and revisions, Insert, Draw, Reports and View. Hover over any button to see what it does.',
    before: () => window.setRibbonTab?.('home') },
  { kind: 'info', target: NEW_PROJECT_BTN, place: 'bottom', title: 'Projects',
    text: 'A project is your whole drawing set, sometimes called a portfolio: every sheet, cable and part list in one file. New Project starts a blank one. The folder button at the top reopens the ones you have saved. You already have a first sheet open and ready.',
    before: () => window.setRibbonTab?.('project') },
  { kind: 'action', target: SHEET_PROPS_BTN, alt: '#sheetPropsModal .modal-card', title: 'Try it: set up your sheet',
    text: 'Click Sheet Properties. Choose the paper size and orientation, change the Title, then close the box with the cross at its top right. The title and details you set here fill the title block on the sheet.',
    done: 'Your sheet is set up. You can change these at any time. Press Next to go on.',
    before: () => window.setRibbonTab?.('project'),
    start: () => ({ saw: false }),
    check: (s) => { const open = modalOpen('sheetPropsModal'); if (open) s.saw = true; return s.saw && !open; } },
  { kind: 'info', target: '#tab-bar', place: 'top', title: 'Sheets and pages',
    text: 'A project is a set of sheets, one tab each. Add schematic sheets, a Title Page, a Contents page and a Bill of Materials. The last three fill themselves in from your drawing. The Portfolio button on the left lists every sheet at a glance and lets you choose which ones get a tab.' },
  { kind: 'info', target: '#saveBtn', place: 'bottom', title: 'Saving',
    text: 'Your work is saved to your account as you go, so you can carry on from any computer. This button saves straight away.' },
  { kind: 'info', target: '#sidebar', place: 'right', title: 'Your symbols',
    text: 'Symbols live in this panel: a few built in, plus any libraries you import. Drag one onto the sheet, press R to turn it, and double-click it to give it a name, value and part number. You can also draw your own in Symbol Studio.' },
  { kind: 'action', target: LIBRARY_BTN, alt: '#browseLibrariesModal .modal-card', title: 'Try it: add a symbol library',
    text: 'A new account starts with only a few built-in symbols. Click Browse Libraries, then Import next to Basic to add a set of common electrical symbols to the panel.',
    done: 'Library added. Its symbols are in the panel now. Press Next to place some.',
    // nothing to do for an account that already has symbols, or one that cannot use libraries (the button is greyed out)
    skipIf: () => { const b = document.querySelector(LIBRARY_BTN); return !b || b.disabled || symbolCount() > 0; },
    start: () => ({ n: symbolCount() }),
    check: (s) => symbolCount() > s.n },
  { kind: 'action', target: '#sidebar', title: 'Try it: place two symbols',
    text: 'Drag any two symbols from the panel on the left onto the sheet, a little apart.',
    done: 'Two symbols placed. Press Next to wire them together.',
    start: () => ({ components: sheetCount('components') }),
    check: (s) => sheetCount('components') >= s.components + 2 },
  { kind: 'action', target: WIRE_BTN, title: 'Try it: draw a wire',
    text: 'Choose Wire, click a pin on one symbol, click along the route to add corners, and finish by clicking a pin on the other symbol. Wires run at right angles and snap to the pins. Esc cancels.',
    done: 'You have drawn a wire. Press Next to finish.',
    before: () => window.setRibbonTab?.('home'),
    start: () => ({ wires: sheetCount('wires') }),
    check: (s) => sheetCount('wires') > s.wires },
  { kind: 'info', target: '#ribbonContent-reports', place: 'bottom', title: 'Reports and the Bill of Materials',
    text: 'The Reports tab turns your drawing into paperwork: the Bill of Materials, wire and terminal markers, and cable reports, all worked out from what you have drawn. That is the tour. The Tour button replays it, and the ? button opens the full guide.',
    before: () => window.setRibbonTab?.('reports'), next: 'Finish' }
];

const CSS = `
.tour-block { position: fixed; inset: 0; z-index: 100000; background: transparent; }
.tour-block.tour-dim { background: rgba(0,0,0,0.62); }
.tour-hole { position: fixed; z-index: 100001; pointer-events: none; border-radius: 6px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 2px var(--accent, #479ef5); transition: all .18s ease; }
.tour-hole.tour-light { box-shadow: 0 0 0 9999px rgba(0,0,0,0.32), 0 0 0 2px var(--accent, #479ef5); }
.tour-hole.tour-pulse { animation: tourPulse 1.6s ease-in-out infinite; }
@keyframes tourPulse { 0%, 100% { outline: 2px solid rgba(71,158,245,0); outline-offset: 2px; } 50% { outline: 2px solid rgba(71,158,245,0.9); outline-offset: 5px; } }
.tour-card { position: fixed; z-index: 100002; width: 340px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 16px 18px 14px; border-radius: 8px;
  background: var(--bg-panel-raised, #333); color: var(--text, #fff); border: 1px solid var(--border-light, #525252); box-shadow: 0 8px 28px rgba(0,0,0,0.5); font: 13px/1.5 system-ui, sans-serif; }
.tour-card h4 { margin: 0 0 6px; font-size: 15px; }
.tour-card p { margin: 0 0 12px; color: var(--text-muted, #c8c8c8); }
.tour-card p.tour-done { color: #4ade80; font-weight: 600; }
.tour-foot { display: flex; align-items: center; gap: 8px; }
.tour-count { font-size: 11px; color: var(--text-faint, #9c9c9c); margin-right: auto; white-space: nowrap; }
.tour-btn { border: 1px solid var(--border-light, #525252); background: transparent; color: var(--text, #fff); border-radius: 4px; padding: 5px 12px; font: inherit; cursor: pointer; }
.tour-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
.tour-btn:disabled { opacity: .45; cursor: default; }
.tour-btn.tour-primary { background: var(--primary, #0078d4); border-color: var(--primary, #0078d4); color: #fff; font-weight: 600; }
.tour-btn.tour-primary:hover:not(:disabled) { background: var(--primary-hover, #106ebe); }
.tour-link { background: none; border: 0; padding: 0; color: var(--text-faint, #9c9c9c); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; }
.tour-link:hover { color: var(--text, #fff); }
.tour-bar { display: flex; align-items: center; margin-bottom: 8px; }
.tour-link { white-space: nowrap; }
`;

let session = null;

function rememberSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private window: the account flag below still counts */ }
  try {
    fetch('/auth/tour.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.csrfToken || '' }, body: '{}' }).catch(() => {});
  } catch (e) { /* best effort */ }
}
function seenInBrowser() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
}

function usable(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

export function startWalkthrough() {
  if (session) return;
  if (!document.getElementById('tour-style')) {
    const style = document.createElement('style');
    style.id = 'tour-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const block = document.createElement('div');
  block.className = 'tour-block';
  const hole = document.createElement('div');
  hole.className = 'tour-hole';
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.append(block, hole, card);

  // which steps do not apply to this person, worked out once so the step numbers stay put as they work
  const skipped = STEPS.map(st => !!(st.skipIf && st.skipIf()));
  session = { index: 0, direction: 1, state: null, done: false, block, hole, card, timer: null, skipped };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  session.timer = setInterval(tick, 250);
  show(0, 1);
}

function end() {
  if (!session) return;
  clearInterval(session.timer);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', place);
  session.block.remove(); session.hole.remove(); session.card.remove();
  session = null;
  window.setRibbonTab?.('home');
  rememberSeen();
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
}

function show(index, direction) {
  // a control that is not on screen (a narrow window, say) cannot be pointed at: step over its stage
  while (index >= 0 && index < STEPS.length) {
    const s = STEPS[index];
    if (s.before) s.before();
    if (session.skipped[index]) { index += direction; continue; }
    if (!s.target || usable(document.querySelector(s.target))) break;
    index += direction;
  }
  if (index < 0) index = 0;
  if (index >= STEPS.length) { end(); return; }
  session.index = index; session.direction = direction;
  const step = STEPS[index];
  session.state = step.start ? step.start() : null;
  session.done = false;
  render();
  if (direction < 0 && step.kind === 'action') completeAction();   // coming back to a step already done: it stays done
}

function render() {
  const { index, card, hole, block } = session;
  const step = STEPS[index];
  const action = step.kind === 'action';
  const last = index === STEPS.length - 1;
  block.style.display = action ? 'none' : '';
  block.classList.toggle('tour-dim', !step.target);
  hole.style.display = step.target ? '' : 'none';
  hole.classList.toggle('tour-light', action);
  hole.classList.toggle('tour-pulse', action);
  card.innerHTML = '';
  const bar = document.createElement('div'); bar.className = 'tour-bar';
  const count = document.createElement('span'); count.className = 'tour-count'; count.textContent = `Step ${session.skipped.slice(0, index + 1).filter(x => !x).length} of ${session.skipped.filter(x => !x).length}`;
  bar.append(count);
  if (!last) {
    const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'tour-link'; skip.textContent = 'Skip tour';
    skip.onclick = end;
    bar.append(skip);
  }
  const h = document.createElement('h4'); h.textContent = step.title;
  const p = document.createElement('p'); p.textContent = step.text; p.id = 'tourText';
  const foot = document.createElement('div'); foot.className = 'tour-foot';
  if (action) {
    const pass = document.createElement('button'); pass.type = 'button'; pass.className = 'tour-link'; pass.id = 'tourPass'; pass.textContent = 'Skip this step';
    pass.onclick = () => show(index + 1, 1);
    foot.append(pass);
  }
  const spacer = document.createElement('span'); spacer.style.marginLeft = 'auto';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'tour-btn'; back.textContent = 'Back';
  back.disabled = index === 0; back.onclick = () => show(index - 1, -1);
  const next = document.createElement('button'); next.type = 'button'; next.className = 'tour-btn tour-primary'; next.id = 'tourNext';
  next.textContent = step.next || (last ? 'Finish' : 'Next');
  next.disabled = action; next.onclick = () => { if (last) end(); else show(index + 1, 1); };
  foot.append(spacer, back, next);
  card.append(bar, h, p, foot);
  place();
}

// Keeps the hole on its control and the card beside it, whatever moves or resizes underneath.
function place() {
  if (!session) return;
  const step = STEPS[session.index];
  const { hole, card } = session;
  const pad = 4, margin = 12;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left, top;
  const alt = step.alt ? document.querySelector(step.alt) : null;   // a box the step opens: point at that while it is open
  const el = step.target ? (usable(alt) ? alt : document.querySelector(step.target)) : null;
  if (step.target && usable(el)) {
    const r = el.getBoundingClientRect();
    hole.style.left = `${r.left - pad}px`; hole.style.top = `${r.top - pad}px`;
    hole.style.width = `${r.width + 2 * pad}px`; hole.style.height = `${r.height + 2 * pad}px`;
    if (step.kind === 'action') {
      // out of the way of the sheet, which is where the person is working
      left = vw - cw - 24; top = vh - ch - 56;
    } else if (step.place === 'right') { left = r.right + 16; top = r.top + 8; }
    else if (step.place === 'top') { left = r.left + 8; top = r.top - ch - 16; }
    else { left = r.left; top = r.bottom + 16; }
  } else {
    left = (vw - cw) / 2; top = (vh - ch) / 2;
  }
  card.style.left = `${Math.max(margin, Math.min(left, vw - cw - margin))}px`;
  card.style.top = `${Math.max(margin, Math.min(top, vh - ch - margin))}px`;
}

function tick() {
  if (!session) return;
  place();
  const step = STEPS[session.index];
  if (step.kind !== 'action' || session.done) return;
  if (step.check(session.state)) completeAction();
}

// The hands-on step is done: say so and let the person go on.
function completeAction() {
  const step = STEPS[session.index];
  session.done = true;
  const p = session.card.querySelector('#tourText');
  if (p) { p.textContent = step.done; p.className = 'tour-done'; }
  const next = session.card.querySelector('#tourNext');
  if (next) next.disabled = false;
  session.card.querySelector('#tourPass')?.remove();
  session.hole.classList.remove('tour-pulse');
  place();
}

// Called once the editor has loaded: a new account gets the tour by itself, once.
export function maybeStartWalkthrough() {
  if (!window.autoTour || seenInBrowser()) return;
  const modalOpen = () => [...document.querySelectorAll('.modal-overlay')].some(m => getComputedStyle(m).display !== 'none');
  setTimeout(() => { if (!modalOpen()) startWalkthrough(); }, 800);
}
