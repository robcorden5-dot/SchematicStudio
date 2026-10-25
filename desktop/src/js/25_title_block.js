// ==========================================
// 25. TITLE BLOCK (templates, field values, drawing)
// ==========================================
// A title block is a template: a list of rectangles, lines, text and (for the ISO 7200
// layout) labelled cells, each text carrying {field} placeholders that are filled from
// the project and the sheet. One drawing routine (buildTitleBlock) draws any template, so
// the standard block and the ISO 7200 preset are just two sets of data.
//
// Three levels of information feed a block (ISO 7200 thinks of it the same way):
//   company  - legal owner and logo                         (state.projectInfo.legalOwner, state.companyLogo)
//   project  - customer, project number, site, defaults     (state.projectInfo)
//   sheet    - title, description, people, dates, status... (the sheet itself)
// A sheet's own value always wins over the project's default, so projects saved before
// these fields existed draw exactly as they did.
//
// state.titleBlock = { templateId }   which block the drawings use (the ISO 7200 preset is Pro)
// state.projectInfo = { legalOwner, projectNumber, customer, site, docPrefix, docPattern, docType, docStatus, language }
import { state, getPageType, findLocationById, isFreePlan, sheetFunctionOf, sheetReferenceOf } from './1_config_state.js';
import { currentRev } from './23_revision_data.js';

// ---------- templates ----------
// Item shapes (all positions are in sheet pixels from the block's top-left corner):
//   { t:'rect', x, y, w, h, sw, fill }                      rectangle
//   { t:'line', pts:[x1,y1,x2,y2], sw }                     line
//   { t:'text', x, y, text, size, bold }                    text; {field} is replaced, 'when' hides it while that field is empty
//   { t:'cell', x, y, w, h, label, text, size, bold, wrap } a boxed field with a small caption
// logo: { x, y, w, h, pad, center } the box a company logo is fitted into.

// The block every drawing has always had: 460 x 132, logo strip on the left.
const sc = (x, y, text, size, bold, when) => ({ t: 'text', x, y, text, size, bold: !!bold, when });
const ln = (x1, y1, x2, y2) => ({ t: 'line', pts: [x1, y1, x2, y2], sw: 1 });
export const TB_STANDARD = {
  id: 'standard', name: 'Standard', width: 460, height: 132,
  logo: { x: 0, y: 0, w: 60, h: 132, pad: 4, center: false },
  items: [
    { t: 'rect', x: 0, y: 0, w: 460, h: 132, sw: 2, fill: '#fff' },
    ln(60, 0, 60, 132), ln(60, 35, 460, 35), ln(60, 65, 460, 65), ln(60, 92, 460, 92), ln(60, 112, 460, 112),
    ln(280, 35, 280, 92), ln(370, 65, 370, 92),
    sc(70, 10, '{title}', 15, true),
    sc(70, 44, 'DESC: {description}', 10), sc(290, 44, 'REV: {rev}', 10),
    sc(70, 73, 'AUTHOR: {author}', 10), sc(290, 73, 'APP: {approvedBy}', 10), sc(375, 73, 'DATE: {createdDate}', 9),
    sc(70, 99, 'SITE: {site}', 9), sc(290, 99, '{sheetLabel}: {sheetNum} / {sheetTotal}', 9, true),
    sc(375, 99, 'LOCATION: {locationTag}', 9, false, 'locationTag'),
    sc(70, 118, 'CUSTOMER: {customer}', 10, true)
  ]
};

