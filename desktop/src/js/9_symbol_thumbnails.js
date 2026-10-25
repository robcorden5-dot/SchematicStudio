// ==========================================
// 9. SYMBOL THUMBNAILS (sidebar previews)
// ==========================================
// A small picture of each symbol beside its name in the sidebar, drawn as an
// inline SVG from the same artwork the sheet uses: its path segments (with
// their dashed / dotted styles) and its pin positions.
//
// buildSymbolThumbnailSvg() is a pure function returning markup. Everything in
// that markup is either a number this module computed or path data that has
// passed the character check below — never a name or key — so it is safe to
// assign with innerHTML.
import { normalizePathData, getPinsForType, repairArcFlags, BUILTIN_SYMBOL_GEOMETRY, symbolTextSvgAttrs } from './1_config_state.js';

const THUMB_WIDTH = 62;   // the picture's box, in CSS pixels
const THUMB_HEIGHT = 42;
const INK = '#0f172a';    // the same near-black the sheet draws symbols in
const PIN_COLOUR = '#2563eb';
const LINE_WEIGHT = 1.6;  // constant on screen, however large the symbol — see vector-effect below
const PIN_RADIUS = 2.4;   // the biggest a pin dot gets, in screen pixels
const MIN_PIN_RADIUS = 0.7; // smaller than this and a dot is just a smudge

// Dash patterns in screen pixels (the sheet's own patterns are in sheet units,
// which would vanish when a large symbol is shrunk to a thumbnail).
const THUMB_DASH = { dashed: '3 2', dotted: '0.8 1.8', dashdashline: '3 1.5 3 1.5 6 1.5' };

// Only the characters genuine SVG path data is made of. Anything else (quotes,
// angle brackets, letters that aren't path commands...) means the segment isn't
// drawn, so odd or hostile data in an imported library can't break the markup.
const SAFE_PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

const num = v => (Number.isFinite(v) ? +v.toFixed(3) : 0);

// Points along an SVG arc (endpoint form -> centre form, per the SVG spec's
// implementation notes), so the picture is fitted to where the arc really goes
// rather than just its two end points — a coil's circle bulges well past them.
function sampleArc(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2, out) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) { out.push([x2, y2]); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2, y1p = -sinP * dx2 + cosP * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; } // radii too small to span the points: scaled up, as renderers do
  const num1 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num1 / den));
  const cxp = coef * ((rx * y1p) / ry), cyp = coef * (-(ry * x1p) / rx);
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2, cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const STEPS = 32;
  for (let i = 0; i <= STEPS; i++) {
    const th = theta1 + (dTheta * i) / STEPS;
    out.push([cx + rx * Math.cos(th) * cosP - ry * Math.sin(th) * sinP, cy + rx * Math.cos(th) * sinP + ry * Math.sin(th) * cosP]);
  }
}

// Every point a path segment visits, for fitting the picture. Handles what the
// Symbol Studio writes (M, L, A, Z); for anything else the segment is still
// drawn, just not counted towards the fit.
function collectPathPoints(d, out) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = '', cx = 0, cy = 0, startX = 0, startY = 0;
  const read = count => { const vals = tokens.slice(i, i + count).map(Number); i += count; return vals.length === count && vals.every(Number.isFinite) ? vals : null; };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i++]; if (/z/i.test(cmd)) { cx = startX; cy = startY; } continue; }
    if (cmd === 'M' || cmd === 'L') {
      const v = read(2); if (!v) return;
      [cx, cy] = v; out.push([cx, cy]);
      if (cmd === 'M') { startX = cx; startY = cy; cmd = 'L'; } // further pairs after an M are implicit line-tos
    } else if (cmd === 'A') {
      const v = read(7); if (!v) return;
      sampleArc(cx, cy, v[0], v[1], v[2], v[3] ? 1 : 0, v[4] ? 1 : 0, v[5], v[6], out);
      cx = v[5]; cy = v[6];
    } else {
      return; // a command this doesn't fit-measure
    }
  }
}