// ISO 7200 style: boxed, captioned fields. 540 x 152.
const cell = (x, y, w, h, label, text, size, bold, wrap) => ({ t: 'cell', x, y, w, h, label, text, size: size || 10, bold: !!bold, wrap: !!wrap });
export const TB_ISO7200 = {
  id: 'iso7200', name: 'ISO 7200', width: 540, height: 152,
  logo: { x: 0, y: 0, w: 130, h: 100, pad: 6, center: true },
  items: [
    { t: 'rect', x: 0, y: 0, w: 540, h: 152, sw: 0, fill: '#fff' },
    cell(0, 0, 130, 100, '', ''),
    cell(0, 100, 130, 52, 'LEGAL OWNER', '{legalOwner}', 9, true, true),
    cell(130, 0, 410, 40, 'TITLE', '{title}', 14, true),
    cell(130, 40, 410, 28, 'DESCRIPTION', '{description}', 10),
    cell(130, 68, 100, 28, 'PROJECT NO.', '{projectNumber}', 10),
    cell(230, 68, 150, 28, 'CUSTOMER', '{customer}', 10),
    cell(380, 68, 110, 28, 'SITE', '{site}', 9),
    cell(490, 68, 50, 28, 'LOCATION', '{locationTag}', 9),
    cell(130, 96, 210, 28, 'DOCUMENT NO.', '{docNumber}', 11, true),
    cell(340, 96, 110, 28, 'DOC. TYPE', '{docType}', 9),
    cell(450, 96, 90, 28, 'STATUS', '{docStatus}', 9),
    cell(130, 124, 90, 28, 'CREATED BY', '{author}', 9),
    cell(220, 124, 90, 28, 'APPROVED BY', '{approvedBy}', 9),
    cell(310, 124, 80, 28, 'DATE', '{createdDate}', 9),
    cell(390, 124, 40, 28, 'REV', '{rev}', 11, true),
    cell(430, 124, 40, 28, 'LANG.', '{language}', 9),
    cell(470, 124, 70, 28, '{sheetLabel}', '{sheetNum} / {sheetTotal}', 10, true),
    { t: 'rect', x: 0, y: 0, w: 540, h: 152, sw: 2, fill: null }
  ]
};

export const TB_TEMPLATES = { standard: TB_STANDARD, iso7200: TB_ISO7200 };
export const TB_PRO_TEMPLATES = ['iso7200', 'custom'];

// The template in force: the project's choice, but a Free account always gets the standard block.
// A custom design may have its own layout for each paper size (A4, A3, A2), else the main one.
export function activeTemplate(sheet) {
  const tb = state.titleBlock || {};
  const id = tb.templateId;
  if (id === 'custom') {
    if (isFreePlan()) return TB_STANDARD;
    const c = tb.custom || {};
    return (sheet && c[sheet.size]) || c.default || TB_STANDARD;
  }
  if (!id || !TB_TEMPLATES[id]) return TB_STANDARD;
  if (TB_PRO_TEMPLATES.includes(id) && isFreePlan()) return TB_STANDARD;
  return TB_TEMPLATES[id];
}
export const titleBlockSize = (sheet) => { const t = activeTemplate(sheet); return { width: t.width, height: t.height }; };

// ---------- project / company information ----------
export const PROJECT_INFO_MAX = { legalOwner: 120, projectNumber: 40, customer: 80, site: 80, docPrefix: 20, docPattern: 60, wireIdPrefix: 4, docType: 40, docStatus: 30, language: 10, refStyle: 8 };
export const DEFAULT_DOC_PATTERN = '{project}-{sheet:3}';
export const DOC_TYPE_SUGGESTIONS = ['Circuit diagram', 'Wiring diagram', 'Panel layout', 'Bill of materials', 'Cable schedule', 'Terminal diagram', 'Contents list', 'Location drawing'];
export const DOC_STATUS_SUGGESTIONS = ['Draft', 'For review', 'For approval', 'Approved', 'Issued for construction', 'As built', 'Superseded'];
export const LANGUAGE_SUGGESTIONS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'sv'];

export const emptyProjectInfo = () => ({ legalOwner: '', projectNumber: '', customer: '', site: '', docPrefix: '', docPattern: '', wireIdPrefix: '', docType: '', docStatus: '', language: '', refStyle: 'grid' });
export function cleanProjectInfo(raw) {
  const out = emptyProjectInfo();
  if (raw && typeof raw === 'object') Object.keys(out).forEach(k => { out[k] = String(raw[k] ?? '').trim().slice(0, PROJECT_INFO_MAX[k]); });
  out.wireIdPrefix = String(out.wireIdPrefix || '').replace(/[^A-Za-z._\-]/g, '').slice(0, 4);   // never digits: they would run into the number
  if (out.refStyle !== 'lines') out.refStyle = 'grid';   // how cross-references are written: sheet / grid square, or line numbers
  return out;
}
// ---------- custom designs ----------
export const TB_LIMITS = { minW: 200, maxW: 700, minH: 60, maxH: 300, maxItems: 80, text: 120 };
export const TB_SIZES = ['A4', 'A3', 'A2'];
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : d; };
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanItem(r) {
  if (!r || typeof r !== 'object') return null;
  const X = (v) => num(v, 0, TB_LIMITS.maxW, 0), Y = (v) => num(v, 0, TB_LIMITS.maxH, 0);
  if (r.t === 'rect') {
    return { t: 'rect', x: X(r.x), y: Y(r.y), w: num(r.w, 1, TB_LIMITS.maxW, 40), h: num(r.h, 1, TB_LIMITS.maxH, 20), sw: num(r.sw, 0, 6, 1), fill: /^#[0-9a-f]{3,8}$/i.test(r.fill || '') ? r.fill : null };
  }
  if (r.t === 'line') {
    const p = Array.isArray(r.pts) ? r.pts : [];
    return { t: 'line', pts: [X(p[0]), Y(p[1]), X(p[2]), Y(p[3])], sw: num(r.sw, 0.5, 6, 1) };
  }
  if (r.t === 'text') {
    const o = { t: 'text', x: X(r.x), y: Y(r.y), text: str(r.text, TB_LIMITS.text), size: num(r.size, 4, 40, 10), bold: !!r.bold };
    if (/^\w+$/.test(r.when || '')) o.when = r.when;
    return o;
  }
  if (r.t === 'cell') {
    return { t: 'cell', x: X(r.x), y: Y(r.y), w: num(r.w, 8, TB_LIMITS.maxW, 80), h: num(r.h, 8, TB_LIMITS.maxH, 28), label: str(r.label, 40), text: str(r.text, TB_LIMITS.text), size: num(r.size, 4, 40, 10), bold: !!r.bold, wrap: !!r.wrap };
  }
  return null;
}

// A saved or imported design, made safe: known item kinds only, numbers kept in range.
export function cleanTemplate(raw, id = 'custom') {
  if (!raw || typeof raw !== 'object') return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, TB_LIMITS.maxItems).map(cleanItem).filter(Boolean);
  let logo = null;
  if (raw.logo && typeof raw.logo === 'object') {
    logo = { x: num(raw.logo.x, 0, TB_LIMITS.maxW, 0), y: num(raw.logo.y, 0, TB_LIMITS.maxH, 0), w: num(raw.logo.w, 10, TB_LIMITS.maxW, 60), h: num(raw.logo.h, 10, TB_LIMITS.maxH, 60), pad: num(raw.logo.pad, 0, 20, 4), center: !!raw.logo.center };
  }
  return { id, name: 'Custom', width: num(raw.width, TB_LIMITS.minW, TB_LIMITS.maxW, 460), height: num(raw.height, TB_LIMITS.minH, TB_LIMITS.maxH, 132), logo, items };
}

export const cloneTemplate = (t) => JSON.parse(JSON.stringify(t));

export function cleanTitleBlockSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = String(r.templateId || '');
  const out = { templateId: TB_TEMPLATES[id] ? id : 'standard' };
  const c = r.custom && typeof r.custom === 'object' ? r.custom : null;
  if (c) {
    const custom = {};
    const def = cleanTemplate(c.default);
    if (def) custom.default = def;
    TB_SIZES.forEach(sz => { const t = cleanTemplate(c[sz]); if (t) custom[sz] = t; });
    if (custom.default) out.custom = custom;
  }
  if (id === 'custom' && out.custom) out.templateId = 'custom';
  return out;
}

// ---------- computed values ----------
const pad = (n, w) => String(n).padStart(w, '0');

// A document number from a pattern: {prefix} {project} {sheet} {sheet:3} (zero-padded) {total}, and for a sheet
// that has them {function} (P1, without the "=") and {location} (CP, without the "+").
// Separators left dangling by an empty part (a missing project number, say) are trimmed.
export function buildDocNumber(pattern, info, sheetNum, total, sheet = null) {
  const p = (pattern || DEFAULT_DOC_PATTERN);
  const out = p.replace(/\{(prefix|project|sheet|total|function|location)(?::(\d{1,2}))?\}/g, (m, name, w) => {
    if (name === 'prefix') return info.docPrefix || '';
    if (name === 'project') return info.projectNumber || '';
    if (name === 'function') return sheetFunctionOf(sheet).replace(/^=/, '');
    if (name === 'location') { const l = sheet && sheet.iecLocation ? findLocationById(sheet.iecLocation) : null; return l && l.abbreviation && !isFreePlan() ? l.abbreviation : ''; }
    const n = name === 'sheet' ? sheetNum : total;
    return w ? pad(n, Number(w)) : String(n);
  });
  return out.replace(/^[\s\-_./]+|[\s\-_./]+$/g, '').replace(/([\-_./])\1+/g, '$1');
}