// How big to draw the pin dots. Normally PIN_RADIUS, but a wide symbol with many
// pins (a safety relay, a PSU) shrinks to a thumbnail with its pins only a pixel
// or two apart, and full-size dots would merge into a blue smear over the
// drawing. So: dots small enough to keep clear of each other, and none at all
// where even that would be too small to see.
function pinDotRadius(pinPoints, scale) {
  let closest = Infinity; // the smallest gap between two pins, in screen pixels
  for (let i = 0; i < pinPoints.length; i++) {
    for (let j = i + 1; j < pinPoints.length; j++) {
      const gap = Math.hypot(pinPoints[i].relX - pinPoints[j].relX, pinPoints[i].relY - pinPoints[j].relY) * scale;
      if (gap > 1e-9) closest = Math.min(closest, gap); // two pins at one spot are one dot
    }
  }
  const r = Math.min(PIN_RADIUS, closest * 0.3); // 0.3 each side leaves a clear gap of 40% between neighbours
  return r >= MIN_PIN_RADIUS ? r : 0;
}

// The markup for one symbol's thumbnail. `pathData` is a symbol's pathData (a
// string, or an array of { d, dash } segments); `pins` its [{ relX, relY }].
export function buildSymbolThumbnailSvg(pathData, pins = [], { width = THUMB_WIDTH, height = THUMB_HEIGHT, texts = [], lineWeight = LINE_WEIGHT, pinRadius = PIN_RADIUS, fixedScale = 0 } = {}) {
  // A browser is strict about SVG path data where Konva (which draws the sheet) is lenient: an arc flag
  // must be exactly 0 or 1, and damaged symbols carry 2s and 4s. Fixed here as well as on load, so this
  // can never put a path in the page that the browser rejects, whatever the data's history.
  const segments = normalizePathData(pathData)
    .filter(seg => seg && typeof seg.d === 'string' && seg.d.trim() && SAFE_PATH_DATA.test(seg.d))
    .map(seg => ({ ...seg, d: repairArcFlags(seg.d) }));
  const pinPoints = (Array.isArray(pins) ? pins : []).filter(p => p && Number.isFinite(p.relX) && Number.isFinite(p.relY));

  const points = [];
  segments.forEach(seg => collectPathPoints(seg.d, points));
  pinPoints.forEach(p => points.push([p.relX, p.relY]));

  // Text on the symbol (only the large preview asks for it). Sized the way the sheet draws it: the stored
  // font size is halved. A text's width is estimated, which is enough to keep it inside the picture.
  const labels = (Array.isArray(texts) ? texts : []).filter(t => t && typeof t.text === 'string' && t.text.trim() && Number.isFinite(t.relX) && Number.isFinite(t.relY))
    .map(t => ({ text: t.text.slice(0, 60), x: t.relX, y: t.relY, size: (Number.isFinite(t.fontSize) && t.fontSize > 0 ? t.fontSize : 12) * 0.5, rotation: Number.isFinite(t.rotation) ? t.rotation : 0, attrs: symbolTextSvgAttrs(t) }));
  labels.forEach(t => {
    const len = t.text.length * t.size * 0.6;
    points.push([t.x, t.y]);
    if (t.rotation === 0) points.push([t.x + len, t.y + t.size]); else points.push([t.x + t.size, t.y - len]);
  });

  const makeOpen = (w_, h_) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w_}" height="${h_}" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision" aria-hidden="true" focusable="false"`;
  let open = makeOpen(width, height);
  if (segments.length === 0 || points.length === 0) {
    // Nothing drawable (a symbol with no artwork yet): a faint dashed box, so the row still lines up.
    return `${open} viewBox="0 0 ${width} ${height}"><rect x="6" y="5" width="${width - 12}" height="${height - 10}" rx="3" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 2"/></svg>`;
  }

  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1); // a single straight line has no width or no height
  const pad = Math.max(w, h) * 0.05 + 2;
  const vbW = w + 2 * pad, vbH = h + 2 * pad;
  // fixedScale: draw at exactly that many pixels per sheet unit, sized to the artwork (used for the
  // picture that follows the pointer when a symbol is dragged onto the sheet).
  const scale = fixedScale > 0 ? fixedScale : Math.min(width / vbW, height / vbH);
  if (fixedScale > 0) open = makeOpen(Math.ceil(vbW * fixedScale), Math.ceil(vbH * fixedScale));
  const viewBox = `${num(minX - pad)} ${num(minY - pad)} ${num(vbW)} ${num(vbH)}`;

  const paths = segments.map(seg => {
    const dash = THUMB_DASH[seg.dash];
    return `<path d="${seg.d.trim()}"${dash ? ` stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const dotRadius = pinDotRadius(pinPoints, scale) * (pinRadius / PIN_RADIUS);   // a bigger picture may draw bigger dots (0 stays 0: pins too close for any)
  const pinDots = dotRadius ? pinPoints.map(p => `<circle cx="${num(p.relX)}" cy="${num(p.relY)}" r="${num(dotRadius / scale)}"/>`).join('') : '';

  const escapeXml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labelMarkup = labels.map(t => `<text x="${num(t.x)}" y="${num(t.y + t.size * 0.8)}" font-size="${num(t.size)}"${t.attrs}${t.rotation ? ` transform="rotate(${num(t.rotation)} ${num(t.x)} ${num(t.y)})"` : ''}>${escapeXml(t.text)}</text>`).join('');

  return `${open} viewBox="${viewBox}">` +
    `<g fill="none" stroke="${INK}" stroke-width="${lineWeight}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<g fill="${PIN_COLOUR}">${pinDots}</g>` +
    (labelMarkup ? `<g fill="${INK}" font-family="sans-serif">${labelMarkup}</g>` : '') + `</svg>`;
}

// Fills in the thumbnails on the sidebar's built-in symbols (Ground, the supply
// symbols), whose rows are static markup marked data-builtin-symbol="<type>".
export function renderBuiltinSymbolThumbnails() {
  document.querySelectorAll('[data-builtin-symbol]').forEach(row => {
    const type = row.getAttribute('data-builtin-symbol');
    const art = BUILTIN_SYMBOL_GEOMETRY[type];
    const slot = row.querySelector('.symbol-thumb');
    if (!art || !slot) return;
    slot.innerHTML = buildSymbolThumbnailSvg(art.pathData, getPinsForType(type));
  });
}

// ---- the large preview ----
// Pointing at a symbol in the sidebar shows it large, beside the sidebar, with its text and pins,
// so the small picture never has to be squinted at. One panel, filled in for whichever row is under
// the pointer. Built-in rows carry data-builtin-symbol, custom ones data-symbol-key.
const PREVIEW_WIDTH = 360, PREVIEW_HEIGHT = 250, PREVIEW_DELAY_MS = 180;

function previewFor(row) {
  const builtin = row.getAttribute('data-builtin-symbol');
  if (builtin) {
    const art = BUILTIN_SYMBOL_GEOMETRY[builtin];
    if (!art) return null;
    return { name: (row.querySelector('.symbol-name')?.textContent || builtin), detail: row.title || '', pathData: art.pathData, pins: getPinsForType(builtin), texts: art.texts || [] };
  }
  const key = row.getAttribute('data-symbol-key');
  const def = key && window.customSymbolDefinitions && window.customSymbolDefinitions[key];
  if (!def) return null;
  const title = String(def.name ?? key);
  const extra = [def.make, def.modelNo].filter(v => v && !title.includes(v)).join(' ');   // make and model, unless the name already says them
  const detail = [extra, def.description].filter(Boolean).join(' \u2013 ');
  return { name: String(def.name ?? key), detail, pathData: def.pathData, pins: def.pins, texts: def.texts || [] };
}

export function initSymbolPreview() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || document.getElementById('symbolPreview')) return;
  const panel = document.createElement('div');
  panel.id = 'symbolPreview';
  panel.setAttribute('aria-hidden', 'true');
  panel.style.cssText = `position:fixed; z-index:2000; display:none; pointer-events:none; width:${PREVIEW_WIDTH}px; box-sizing:border-box; padding:10px; background:#ffffff; border:1px solid #94a3b8; border-radius:8px; box-shadow:0 12px 32px rgba(0,0,0,0.45); color:#0f172a; font:12px/1.35 "Segoe UI", sans-serif;`;
  const picture = document.createElement('div');
  const name = document.createElement('div');
  name.style.cssText = 'font-weight:700; font-size:13px; margin-top:6px;';
  const detail = document.createElement('div');
  detail.style.cssText = 'color:#475569;';
  panel.appendChild(picture); panel.appendChild(name); panel.appendChild(detail);
  document.body.appendChild(panel);

  let current = null, timer = null;
  const hide = () => { clearTimeout(timer); timer = null; current = null; panel.style.display = 'none'; };
  const show = (row) => {
    const info = previewFor(row);
    if (!info) { hide(); return; }
    picture.innerHTML = buildSymbolThumbnailSvg(info.pathData, info.pins, { width: PREVIEW_WIDTH - 22, height: PREVIEW_HEIGHT - 70, texts: info.texts, lineWeight: 1.8, pinRadius: 3.2 });
    name.textContent = info.name;
    detail.textContent = info.detail;
    detail.style.display = info.detail ? 'block' : 'none';
    panel.style.display = 'block';
    const side = sidebar.getBoundingClientRect(), at = row.getBoundingClientRect();
    const h = panel.offsetHeight;
    panel.style.left = `${Math.round(side.right + 10)}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, at.top + at.height / 2 - h / 2)))}px`;
  };

  sidebar.addEventListener('mouseover', (e) => {
    const row = e.target.closest && e.target.closest('.symbol-item');
    if (!row || !sidebar.contains(row)) return;
    if (row === current) return;
    clearTimeout(timer);
    current = row;
    timer = setTimeout(() => show(row), panel.style.display === 'block' ? 0 : PREVIEW_DELAY_MS);   // straight away once one is already showing, so moving down the list feels smooth
  });
  sidebar.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    if (to && current && current.contains(to)) return;
    if (to && to.closest && to.closest('.symbol-item') && sidebar.contains(to)) return;   // the next row's mouseover takes over
    hide();
  });
  sidebar.addEventListener('mouseleave', hide);
  sidebar.addEventListener('dragstart', hide);
  sidebar.addEventListener('mousedown', hide);
  sidebar.addEventListener('scroll', hide, true);
}

// ---- the picture that follows the pointer while a symbol is dragged onto the sheet ----
// Drawn at the sheet's current zoom, with the symbol's own origin (where it will be placed) under the
// pointer. A browser needs the picture loaded before the drag starts, so it is prepared when the
// pointer reaches the symbol in the sidebar and looked up when the drag begins.
const ghostCache = new Map();
function ghostArtFor(type) {
  const art = BUILTIN_SYMBOL_GEOMETRY[type];
  if (art) return { pathData: art.pathData, pins: getPinsForType(type), texts: art.texts || [] };
  const def = window.customSymbolDefinitions && window.customSymbolDefinitions[type];
  return def ? { pathData: def.pathData, pins: def.pins || [], texts: def.texts || [] } : null;
}

export function prepareSymbolDragImage(type, scale) {
  const sc = Math.min(8, Math.max(0.2, Math.round((Number(scale) || 1) * 20) / 20));
  const key = `${type}@${sc}`;
  if (ghostCache.has(key)) return;
  const art = ghostArtFor(type);
  if (!art) return;
  const svg = buildSymbolThumbnailSvg(art.pathData, art.pins, { texts: art.texts, fixedScale: sc, lineWeight: Math.max(1, 1.2 * sc), pinRadius: Math.max(PIN_RADIUS, 2 * sc) });
  const vb = svg.match(/viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/);
  if (!vb) return;
  const img = new Image();
  const entry = { img, hotX: -parseFloat(vb[1]) * sc, hotY: -parseFloat(vb[2]) * sc };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  ghostCache.set(key, entry);
  if (ghostCache.size > 60) ghostCache.delete(ghostCache.keys().next().value);
}

// Sets the drag picture if one is ready; otherwise the browser's usual one is left in place.
export function applySymbolDragImage(e, type, scale) {
  const sc = Math.min(8, Math.max(0.2, Math.round((Number(scale) || 1) * 20) / 20));
  const entry = ghostCache.get(`${type}@${sc}`);
  if (!entry || !entry.img.complete || !entry.img.naturalWidth || !e.dataTransfer.setDragImage) { prepareSymbolDragImage(type, scale); return; }
  e.dataTransfer.setDragImage(entry.img, entry.hotX, entry.hotY);
}

// Prepares a symbol's drag picture the moment the pointer reaches its row in the sidebar.
export function initSymbolDragImages(getScale) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.addEventListener('pointerover', (ev) => {
    const row = ev.target.closest && ev.target.closest('[data-builtin-symbol], [data-symbol-key]');
    if (!row) return;
    const type = row.getAttribute('data-builtin-symbol') || row.getAttribute('data-symbol-key');
    if (type) prepareSymbolDragImage(type, getScale());
  });
}