// Everything a template can ask for, for one sheet. sheetNum / totalSheets are the schematic
// numbering the border already works out; a panel sheet counts among the panel sheets instead.
export function titleBlockValues(sheet, sheetNum, totalSheets) {
  const info = state.projectInfo || emptyProjectInfo();
  const panel = getPageType(sheet) === 'panel';
  let num = sheetNum, total = totalSheets;
  if (panel) {
    const panels = state.sheets.filter(s => getPageType(s) === 'panel');
    num = panels.indexOf(sheet) + 1; total = panels.length;
  }
  const loc = findLocationById(sheet.iecLocation);
  return {
    title: sheet.title || '',
    description: sheet.description || '',
    author: sheet.author || '',
    approvedBy: sheet.approvedBy || '',
    createdDate: sheet.createdDate || '',
    site: sheet.location || info.site || '',
    customer: sheet.customer || info.customer || '',
    rev: currentRev(state.revisions, sheet),
    sheetLabel: panel ? 'PANEL' : 'SHEET',
    sheetNum: num, sheetTotal: total,
    locationTag: loc ? `+${loc.abbreviation}` : '',
    functionTag: sheetFunctionOf(sheet),
    sheetRef: sheetReferenceOf(sheet),
    legalOwner: info.legalOwner || '',
    projectNumber: info.projectNumber || '',
    docNumber: sheet.identificationNumber || buildDocNumber(info.docPattern, info, num, total, sheet),
    docType: sheet.docType || info.docType || '',
    docStatus: sheet.docStatus || info.docStatus || '',
    language: sheet.language || info.language || ''
  };
}
const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined || v[k] === null) ? '' : String(v[k]));

// ---------- drawing ----------
// Returns the Konva group for a template (positioned by the caller) and starts loading the
// logo, which pops in a moment later because an image loads asynchronously.
export function buildTitleBlock(tpl, values, logoSrc, onLogo) {
  const g = new Konva.Group({ x: 0, y: 0 });
  tpl.items.forEach(it => {
    if (it.t === 'rect') {
      const a = { x: it.x, y: it.y, width: it.w, height: it.h, listening: false };
      if (it.fill) a.fill = it.fill;
      if (it.sw) { a.stroke = '#000'; a.strokeWidth = it.sw; }
      g.add(new Konva.Rect(a));
    } else if (it.t === 'line') {
      g.add(new Konva.Line({ points: it.pts, stroke: '#000', strokeWidth: it.sw || 1, listening: false }));
    } else if (it.t === 'text') {
      if (it.when && !values[it.when]) return;
      const a = { x: it.x, y: it.y, text: fill(it.text, values), fontSize: it.size };
      if (it.bold) a.fontStyle = 'bold';
      g.add(new Konva.Text(a));
    } else if (it.t === 'cell') {
      g.add(new Konva.Rect({ x: it.x, y: it.y, width: it.w, height: it.h, stroke: '#000', strokeWidth: 1, listening: false }));
      const label = fill(it.label, values);
      if (label) g.add(new Konva.Text({ x: it.x + 3, y: it.y + 2, text: label, fontSize: 6.5, fill: '#475569', listening: false }));
      const text = fill(it.text, values);
      if (text) {
        const top = label ? 11 : 4;
        const a = { x: it.x + 4, y: it.y + top, width: it.w - 8, height: Math.max(8, it.h - top - 2), text, fontSize: it.size, ellipsis: true, listening: false };
        if (!it.wrap) a.wrap = 'none';
        if (it.bold) a.fontStyle = 'bold';
        g.add(new Konva.Text(a));
      }
    }
  });
  if (logoSrc && tpl.logo) {
    const img = new window.Image();
    img.onload = () => {
      const L = tpl.logo, maxW = L.w - L.pad * 2, maxH = L.h - L.pad * 2;
      const k = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * k, h = img.height * k;
      g.add(new Konva.Image({
        x: L.x + (L.center ? (L.w - w) / 2 : L.pad), y: L.y + (L.center ? (L.h - h) / 2 : L.pad),
        image: img, width: w, height: h
      }));
      if (onLogo) onLogo();
    };
    img.src = logoSrc;
  }
  return g;
}
