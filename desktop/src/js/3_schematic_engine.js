// ==========================================
// 3. MAIN SCHEMATIC RENDERERS & LOGIC
// ==========================================
import { state, SHEET_CONFIGS, snapToGrid, getActiveSheet, pushHistory, scheduleAutosave, nextLabelForType, getGridLocation, getRefText, flipSX, flipSY, getRefStyle, getLineCount, getLineColumns, lineReference, LINE_PITCH, normalizePathData, getDashArray, getPinsForType, GRID_SIZE, getPageType, getSchematicSheetNumber, getTotalSchematicSheets, getBOMPageNumber, getTotalBOMPages, appAlert, getPrefixAndValue, getPinLabelsForType, BUILTIN_SYMBOL_GEOMETRY, findLocationById, getDisplayDesignator, getEffectiveLocationId, symbolTextStyle, sheetGroupOf, sheetReferenceOf, wirePrefixOf, getPlcIoPageNumber, getTotalPlcIoPages } from './1_config_state.js';
import { stage, borderLayer, imageLayer, shapeLayer, wireLayer, contentLayer, wireLabelLayer, wirePreviewLayer, shapeHandleLayer, isMainCanvasSpaceHeld } from './2_main_stage.js';
import { connectorGlyph } from './30_connectors.js';
import { pinsOnSegment, bundleDirection, routeBundle } from './29_multi_wire.js';
import { wirePlcConnections, describePlcConnection, plcInstanceTexts } from './16_plc_modules.js';
import { childContactTexts, hasStandardContactPins } from './39_contact_sets.js';
import { driveInstanceTexts } from './35_drive_modules.js';
import { getTerminals, findTerminalAt, findTerminalLink, addTerminalLink, pruneTerminalLinks, getAllTerminalLinkRoutes } from './10_terminal_links.js';
import { removeCableMarker } from './7_cables.js';
import { drawCableDiagram } from './34_cable_diagram.js';
import { coreColourOf } from './18_cable_library.js';
import { currentRev, revTableRows, REV_ROW_H } from './23_revision_data.js';
import { activeTemplate, buildTitleBlock, titleBlockValues } from './25_title_block.js';
import { isPETerminal, terminalLabelParts, refreshTerminalWireIds, buildTerminalComponent, duplicateTerminalFields, isAssignedTerminal, isTerminalTableSymbol } from './11_terminal_blocks.js';

export function renderSheetBorder(sheet, sheetNum, totalSheets) {
  borderLayer.destroyChildren();

  const config = SHEET_CONFIGS[sheet.size] || SHEET_CONFIGS.A3;
  const isLandscape = sheet.orientation === 'landscape';
  const width = isLandscape ? config.width : config.height;
  const height = isLandscape ? config.height : config.width;

  const margin = 40;
  const innerWidth = width - (margin * 2);
  const innerHeight = height - (margin * 2);

  const paper = new Konva.Rect({
    x: 0, y: 0, width: width, height: height,
    fill: '#ffffff', shadowColor: 'black', shadowBlur: 10, shadowOpacity: 0.15,
    name: 'paper-bg'
  });
  borderLayer.add(paper);

  const pageType = getPageType(sheet);
  if (typeof window.syncPanelDock === 'function') window.syncPanelDock(sheet);   // the Panel Layout box shows on panel sheets only
  if (pageType === 'title') {
    renderTitlePageContent(sheet, width, height);
    borderLayer.draw();
    return;
  }
  if (pageType === 'contents') {
    renderContentsPageContent(sheet, width, height);
    borderLayer.draw();
    return;
  }
  if (pageType === 'locations') {
    renderLocationsPageContent(sheet, width, height);
    borderLayer.draw();
    return;
  }
  if (pageType === 'bom') {
    renderBOMPageContent(sheet, width, height);
    borderLayer.draw();
    return;
  }
  if (pageType === 'plcio') {
    renderPlcIoPageContent(sheet, width, height);
    borderLayer.draw();
    return;
  }
  if (pageType === 'cables') {
    borderLayer.add(drawCableDiagram(sheet, width, height));
    borderLayer.draw();
    return;
  }

  const innerFrame = new Konva.Rect({
    x: margin, y: margin, width: innerWidth, height: innerHeight,
    stroke: '#000000', strokeWidth: 2, listening: false
  });
  borderLayer.add(innerFrame);

  // Faint placement grid, spaced exactly like the snap-to-grid used when
  // placing/moving components and drawing wires — what you see is where
  // things will actually land.
  const showGrid = pageType !== 'panel';   // a panel sheet is in millimetres, not grid squares
  for (let x = margin; showGrid && x <= width - margin; x += GRID_SIZE) {
    borderLayer.add(new Konva.Line({
      points: [x, margin, x, height - margin],
      stroke: '#e2e8f0', strokeWidth: 0.5, listening: false, name: 'placementGrid'
    }));
  }
  for (let y = margin; showGrid && y <= height - margin; y += GRID_SIZE) {
    borderLayer.add(new Konva.Line({
      points: [margin, y, width - margin, y],
      stroke: '#e2e8f0', strokeWidth: 0.5, listening: false, name: 'placementGrid'
    }));
  }

  // Zone markers: the IEC column numbers and row letters, or - when the project refers to things by line number
  // (Project & title block > Cross-reference style) - a number for every line down both margins.
  const lineStyle = getRefStyle() === 'lines' && (pageType || 'schematic') === 'schematic' && sheetNum !== null && sheetNum !== undefined;
  const cols = lineStyle ? 0 : 8; const rows = lineStyle ? 0 : 6;
  const colWidth = innerWidth / 8; const rowHeight = innerHeight / 6;
  if (lineStyle) {
    const lineCount = getLineCount(sheet);
    const twoCols = getLineColumns(sheet) === 2;
    for (let n = 0; n < lineCount; n++) {
      const y = margin + n * LINE_PITCH;
      // Two columns: the left margin carries 1..n and the right-hand numbers n+1..2n sit small beside the middle divider;
      // otherwise both margins repeat the same number.
      const labels = [String(lineReference(sheetNum, n + 1)), String(lineReference(sheetNum, n + 1))];
      [[margin - 8, margin, margin - 38], [width - margin, width - margin + 8, width - margin + 4]].forEach(([x1, x2, tx], k) => {
        borderLayer.add(new Konva.Line({ points: [x1, y, x2, y], stroke: '#000', strokeWidth: 1, listening: false }));
        if (!twoCols || k === 0) borderLayer.add(new Konva.Text({ x: tx, y: y + LINE_PITCH / 2 - 5, width: 34, align: 'center', text: labels[k], fontSize: 9, fontStyle: 'bold', listening: false }));
      });
      if (twoCols) borderLayer.add(new Konva.Text({ x: width / 2 + 6, y: y + LINE_PITCH / 2 - 4, text: String(lineReference(sheetNum, lineCount + n + 1)), fontSize: 7, fontStyle: 'bold', fill: '#475569', listening: false }));
    }
    if (twoCols) {
      // The dividing line between the two columns, ticked at every line.
      const mid = width / 2, bottom = margin + lineCount * LINE_PITCH;
      borderLayer.add(new Konva.Line({ points: [mid, margin, mid, bottom], stroke: '#64748b', strokeWidth: 1, dash: [6, 4], listening: false }));
      for (let n = 0; n <= lineCount; n++) {
        const y = margin + n * LINE_PITCH;
        borderLayer.add(new Konva.Line({ points: [mid - 4, y, mid + 4, y], stroke: '#64748b', strokeWidth: 1, listening: false }));
      }
    }
    borderLayer.add(new Konva.Line({ points: [margin - 8, margin + lineCount * LINE_PITCH, margin, margin + lineCount * LINE_PITCH], stroke: '#000', strokeWidth: 1, listening: false }));
  }

  for (let i = 0; i < cols; i++) {
    const x = margin + (i * colWidth);
    borderLayer.add(new Konva.Line({ points: [x, margin, x, margin - 8], stroke: '#000', strokeWidth: 1, listening: false }));
    borderLayer.add(new Konva.Text({ x: x + (colWidth / 2) - 4, y: margin - 20, text: String(i + 1), fontSize: 12, fontStyle: 'bold' }));
  }

  for (let j = 0; j < rows; j++) {
    const y = margin + (j * rowHeight);
    const letter = String.fromCharCode(65 + j);
    borderLayer.add(new Konva.Line({ points: [margin, y, margin - 8, y], stroke: '#000', strokeWidth: 1, listening: false }));
    borderLayer.add(new Konva.Text({ x: margin - 20, y: y + (rowHeight / 2) - 6, text: letter, fontSize: 12, fontStyle: 'bold' }));
  }

  // Title Block - drawn from the project's template (see 25_title_block.js)
  const tpl = activeTemplate(sheet);
  const tbWidth = tpl.width, tbHeight = tpl.height;
  const tbX = width - margin - tbWidth; const tbY = height - margin - tbHeight;
  const titleBlock = buildTitleBlock(tpl, titleBlockValues(sheet, sheetNum, totalSheets), state.companyLogo, () => borderLayer.batchDraw());
  titleBlock.position({ x: tbX, y: tbY });
  borderLayer.add(titleBlock);

  // The revision log, as a table sitting on the title block: heading, then the latest revisions covering
  // this sheet, newest at the bottom.
  const revRows = revTableRows(state.revisions, sheet);
  if (revRows.length) {
    const cols = [{ w: 50, label: 'REV' }, { w: 76, label: 'DATE' }, { w: tbWidth - 206, label: 'DESCRIPTION' }, { w: 80, label: 'BY' }];
    const total = (revRows.length + 1) * REV_ROW_H, ty = tbY - total;
    const table = new Konva.Group({ x: tbX, y: ty, listening: false });
    table.add(new Konva.Rect({ x: 0, y: 0, width: tbWidth, height: total, fill: '#fff', stroke: '#000', strokeWidth: 1.5, listening: false }));
    let cx = 0;
    cols.forEach((c, i) => {
      if (i) table.add(new Konva.Line({ points: [cx, 0, cx, total], stroke: '#000', strokeWidth: 0.75, listening: false }));
      table.add(new Konva.Text({ x: cx + 4, y: 3, text: c.label, fontSize: 8, fontStyle: 'bold', fill: '#475569', listening: false }));
      cx += c.w;
    });
    revRows.forEach((r, i) => {
      const y = (i + 1) * REV_ROW_H;
      table.add(new Konva.Line({ points: [0, y, tbWidth, y], stroke: '#000', strokeWidth: 0.5, listening: false }));
      const clip = (t, w) => { const max = Math.floor((w - 8) / 4.6); return t.length > max ? t.slice(0, Math.max(0, max - 1)) + '\u2026' : t; };
      let x = 0;
      [r.rev, r.date, r.description, r.by].forEach((t, k) => {
        table.add(new Konva.Text({ x: x + 4, y: y + 3, text: clip(String(t || ''), cols[k].w), fontSize: 8, fontStyle: k === 0 ? 'bold' : 'normal', fill: '#0f172a', listening: false }));
        x += cols[k].w;
      });
    });
    borderLayer.add(table);
  }
  borderLayer.draw();
}

// A large centered title, company logo, and project metadata — no grid,
// zone markers, or standard title block, and no sheet number (it isn't one).
function renderTitlePageContent(sheet, width, height) {
  const group = new Konva.Group();

  group.add(new Konva.Rect({
    x: 40, y: 40, width: width - 80, height: height - 80,
    stroke: '#000000', strokeWidth: 2
  }));

  if (state.companyLogo) {
    const imageObj = new window.Image();
    imageObj.onload = () => {
      const maxW = width * 0.32, maxH = height * 0.16;
      const fitScale = Math.min(maxW / imageObj.width, maxH / imageObj.height);
      const logoW = imageObj.width * fitScale, logoH = imageObj.height * fitScale;
      group.add(new Konva.Image({
        x: (width - logoW) / 2, y: height * 0.16,
        image: imageObj, width: logoW, height: logoH
      }));
      borderLayer.batchDraw();
    };
    imageObj.src = state.companyLogo;
  }

  group.add(new Konva.Text({
    x: 0, y: height * 0.42, width: width, align: 'center',
    text: sheet.title || 'Untitled Project', fontSize: 32, fontStyle: 'bold', fill: '#0f172a'
  }));

  let metaY = height * 0.42 + 50;
  if (sheet.customer) {
    group.add(new Konva.Text({ x: 0, y: metaY, width: width, align: 'center', text: `Customer: ${sheet.customer}`, fontSize: 15, fill: '#334155' }));
    metaY += 24;
  }
  if (sheet.description) {
    group.add(new Konva.Text({ x: 0, y: metaY, width: width, align: 'center', text: sheet.description, fontSize: 13, fill: '#64748b' }));
  }

  const latestRev = state.revisions && state.revisions.length ? state.revisions[state.revisions.length - 1].rev : sheet.rev;
  const footerParts = [latestRev ? `Rev ${latestRev}` : null, sheet.createdDate || null, sheet.author || null].filter(Boolean);
  if (footerParts.length) {
    group.add(new Konva.Text({
      x: 0, y: height - 70, width: width, align: 'center',
      text: footerParts.join('   •   '), fontSize: 11, fill: '#94a3b8'
    }));
  }

  borderLayer.add(group);
}

// A dynamically-generated list of every schematic sheet — read live from
// state.sheets on every render, so it's always current: add, remove, rename
// or reorder a sheet and the next time this page renders, it reflects that.
function renderContentsPageContent(sheet, width, height) {
  const group = new Konva.Group();
  const margin = 60;

  group.add(new Konva.Rect({
    x: 40, y: 40, width: width - 80, height: height - 80,
    stroke: '#000000', strokeWidth: 2
  }));

  group.add(new Konva.Text({ x: margin, y: margin + 10, text: sheet.title || 'Contents', fontSize: 22, fontStyle: 'bold', fill: '#0f172a' }));
  group.add(new Konva.Line({ points: [margin, margin + 44, width - margin, margin + 44], stroke: '#cbd5e1', strokeWidth: 1 }));

  let rowY = margin + 66;
  let shownGroup = '';
  state.sheets.forEach((s, idx) => {
    const type = getPageType(s);
    if (type === 'title' || type === 'contents') return;   // this page and the cover are not listed
    const sheetGroup = sheetGroupOf(s);
    if (sheetGroup !== shownGroup) {
      shownGroup = sheetGroup;
      if (sheetGroup) {
        group.add(new Konva.Text({ x: margin, y: rowY, text: sheetGroup.replace(/\//g, ' \u203A ').toUpperCase(), fontSize: 11, fontStyle: 'bold', fill: '#64748b' }));
        rowY += 18;
      }
    }
    const nth = (t) => state.sheets.filter(x => getPageType(x) === t).indexOf(s) + 1;
    const num = type === 'panel' ? `P${nth('panel')}`
      : type === 'locations' ? `L${nth('locations')}`
      : type === 'cables' ? `C${nth('cables')}`
      : type === 'bom' ? `B${nth('bom')}`
      : type === 'plcio' ? `I${nth('plcio')}`
      : getSchematicSheetNumber(idx);

    group.add(new Konva.Text({ x: margin, y: rowY, width: 40, text: `${num}`, fontSize: 13, fontStyle: 'bold', fill: '#2563eb' }));
    group.add(new Konva.Text({ x: margin + 46, y: rowY, text: s.title || (type === 'bom' ? 'Bill of Materials' : type === 'plcio' ? 'PLC I/O Schedule' : type === 'locations' ? 'Locations' : type === 'cables' ? 'Cable diagram' : type === 'panel' ? 'Panel Layout' : 'Untitled'), fontSize: 13, fill: '#0f172a' }));
    const sheetRef = sheetReferenceOf(s);
    if (sheetRef) group.add(new Konva.Text({ x: width - margin - 230, y: rowY + 2, width: 130, align: 'right', text: sheetRef, fontSize: 11, fontStyle: 'bold', fill: '#475569' }));
    if (state.revisions && state.revisions.length && (type === 'schematic' || type === 'panel')) group.add(new Konva.Text({ x: width - margin - 90, y: rowY + 2, width: 90, align: 'right', text: `Rev ${currentRev(state.revisions, s)}`, fontSize: 11, fontStyle: 'italic', fill: '#64748b' }));

    if (s.description) {
      rowY += 16;
      group.add(new Konva.Text({ x: margin + 46, y: rowY, text: s.description, fontSize: 10, fontStyle: 'italic', fill: '#94a3b8' }));
    }
    rowY += 26;
  });

  borderLayer.add(group);
}

// A locations page lists every defined IEC-style location and which
// schematic sheets actually use it (as the sheet's own default, or on at
// least one component that departs to it) — computed fresh every render,
// same reasoning as the Contents and BOM pages: assign, rename, or reassign
// a location anywhere in the portfolio and this page already reflects it
// the next time it's drawn, nothing to regenerate by hand.
function renderLocationsPageContent(sheet, width, height) {
  const group = new Konva.Group();
  const margin = 60;

  group.add(new Konva.Rect({
    x: 40, y: 40, width: width - 80, height: height - 80,
    stroke: '#000000', strokeWidth: 2
  }));

  group.add(new Konva.Text({ x: margin, y: margin + 10, text: sheet.title || 'Locations', fontSize: 22, fontStyle: 'bold', fill: '#0f172a' }));
  group.add(new Konva.Line({ points: [margin, margin + 44, width - margin, margin + 44], stroke: '#cbd5e1', strokeWidth: 1 }));

  if (state.locations.length === 0) {
    group.add(new Konva.Text({ x: margin, y: margin + 66, text: 'No locations have been defined yet — set one from a sheet\'s Sheet Properties, or a component\'s own Location field.', fontSize: 12, fontStyle: 'italic', fill: '#94a3b8', width: width - margin * 2 }));
    borderLayer.add(group);
    return;
  }

  const colLocation = margin, colDesc = margin + 90, colUsedOn = margin + 300;
  let rowY = margin + 66;

  [['Location', colLocation], ['Description', colDesc], ['Used On (sheets)', colUsedOn]].forEach(([label, x]) => {
    group.add(new Konva.Text({ x, y: rowY, text: label, fontSize: 10, fontStyle: 'bold', fill: '#64748b' }));
  });
  rowY += 18;
  group.add(new Konva.Line({ points: [margin, rowY, width - margin, rowY], stroke: '#cbd5e1', strokeWidth: 1 }));
  rowY += 10;

  state.locations.forEach(loc => {
    const usedOnSheets = new Set();
    state.sheets.forEach((s, idx) => {
      if (getPageType(s) !== 'schematic') return;
      // String-compared, not ===, for the same reason as findLocationById:
      // a location id set via an HTML <select> comes back as a string even
      // though loc.id itself is a number (Date.now()).
      const sheetUses = String(s.iecLocation) === String(loc.id) || (s.components || []).some(c => String(getEffectiveLocationId(c, s)) === String(loc.id));
      if (sheetUses) usedOnSheets.add(getSchematicSheetNumber(idx));
    });
    const usedOnText = [...usedOnSheets].sort((a, b) => a - b).join(', ') || '—';

    group.add(new Konva.Text({ x: colLocation, y: rowY, width: 80, text: `+${loc.abbreviation}`, fontSize: 12, fontStyle: 'bold', fill: '#2563eb' }));
    group.add(new Konva.Text({ x: colDesc, y: rowY, width: 200, text: loc.description || '', fontSize: 11, fill: '#0f172a' }));
    group.add(new Konva.Text({ x: colUsedOn, y: rowY, width: width - colUsedOn - margin, text: usedOnText, fontSize: 11, fill: '#475569' }));
    rowY += 22;
  });

  borderLayer.add(group);
}

// A BOM page shows the portfolio's own Bill of Materials as a table, drawn
// straight onto the sheet the same way the contents page draws its list —
// via window.buildBOM() (kept out of a direct import to avoid a circular
// dependency, since 6_bom.js already imports FROM this file), called fresh
// on every render rather than a snapshot stored on the sheet, so the table
// always reflects whatever's currently on every OTHER sheet: add, edit, or
// remove a component anywhere in the portfolio and this page is already
// showing the update the next time it's drawn — nothing to regenerate.
const BOM_PAGE_COLUMNS = [
  { key: 'qty', label: 'Qty', width: 40 },
  { key: 'designators', label: 'Designators', width: 130 },
  { key: 'typeLabel', label: 'Type', width: 110 },
  { key: 'value', label: 'Value', width: 90 },
  { key: 'make', label: 'Make', width: 90 },
  { key: 'modelNo', label: 'Model No.', width: 110 },
  { key: 'description', label: 'Description', width: 220 },
  { key: 'sheets', label: 'Sheet(s)', width: 70 },
  { key: 'panel', label: 'Panel', width: 64 }
];

const BOM_ROW_PADDING = 6;

// A row's actual rendered height, accounting for word-wrap — measured with
// throwaway Konva.Text nodes (never added to any layer), the exact same way
// renderBOMPageContent measures a row it's actually about to draw, so what's
// predicted here during pagination always matches what ends up on screen.
function measureBOMRowHeight(row) {
  const cellNodes = BOM_PAGE_COLUMNS.map(col =>
    new Konva.Text({ width: col.width - 6, text: String(row[col.key] ?? ''), fontSize: 10, wrap: 'word' })
  );
  return Math.max(14, ...cellNodes.map(n => n.height())) + BOM_ROW_PADDING;
}

// Splits the full BOM into as many pages as it takes for every row to fit,
// each page's total row height kept within availableHeight. A single row
// taller than one whole page still gets its own page rather than being
// dropped — pagination should never lose data outright, even in that
// unlikely case.
export function paginateBOMRows(rows, availableHeight) {
  const pages = [[]];
  let usedHeight = 0;
  rows.forEach(row => {
    const rowHeight = measureBOMRowHeight(row);
    if (usedHeight + rowHeight > availableHeight && pages[pages.length - 1].length > 0) {
      pages.push([]);
      usedHeight = 0;
    }
    pages[pages.length - 1].push(row);
    usedHeight += rowHeight;
  });
  return pages;
}

// ---- PLC I/O schedule page ----
// Like the BOM page: drawn fresh from the project every time, one page or several, one after another. The rows come from
// window.buildPlcSchedule (41_plc_io_schedule.js), grouped under a heading for each module.
const PLCIO_COLUMNS = [
  { key: 'address', label: 'Address', width: 70 },
  { key: 'type', label: 'Type', width: 100 },
  { key: 'fn', label: 'Function', width: 170 },
  { key: 'wireId', label: 'Wire ID', width: 70 },
  { key: 'to', label: 'Connected to', width: 190 },
  { key: 'sheet', label: 'Sheet', width: 50 },
  { key: 'ref', label: 'Ref.', width: 70 }
];
const PLCIO_FONT = 10, PLCIO_HEAD_FONT = 11;

function plcIoRowHeight(row) {
  if (row.heading) return 22;
  const nodes = PLCIO_COLUMNS.map(col => new Konva.Text({ width: col.width - 6, text: String(row[col.key] ?? ''), fontSize: PLCIO_FONT, wrap: 'word' }));
  return Math.max(14, ...nodes.map(n => n.height())) + BOM_ROW_PADDING;
}

// Channel rows with a heading before each module's; a page that starts part-way through a module repeats its heading.
function plcIoPages(rows, availableHeight) {
  const flat = [];
  let last = null;
  rows.forEach(r => {
    if (r.module !== last) { flat.push({ heading: true, text: `${r.module}${r.model ? ' \u2013 ' + r.model : ''}`, module: r.module, model: r.model }); last = r.module; }
    flat.push(r);
  });
  const pages = [[]];
  let used = 0;
  flat.forEach(row => {
    let h = plcIoRowHeight(row);
    let page = pages[pages.length - 1];
    if (used + h > availableHeight && page.length > 0) { pages.push([]); used = 0; page = pages[pages.length - 1]; }
    if (!row.heading && page.length === 0) {   // a new page opening on a channel: say whose it is
      const head = { heading: true, text: `${row.module}${row.model ? ' \u2013 ' + row.model : ''} (continued)` };
      page.push(head); used += plcIoRowHeight(head);
    }
    page.push(row); used += h;
  });
  return pages;
}

function renderPlcIoPageContent(sheet, width, height) {
  const group = new Konva.Group();
  const margin = 40, tableLeft = margin;
  group.add(new Konva.Rect({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2, stroke: '#000000', strokeWidth: 2 }));

  const myIndex = state.sheets.indexOf(sheet);
  const pageNum = getPlcIoPageNumber(myIndex) || 1;
  const totalPages = getTotalPlcIoPages();
  const baseTitle = sheet.title || 'PLC I/O Schedule';
  group.add(new Konva.Text({ x: margin + 20, y: margin + 16, text: pageNum > 1 ? `${baseTitle} (continued)` : baseTitle, fontSize: 20, fontStyle: 'bold', fill: '#0f172a' }));

  const rows = (typeof window.buildPlcSchedule === 'function') ? window.buildPlcSchedule().rows : [];
  let colX = tableLeft + 20;
  const headerY = margin + 56;
  const colStarts = [];
  PLCIO_COLUMNS.forEach(col => {
    colStarts.push(colX);
    group.add(new Konva.Text({ x: colX, y: headerY, width: col.width, text: col.label, fontSize: 11, fontStyle: 'bold', fill: '#334155' }));
    colX += col.width;
  });
  group.add(new Konva.Line({ points: [tableLeft + 20, headerY + 18, colX, headerY + 18], stroke: '#0f172a', strokeWidth: 1 }));

  const tableTop = headerY + 30;
  const bottomLimit = height - margin - 20;
  const pages = plcIoPages(rows, bottomLimit - tableTop);
  const mine = pages[pageNum - 1] || [];

  if (!rows.length) {
    group.add(new Konva.Text({ x: tableLeft + 20, y: headerY + 34, text: 'No PLC modules on any sheet yet.', fontSize: 11, fontStyle: 'italic', fill: '#94a3b8' }));
  } else if (!mine.length) {
    group.add(new Konva.Text({ x: tableLeft + 20, y: headerY + 34, text: 'Nothing to show here \u2014 the full schedule already fits on the earlier page(s).', fontSize: 11, fontStyle: 'italic', fill: '#94a3b8' }));
  } else {
    let rowY = tableTop;
    mine.forEach(row => {
      if (row.heading) {
        group.add(new Konva.Rect({ x: tableLeft + 20, y: rowY - 2, width: colX - tableLeft - 20, height: 18, fill: '#f1f5f9' }));
        group.add(new Konva.Text({ x: tableLeft + 24, y: rowY + 1, text: row.text, fontSize: PLCIO_HEAD_FONT, fontStyle: 'bold', fill: '#0f172a' }));
        rowY += plcIoRowHeight(row);
        return;
      }
      const nodes = PLCIO_COLUMNS.map((col, i) => new Konva.Text({ x: colStarts[i], y: rowY, width: col.width - 6, text: String(row[col.key] ?? ''), fontSize: PLCIO_FONT, fill: '#0f172a', wrap: 'word' }));
      nodes.forEach(n => group.add(n));
      rowY += Math.max(14, ...nodes.map(n => n.height())) + BOM_ROW_PADDING;
    });
  }

  if (pageNum === totalPages && pages.length > totalPages) {
    const shown = pages.slice(0, totalPages).reduce((sum, p) => sum + p.filter(r => !r.heading).length, 0);
    const remaining = rows.length - shown;
    group.add(new Konva.Text({ x: tableLeft + 20, y: bottomLimit + 4, width: width - margin * 2 - 40, text: `${remaining} more channel${remaining === 1 ? '' : 's'} don't fit \u2014 add another PLC I/O page to show ${remaining === 1 ? 'it' : 'them'}.`, fontSize: 10, fontStyle: 'italic', fill: '#dc2626' }));
  }
  borderLayer.add(group);
}

function renderBOMPageContent(sheet, width, height) {
  const group = new Konva.Group();
  const margin = 40;
  const tableLeft = margin;

  group.add(new Konva.Rect({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2, stroke: '#000000', strokeWidth: 2 }));

  // Several BOM pages, one after another, when the parts list doesn't fit on
  // one — this sheet's own position among them decides which chunk of rows
  // it shows, recomputed fresh every render just like the BOM itself, so
  // adding/removing components shifts what lands on which page automatically.
  const bomIndex = state.sheets.indexOf(sheet);
  const bomPageNum = getBOMPageNumber(bomIndex) || 1;
  const totalBOMPagesInPortfolio = getTotalBOMPages();
  const baseTitle = sheet.title || 'Bill of Materials';
  const titleText = bomPageNum > 1 ? `${baseTitle} (continued)` : baseTitle;
  group.add(new Konva.Text({ x: margin + 20, y: margin + 16, text: titleText, fontSize: 20, fontStyle: 'bold', fill: '#0f172a' }));

  const allRows = (typeof window.buildBOM === 'function') ? window.buildBOM() : [];

  let colX = tableLeft + 20;
  const headerY = margin + 56;
  const colStarts = [];
  BOM_PAGE_COLUMNS.forEach(col => {
    colStarts.push(colX);
    group.add(new Konva.Text({ x: colX, y: headerY, width: col.width, text: col.label, fontSize: 11, fontStyle: 'bold', fill: '#334155' }));
    colX += col.width;
  });
  group.add(new Konva.Line({ points: [tableLeft + 20, headerY + 18, colX, headerY + 18], stroke: '#0f172a', strokeWidth: 1 }));

  const tableTop = headerY + 30;
  const bottomLimit = height - margin - 20; // clear space above the frame's own bottom edge, for the overflow notice below
  const pages = paginateBOMRows(allRows, bottomLimit - tableTop);
  const rowsForThisPage = pages[bomPageNum - 1] || [];

  if (allRows.length === 0) {
    group.add(new Konva.Text({ x: tableLeft + 20, y: headerY + 34, text: 'No components on any sheet yet.', fontSize: 11, fontStyle: 'italic', fill: '#94a3b8' }));
  } else if (rowsForThisPage.length === 0) {
    group.add(new Konva.Text({ x: tableLeft + 20, y: headerY + 34, text: 'Nothing to show here — the full parts list already fits on the earlier BOM page(s).', fontSize: 11, fontStyle: 'italic', fill: '#94a3b8' }));
  } else {
    let rowY = tableTop;
    rowsForThisPage.forEach(row => {
      const cellNodes = BOM_PAGE_COLUMNS.map((col, i) =>
        new Konva.Text({ x: colStarts[i], y: rowY, width: col.width - 6, text: String(row[col.key] ?? ''), fontSize: 10, fill: '#0f172a', wrap: 'word' })
      );
      const tallest = Math.max(14, ...cellNodes.map(n => n.height()));
      // Double-click a row to go to that part on its sheet (a row with several parts takes you to the next each time).
      if (row.targets && row.targets.length) {
        const hit = new Konva.Rect({ x: tableLeft + 16, y: rowY - 2, width: colX - tableLeft - 16, height: tallest + BOM_ROW_PADDING, fill: 'rgba(37,99,235,0.001)' });
        hit.on('mouseenter', () => { hit.fill('rgba(37,99,235,0.10)'); document.body.style.cursor = 'pointer'; if (hit.getLayer()) hit.getLayer().batchDraw(); });
        hit.on('mouseleave', () => { hit.fill('rgba(37,99,235,0.001)'); document.body.style.cursor = ''; if (hit.getLayer()) hit.getLayer().batchDraw(); });
        hit.on('dblclick dbltap', (e) => { e.cancelBubble = true; document.body.style.cursor = ''; if (typeof window.goToBomRow === 'function') window.goToBomRow(row); });
        group.add(hit);
      }
      cellNodes.forEach(n => { n.listening(false); group.add(n); });
      rowY += tallest + BOM_ROW_PADDING;
    });
  }

  // On the last BOM page actually in the portfolio: if the parts list needed
  // more pages than exist, say so plainly rather than silently dropping rows.
  if (bomPageNum === totalBOMPagesInPortfolio && pages.length > totalBOMPagesInPortfolio) {
    const shownSoFar = pages.slice(0, totalBOMPagesInPortfolio).reduce((sum, p) => sum + p.length, 0);
    const remaining = allRows.length - shownSoFar;
    group.add(new Konva.Text({
      x: tableLeft + 20, y: bottomLimit + 4, width: width - margin * 2 - 40,
      text: `${remaining} more component${remaining === 1 ? '' : 's'} don't fit — add another BOM page to show ${remaining === 1 ? 'it' : 'them'}.`,
      fontSize: 10, fontStyle: 'italic', fill: '#dc2626'
    }));
  }

  borderLayer.add(group);
}

// ==========================================
// WIRE AUDIT (temporary diagnostic)
// ==========================================
// A rolling log of everything that can create or reshape a wire, plus a check
// that runs after every wire render: the moment any wire stops being purely
// horizontal/vertical, the browser console prints exactly which operations led
// up to it — so a stray-wire bug is on record instead of having to be guessed
// at afterwards. Set WIRE_AUDIT_ENABLED to false to switch it all off.
// From the console, window.dumpWireLog() prints the log at any time.
const WIRE_AUDIT_ENABLED = true;
const WIRE_AUDIT_LOG_SIZE = 40;
const wireOpLog = [];
let wireOpSeq = 0;
let lastWireOpKey = null;
const knownDiagonalWires = new Set(); // wires already reported (or already there at load) — reported once, not on every re-render

export function logWireOp(op, detail = {}, coalesceKey = null) {
  if (!WIRE_AUDIT_ENABLED) return;
  const entry = { n: ++wireOpSeq, op, detail: JSON.stringify(detail) };
  if (coalesceKey && coalesceKey === lastWireOpKey && wireOpLog.length) {
    wireOpLog[wireOpLog.length - 1] = entry; // the many small steps of one drag collapse into a single line
  } else {
    wireOpLog.push(entry);
    if (wireOpLog.length > WIRE_AUDIT_LOG_SIZE) wireOpLog.shift();
  }
  lastWireOpKey = coalesceKey;
}

function isOrthogonalPath(pts) {
  // Tolerance, not exact equality: a rotated component's pin positions carry
  // floating-point noise around 1e-14 (e.g. 239.99999999999997 for 240), which
  // is invisible but would otherwise be reported as a diagonal.
  const EPS = 1e-6;
  for (let i = 0; i < pts.length - 2; i += 2) {
    if (Math.abs(pts[i] - pts[i + 2]) > EPS && Math.abs(pts[i + 1] - pts[i + 3]) > EPS) return false;
  }
  return true;
}

// What, if anything, is wrong with a wire's geometry. A missing/invalid
// coordinate matters as much as a diagonal: the canvas draws a missing value
// as 0, so a wire with one runs off to the sheet's top-left corner.
function wireProblem(pts) {
  if (!Array.isArray(pts) || pts.length % 2 !== 0) return 'malformed points array';
  for (const v of pts) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'invalid coordinate (' + String(v) + ')';
  }
  if (!isOrthogonalPath(pts)) return 'non-orthogonal (diagonal) segment';
  return null;
}

// Called when a sheet is loaded: anything already non-orthogonal at that point
// isn't news, so it's noted once here and not reported as a fresh problem.
export function baselineWireAudit(sheet) {
  if (!WIRE_AUDIT_ENABLED || !sheet?.wires) return;
  let existing = 0;
  sheet.wires.forEach(w => {
    if (wireProblem(w.points)) { knownDiagonalWires.add(JSON.stringify(w.points)); existing++; }
  });
  if (existing > 0) console.info(`[wire-audit] this sheet already contained ${existing} bad wire(s) (diagonal or invalid) when it was loaded — not reported again.`);
}

function auditWires(sheet) {
  if (!WIRE_AUDIT_ENABLED) return;
  (sheet.wires || []).forEach(w => {
    const problem = wireProblem(w.points);
    if (!problem) return;
    const key = JSON.stringify(w.points);
    if (knownDiagonalWires.has(key)) return;
    knownDiagonalWires.add(key);
    console.warn('[wire-audit] A BAD WIRE JUST APPEARED — ' + problem + ':', { wireId: w.wireId, points: Array.isArray(w.points) ? [...w.points] : w.points });
    console.warn('[wire-audit] The most recent wire operations, oldest first — please copy this table:');
    console.table(wireOpLog.slice());
  });
}

if (typeof window !== 'undefined') window.dumpWireLog = () => console.table(wireOpLog.slice());

export function clearWireState(resetTool = true) {
  if (state.activeWirePoints.length > 0) logWireOp('wire-in-progress-cleared', { discarded: [...state.activeWirePoints], resetTool });
  state.activeWirePoints = [];
  if (state.tempWireLine) {
    state.tempWireLine.destroy();
    state.tempWireLine = null;
  }
  if (state.pinHighlightCircle) {
    state.pinHighlightCircle.destroy();
    state.pinHighlightCircle = null;
  }
  
  // Reset tool back to 'select' mode — unless the caller is about to keep
  // drawing (finishing one wire and starting the next), in which case the
  // wire tool should stay active until the person explicitly switches away.
  if (resetTool) {
    state.currentTool = 'select';
  }
  
  wirePreviewLayer.batchDraw();
}

export function getOrthogonalPoint(lastX, lastY, cursorX, cursorY) {
  const dx = Math.abs(cursorX - lastX);
  const dy = Math.abs(cursorY - lastY);
  return dx > dy ? { x: cursorX, y: lastY } : { x: lastX, y: cursorY };
}

// Moves one endpoint of a wire to (newX, newY) while keeping every segment
// horizontal or vertical — used when a connected component is dragged. Only the
// ONE elbow adjacent to the moved endpoint is touched; the rest of the wire's
// path (and anything else connected further along it) is left exactly as drawn.
// A brand-new elbow is inserted if the wire was a single straight segment;
// otherwise the existing adjacent elbow is slid along whichever axis the next
// segment doesn't depend on, so that segment's own orientation is preserved.
// ==========================================
// WIRES ATTACHED TO A MOVING COMPONENT
// ==========================================
// When a component is dragged, the wire ends attached to its pins follow it.
// A wire should leave a pin heading AWAY from the component, and run straight
// for a short distance before it turns — otherwise the right angle sits right
// on the pin and the wire hugs the symbol. That rule can't be applied by nudging
// the wire a little on every mouse step (each step would pile on more bends), so
// instead each attached wire's route is worked out fresh from its ORIGINAL shape
// (remembered when the drag starts) and the pin's final position: a pure
// function of those two, so it gives the same result however the drag got there.
const ATTACH_LEAD = 20; // straight run out of a pin before a wire may turn

function reversePoints(pts) {
  const out = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

// Which way is "away from the component" at each pin — a unit vector in the
// symbol's own coordinates, or null where there's no clear answer (a terminal,
// a pin in a corner...), in which case the wire just keeps its old behaviour.
export function getPinOutwardDirections(pathData, pins) {
  const EPS = 1e-6;
  const segments = []; // straight lines the symbol draws: [x1, y1, x2, y2]
  normalizePathData(pathData).forEach(seg => {
    let cur = null;
    (String(seg.d || '').match(/[MLA][^MLA]*/g) || []).forEach(token => {
      const cmd = token[0];
      const nums = (token.slice(1).match(/-?\d+\.?\d*/g) || []).map(Number);
      if (cmd === 'M') { if (nums.length >= 2) cur = { x: nums[0], y: nums[1] }; }
      else if (cmd === 'L') {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const next = { x: nums[i], y: nums[i + 1] };
          if (cur) segments.push([cur.x, cur.y, next.x, next.y]);
          cur = next;
        }
      } else if (cmd === 'A' && nums.length >= 7) cur = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
    });
  });

  const coords = extractPathCoordinates(pathData).map(c => [c.x, c.y]).concat((pins || []).map(p => [p.relX, p.relY]));
  if (coords.length === 0) return (pins || []).map(() => null);
  const minX = Math.min(...coords.map(c => c[0])), maxX = Math.max(...coords.map(c => c[0]));
  const minY = Math.min(...coords.map(c => c[1])), maxY = Math.max(...coords.map(c => c[1]));

  return pins.map(p => {
    // 1) A straight line drawn INTO the pin (a lead) says it directly: away from that line's other end.
    let best = null, bestLen = 0;
    segments.forEach(([x1, y1, x2, y2]) => {
      let ox, oy;
      if (Math.abs(x1 - p.relX) < EPS && Math.abs(y1 - p.relY) < EPS) { ox = x2; oy = y2; }
      else if (Math.abs(x2 - p.relX) < EPS && Math.abs(y2 - p.relY) < EPS) { ox = x1; oy = y1; }
      else return;
      const dx = p.relX - ox, dy = p.relY - oy;
      const horizontal = Math.abs(dy) < EPS && Math.abs(dx) > EPS;
      const vertical = Math.abs(dx) < EPS && Math.abs(dy) > EPS;
      if (!horizontal && !vertical) return; // a diagonal (a switch blade, say) doesn't say which way a wire should leave
      const len = Math.abs(dx) + Math.abs(dy);
      if (len > bestLen) { bestLen = len; best = horizontal ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }; }
    });
    if (best) return best;

    // 2) Otherwise, the side of the symbol's outline the pin sits on.
    const sides = [
      [p.relX - minX, { x: -1, y: 0 }], [maxX - p.relX, { x: 1, y: 0 }],
      [p.relY - minY, { x: 0, y: -1 }], [maxY - p.relY, { x: 0, y: 1 }]
    ].sort((a, b) => a[0] - b[0]);
    if (sides[1][0] - sides[0][0] < EPS) return null; // a corner, or no outline at all
    return sides[0][1];
  });
}

// Tidies a route: drops repeated points and merges vertices that sit in a
// straight line. Returns null if the route doubles back on itself, which no
// sensible wire does.
function cleanRoute(pts) {
  const EPS = 1e-6;
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (out.length >= 2 && Math.abs(out[out.length - 2] - x) < EPS && Math.abs(out[out.length - 1] - y) < EPS) continue;
    out.push(x, y);
    while (out.length >= 6) {
      const n = out.length;
      const ax = out[n - 6], ay = out[n - 5], bx = out[n - 4], by = out[n - 3], cx = out[n - 2], cy = out[n - 1];
      const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (Math.abs(cross) > EPS) break;                      // a genuine corner
      const dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
      if (dot < 0) return null;                              // folds back on itself
      out.splice(n - 4, 2);                                  // straight through — the middle vertex isn't needed
    }
  }
  return out;
}

// From pin position P (heading `d`) to `far`: out for the lead, one right
// angle across, then along d's axis to `far`. Doesn't overshoot when `far`
// is closer than a full lead. null if `far` is directly behind the pin.
function leadRouteTo(P, d, far) {
  const EPS = 1e-6;
  const vx = far.x - P.x, vy = far.y - P.y;
  const along = vx * d.x + vy * d.y;
  const lateral = vx * d.y - vy * d.x;
  if (Math.abs(lateral) < EPS) return along > EPS ? [P.x, P.y, far.x, far.y] : null;
  const lead = (along > EPS && along < ATTACH_LEAD) ? along : ATTACH_LEAD;
  const Lx = P.x + d.x * lead, Ly = P.y + d.y * lead;
  const M = d.x === 0 ? { x: far.x, y: Ly } : { x: Lx, y: far.y };
  return [P.x, P.y, Lx, Ly, M.x, M.y, far.x, far.y];
}

// Does the route leave the pin heading `d`, and for long enough?
function leavesPinProperly(pts, P, d) {
  if (pts.length < 4) return true;
  const vx = pts[2] - P.x, vy = pts[3] - P.y;
  const along = vx * d.x + vy * d.y;
  const lateral = vx * d.y - vy * d.x;
  if (Math.abs(lateral) > 1e-6 || along <= 1e-9) return false;
  return along >= ATTACH_LEAD - 1e-9 || pts.length === 4; // a short first leg is fine only if it runs straight to the wire's far end
}

// The wire's shape before this feature existed: keep the next vertex, slide
// it so everything stays horizontal/vertical.
function legacyRoute(orig, P) {
  const tmp = { points: orig.slice() };
  updateWireEndpointOrthogonalInner(tmp, true, P.x, P.y);
  removeDuplicateVertices(tmp.points);
  return tmp.points;
}

// `orig` is the wire's original points with the attached end FIRST. Returns the
// new points, attached end first, starting at P (the pin's new position).
export function routeAttachedWire(orig, P, d) {
  const legacy = legacyRoute(orig, P);
  if (!d) return legacy;
  // Already leaves the pin the right way? Keep it — unless it runs past its own
  // far end and doubles back (cleanRoute rejects that), which is no good either.
  if (leavesPinProperly(legacy, P, d) && cleanRoute(legacy, 0) !== null) return legacy;

  // Try each vertex of the wire in turn as the place to rejoin it, nearest
  // first — the route runs pin -> lead -> one right angle -> that vertex, and
  // the wire carries on unchanged from there. The first that gives a sensible
  // route (no doubling back, and a proper lead) wins, so as little of the
  // wire as possible is disturbed.
  const n = orig.length / 2;
  for (let k = 1; k < n; k++) {
    const head = leadRouteTo(P, d, { x: orig[2 * k], y: orig[2 * k + 1] }, k === n - 1);
    if (!head) continue;
    const headVertices = head.length / 2;
    const cleaned = cleanRoute(head.concat(orig.slice(2 * k + 2)), headVertices - 1); // the vertex we rejoin at is one of the wire's own
    if (cleaned && leavesPinProperly(cleaned, P, d)) return cleaned;
  }
  return legacy;
}

// A component's own artwork: its path data, pin positions, and which way each
// pin points outward (for routing a wire leaving it). Used both to draw a
// component and — for group-move — to work out how to re-route the wires of
// a component OTHER than the one actually being dragged.
// A symbol's box on the sheet: its local bounds turned through the flip and rotation it is drawn with.
function componentWorldBox(comp) {
  const { pathData, customTexts, pins } = resolveComponentArtwork(comp);
  const b = getComponentHitBounds(comp, pathData, pins, customTexts);
  const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const fx = flipSX(comp), fy = flipSY(comp);
  const xs = [], ys = [];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
    const lx = (b.centerX + sx * b.width / 2) * fx, ly = (b.centerY + sy * b.height / 2) * fy;
    xs.push(comp.x + lx * cos - ly * sin); ys.push(comp.y + lx * sin + ly * cos);
  });
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

// The mechanical interlock drawn between two contact blocks of mechanically joined contactors (a forward/reverse
// pair): a line between the two symbols with a diamond in the middle. Side by side it runs across, stacked it runs down.
function drawMechanicalLink(a, b) {
  const A = componentWorldBox(a), B = componentWorldBox(b);
  const stroke = '#0f172a';
  const overlapX = Math.min(A.right, B.right) - Math.max(A.left, B.left);
  let x1, y1, x2, y2;
  if (overlapX > 4) {   // stacked: down from the upper symbol to the lower one, at the middle of where they overlap
    const x = (Math.max(A.left, B.left) + Math.min(A.right, B.right)) / 2;
    const [up, low] = A.top <= B.top ? [A, B] : [B, A];
    x1 = x2 = x; y1 = up.bottom; y2 = low.top;
  } else {              // side by side: across at the average of their middle heights
    const y = ((A.top + A.bottom) / 2 + (B.top + B.bottom) / 2) / 2;
    const [lf, rt] = A.left <= B.left ? [A, B] : [B, A];
    y1 = y2 = y; x1 = lf.right; x2 = rt.left;
  }
  if (!(Math.hypot(x2 - x1, y2 - y1) > 6)) return;   // touching or overlapping: nothing to draw between them
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, r = 4;
  contentLayer.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke, strokeWidth: 1, listening: false, name: 'mechanicalLink' }));
  contentLayer.add(new Konva.Line({ points: [mx, my - r, mx + r, my, mx, my + r, mx - r, my], closed: true, fill: stroke, stroke, strokeWidth: 1, listening: false, name: 'mechanicalLink' }));
}

// The dotted line from a parent to one of its child contacts on the same sheet (the parent's "dotted line to child contacts" option),
// showing that they are the one device: out of the parent sideways at its middle height, then along to the child. Stacked
// one above the other it runs straight down.
function drawParentLink(parent, child, showHandle, openEditModalCallback) {
  const A = componentWorldBox(parent), B = componentWorldBox(child);
  const stroke = '#0f172a';
  const line = (pts) => { const l = new Konva.Line({ points: pts, stroke, strokeWidth: 1, dash: [3, 3], listening: false, name: 'parentLink' }); contentLayer.add(l); return l; };
  // A small square on the line to drag it sideways (the part of a stepped line between the two ends, or a straight vertical one);
  // it is where the line sits that is kept (child.linkMidX / child.linkX), and a double-click puts it back in the middle.
  const addHandle = (hx, hy, ln, pointsFor, lo, hi, key) => {
    if (!showHandle) return;
    const scale = stage.scaleX() || 1, size = 8 / scale;
    const h = new Konva.Rect({ name: 'parentLinkHandle', x: hx, y: hy, width: size, height: size, offsetX: size / 2, offsetY: size / 2, fill: '#ffffff', stroke: '#2563eb', strokeWidth: 1.5 / scale, draggable: true });
    let fixedY = null;   // the handle stays on its own level (screen position) while it is dragged along x
    h.dragBoundFunc((pos) => ({ x: pos.x, y: fixedY === null ? pos.y : fixedY }));
    h.on('dragstart', () => { fixedY = h.getAbsolutePosition().y; pushHistory(); });
    h.on('dragmove', () => {
      const x = Math.min(hi, Math.max(lo, h.x()));
      h.x(x); ln.points(pointsFor(x)); contentLayer.batchDraw();
    });
    h.on('dragend', () => {
      fixedY = null;
      child[key] = Math.min(hi, Math.max(lo, snapToGrid(h.x(), GRID_SIZE / 2)));
      scheduleAutosave();
      renderComponents(openEditModalCallback);
    });
    h.on('dblclick dbltap', (e) => { e.cancelBubble = true; pushHistory(); delete child[key]; scheduleAutosave(); renderComponents(openEditModalCallback); });
    contentLayer.add(h);
  };
  const overlapX = Math.min(A.right, B.right) - Math.max(A.left, B.left);
  if (overlapX > 4) {
    const lo = Math.max(A.left, B.left), hi = Math.min(A.right, B.right);
    const [up, low] = A.top <= B.top ? [A, B] : [B, A];
    if (low.top - up.bottom <= 6) return;
    const x = Math.min(hi, Math.max(lo, child.linkX !== undefined ? child.linkX : (lo + hi) / 2));
    const ln = line([x, up.bottom, x, low.top]);
    addHandle(x, (up.bottom + low.top) / 2, ln, (nx) => [nx, up.bottom, nx, low.top], lo, hi, 'linkX');
    return;
  }
  const ay = (A.top + A.bottom) / 2, by = (B.top + B.bottom) / 2;
  const goesRight = (B.left + B.right) / 2 > (A.left + A.right) / 2;
  const dax = goesRight ? A.right : A.left, dbx = goesRight ? B.left : B.right;
  if (Math.abs(dbx - dax) <= 6) return;
  if (Math.abs(ay - by) <= 2 && child.linkMidX === undefined) { line([dax, ay, dbx, by]); return; }
  // The vertical run can be put anywhere, even past either symbol: the line leaves and meets each symbol on the side facing the run.
  const mx = child.linkMidX !== undefined ? child.linkMidX : (dax + dbx) / 2;
  const ends = (x) => [x < (A.left + A.right) / 2 ? A.left : A.right, x < (B.left + B.right) / 2 ? B.left : B.right];
  const pointsFor = (x) => { const [sx, ex] = ends(x); return [sx, ay, x, ay, x, by, ex, by]; };
  const ln = line(pointsFor(mx));
  addHandle(mx, (ay + by) / 2, ln, pointsFor, -Infinity, Infinity, 'linkMidX');
}

// The designators of the coils a coil is mechanically joined to (comp.jointToId): the main coil's, or the ones joined to it.
function jointPartnerLabels(comp) {
  if (!comp.isParent) return [];
  const out = [];
  state.sheets.forEach(s => (s.components || []).forEach(c => {
    if (c.id === comp.id) return;
    if ((comp.jointToId && String(c.id) === String(comp.jointToId)) || (c.jointToId && String(c.jointToId) === String(comp.id))) out.push(c.label || '?');
  }));
  return out;
}

function resolveComponentArtwork(comp) {
  let pathData = "M 0 10 L 80 10";
  let customTexts = [];

  const builtinArt = BUILTIN_SYMBOL_GEOMETRY[comp.type]; // resistor / capacitor (older projects only), ground, the supply symbols
  if (builtinArt) {
    pathData = builtinArt.pathData;
    customTexts = builtinArt.texts || [];
  } else if (comp.type === 'terminal') {
    pathData = ""; // no lead/tail — the bare pin marks the terminal
  } else if (window.customSymbolDefinitions?.[comp.type]) {
    const def = window.customSymbolDefinitions[comp.type];
    pathData = def.pathData;
    customTexts = (def.plc && plcInstanceTexts(def, comp.plcFns)) || (def.drive && driveInstanceTexts(def, comp.driveFns)) || def.texts || [];   // a placed PLC module or drive can have its own I/O functions
    if (comp.isParent && Array.isArray(comp.selfTerms) && comp.selfTerms.length && hasStandardContactPins(def)) customTexts = childContactTexts('no', comp.selfTerms);   // a parent push button's numbers come from the contact it stands for
    if (def.childContact) customTexts = childContactTexts(def.childContact, comp.contactTerms);   // a child contact's terminal numbers come from the contact it is assigned on its parent
  }

  const pins = getPinsForType(comp.type);
  const pinOutward = getPinOutwardDirections(pathData, pins);
  return { pathData, customTexts, pins, pinOutward };
}

// Remembered when a drag starts: every wire end sitting exactly on one of the
// component's pins, with the wire's shape as it was.
let dragAttachments = null;

function captureDragAttachments(comp, pins, sheet, excludeWires) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const items = [];
  pins.forEach((p, pinIdx) => {
    const pinX = comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin);
    const pinY = comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos);
    (sheet.wires || []).forEach(wire => {
      if (excludeWires && excludeWires.has(wire)) return; // part of a rubber-band group move — moves rigidly with the group instead, not re-routed here
      const pts = wire.points;
      if (!pts || pts.length < 4) return;
      if (pts[0] === pinX && pts[1] === pinY) items.push({ wire, atStart: true, pinIdx, orig: pts.slice() });
      if (pts[pts.length - 2] === pinX && pts[pts.length - 1] === pinY) items.push({ wire, atStart: false, pinIdx, orig: pts.slice() });
    });
  });
  // A wire attached at BOTH ends (a jumper between two of the component's own
  // pins, or a loop back to it) simply moves along with the component.
  const counts = new Map();
  items.forEach(it => counts.set(it.wire, (counts.get(it.wire) || 0) + 1));
  items.forEach(it => { it.rigid = counts.get(it.wire) > 1; });
  return { compId: comp.id, startX: comp.x, startY: comp.y, items };
}

// (Re)routes every attached wire for the component's CURRENT position.
function applyDragAttachments(att, comp, pins, pinOutward, sheet) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = comp.x - att.startX, dy = comp.y - att.startY;
  const done = new Set();

  att.items.forEach(item => {
    if (!sheet.wires.includes(item.wire)) return; // replaced meanwhile (e.g. split by a terminal) — leave it be
    let pts;
    if (dx === 0 && dy === 0) {
      pts = item.orig.slice(); // back where it started: exactly as it was, not re-routed
    } else if (item.rigid) {
      if (done.has(item.wire)) return;
      done.add(item.wire);
      pts = item.orig.map((v, i) => v + (i % 2 === 0 ? dx : dy));
    } else {
      const p = pins[item.pinIdx];
      const P = { x: comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin), y: comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos) };
      const local = pinOutward ? pinOutward[item.pinIdx] : null;
      const d = local ? { x: Math.round(flipSX(comp) * local.x * cos - flipSY(comp) * local.y * sin) || 0, y: Math.round(flipSX(comp) * local.x * sin + flipSY(comp) * local.y * cos) || 0 } : null;
      const routed = routeAttachedWire(item.atStart ? item.orig : reversePoints(item.orig), P, d);
      pts = item.atStart ? routed : reversePoints(routed);
    }
    logWireOp('component-drag-moved-wire-end', { wireId: item.wire.wireId, end: item.atStart ? 'start' : 'end', before: item.orig, after: pts }, 'drag-end-' + item.wire.id + (item.atStart ? 's' : 'e'));
    item.wire.points.splice(0, item.wire.points.length, ...pts);
  });
}

// Removes consecutive identical points from a wire, in place (so anything
// holding a reference to the array still sees the result). A wire that
// collapses to a single spot keeps two identical points rather than one, so it
// stays a well-formed (if zero-length) wire for the next wire pass to discard.
function removeDuplicateVertices(pts) {
  if (!pts || pts.length < 4) return;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    if (pts[i] === out[out.length - 2] && pts[i + 1] === out[out.length - 1]) continue;
    out.push(pts[i], pts[i + 1]);
  }
  if (out.length < 4) out.push(out[0], out[1]);
  pts.splice(0, pts.length, ...out);
}

function updateWireEndpointOrthogonalInner(wire, isStart, newX, newY) {
  const pts = wire.points;

  if (pts.length < 4) {
    // Degenerate (a single point) — just relocate it, nothing to keep orthogonal.
    if (isStart) { pts[0] = newX; pts[1] = newY; }
    else { pts[pts.length - 2] = newX; pts[pts.length - 1] = newY; }
    return;
  }

  if (isStart) {
    pts[0] = newX;
    pts[1] = newY;

    if (pts.length === 4) {
      const farX = pts[2], farY = pts[3];
      // Already in line with the far end (a component moved straight along its
      // wire)? Then there's nothing to bend — an elbow here would land exactly
      // on the new end and leave a zero-length segment behind.
      if (newX !== farX && newY !== farY) {
        const elbow = getOrthogonalPoint(farX, farY, newX, newY);
        pts.splice(2, 0, elbow.x, elbow.y);
      }
    } else {
      const nextX = pts[4]; // the elbow's OTHER neighbor
      if (pts[2] === nextX) {
        pts[3] = newY; // that segment is vertical (fixed X) — slide the elbow's Y freely
      } else {
        pts[2] = newX; // that segment is horizontal (fixed Y) — slide the elbow's X freely
      }
    }
  } else {
    const lastIdx = pts.length - 2;
    pts[lastIdx] = newX;
    pts[lastIdx + 1] = newY;

    if (pts.length === 4) {
      const farX = pts[0], farY = pts[1];
      if (newX !== farX && newY !== farY) { // see the matching note above
        const elbow = getOrthogonalPoint(farX, farY, newX, newY);
        pts.splice(2, 0, elbow.x, elbow.y);
      }
    } else {
      const adjIdx = lastIdx - 2;
      const nextX = pts[adjIdx - 2];
      if (pts[adjIdx] === nextX) {
        pts[adjIdx + 1] = newY;
      } else {
        pts[adjIdx] = newX;
      }
    }
  }
}

export function getNearestWireSnap(x, y, maxDistance = 15) {
  const sheet = getActiveSheet();
  if (!sheet || !sheet.wires) return null;

  let nearest = null;
  let minSqDist = maxDistance * maxDistance;

  sheet.wires.forEach(wire => {
    const pts = wire.points;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x1 = pts[i], y1 = pts[i + 1];
      const x2 = pts[i + 2], y2 = pts[i + 3];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) continue;

      let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const projX = snapToGrid(x1 + t * dx);
      const projY = snapToGrid(y1 + t * dy);

      const distSq = (x - projX) ** 2 + (y - projY) ** 2;
      if (distSq <= minSqDist) {
        minSqDist = distSq;
        nearest = { x: projX, y: projY, isWireJunction: true };
      }
    }
  });

  return nearest;
}

export function getNearestPin(x, y, maxDistance = 15) {
  const sheet = getActiveSheet();
  if (!sheet || !sheet.components) return null;

  let nearest = null;
  let minSqDist = maxDistance * maxDistance;

  sheet.components.forEach(comp => {
    const pins = getPinsForType(comp.type);

    const rad = ((comp.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    pins.forEach(p => {
      const absX = comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin);
      const absY = comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos);

      const dx = x - absX;
      const dy = y - absY;
      const sqDist = dx * dx + dy * dy;

      if (sqDist <= minSqDist) {
        minSqDist = sqDist;
        nearest = { x: absX, y: absY, compId: comp.id };
      }
    });
  });

  return nearest;
}

// Every terminal's pin position on the sheet, as "x,y" strings — these are
// deliberate physical break points (see snapComponentIntoWires) and must
// never have wires reconstructed/merged back across them.
function getTerminalPinPositions(sheet) {
  const positions = new Set();
  (sheet?.components || []).forEach(comp => {
    if (comp.type !== 'terminal') return;
    const pins = getPinsForType(comp.type);
    const rad = ((comp.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    pins.forEach(p => {
      const x = comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin);
      const y = comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos);
      positions.add(`${x},${y}`);
    });
  });
  return positions;
}

export function processWireIntersectionsAndMerges(wires, breakPoints) {
  let segments = [];
  wires.forEach(wire => {
    const pts = wire.points;
    for (let i = 0; i < pts.length - 2; i += 2) {
      // Nothing to draw or connect, and it can only cause harm below — drop it.
      // (A wire made of nothing but these vanishes, which is right: healing can
      // collapse a tiny wire onto a pin, and dragging a terminal can shrink one
      // to nothing.)
      if (pts[i] === pts[i + 2] && pts[i + 1] === pts[i + 3]) continue;
      segments.push({
        p1: { x: pts[i], y: pts[i + 1] },
        p2: { x: pts[i + 2], y: pts[i + 3] },
        wireId: wire.wireId || null,
        wireIdManual: !!wire.wireIdManual,
        wireIdUser: !!wire.wireIdUser,
        hideWireId: !!wire.hideWireId,   // "hide this wire's ID" must survive the rebuild that every newly drawn wire triggers
        id: wire.id,
        // A label the person dragged somewhere is an absolute position on the
        // sheet — carried through so it survives the rebuild below instead of
        // snapping back to the wire's default midpoint.
        labelX: wire.labelX,
        labelY: wire.labelY
      });
    }
  });

  let splitOccurred = true;
  while (splitOccurred) {
    splitOccurred = false;
    for (let i = 0; i < segments.length; i++) {
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        
        const pointsToTest = [segments[j].p1, segments[j].p2];
        for (const pt of pointsToTest) {
          if (pointStrictlyOnSegment(pt, segments[i])) {
            const segI = segments[i];
            segments.splice(i, 1);
            segments.push({ ...segI, p1: segI.p1, p2: { x: pt.x, y: pt.y } });
            segments.push({ ...segI, p1: { x: pt.x, y: pt.y }, p2: segI.p2 });
            splitOccurred = true;
            break;
          }
        }
        if (splitOccurred) break;
      }
      if (splitOccurred) break;
    }
  }

  // Dedup coincident/reversed segments, keeping whichever copy's metadata is
  // "better" — a manually-named one wins over an auto/unnamed duplicate — rather
  // than just keeping whichever happened to appear first.
  const deduped = [];
  segments.forEach(seg => {
    const matchIdx = deduped.findIndex(s =>
      (s.p1.x === seg.p1.x && s.p1.y === seg.p1.y && s.p2.x === seg.p2.x && s.p2.y === seg.p2.y) ||
      (s.p1.x === seg.p2.x && s.p1.y === seg.p2.y && s.p2.x === seg.p1.x && s.p2.y === seg.p1.y)
    );
    if (matchIdx === -1) {
      deduped.push(seg);
    } else {
      const kept = deduped[matchIdx];
      if ((seg.wireIdUser && !kept.wireIdUser) || (seg.wireIdManual && !kept.wireIdManual)) {
        deduped[matchIdx] = { ...seg, labelX: seg.labelX ?? kept.labelX, labelY: seg.labelY ?? kept.labelY, hideWireId: seg.hideWireId || kept.hideWireId };
      } else if (seg.hideWireId && !kept.hideWireId) {
        kept.hideWireId = true;
        if (kept.labelX === undefined && seg.labelX !== undefined) { kept.labelX = seg.labelX; kept.labelY = seg.labelY; }
      } else if (kept.labelX === undefined && seg.labelX !== undefined) {
        kept.labelX = seg.labelX;
        kept.labelY = seg.labelY;
      }
    }
  });

  const rebuilt = reconstructWiresFromSegments(deduped, breakPoints);
  logWireOp('wires-rebuilt (split/merge pass)', { wiresIn: wires.length, wiresOut: rebuilt.length });
  return rebuilt;
}

function pointStrictlyOnSegment(pt, seg) {
  const { p1, p2 } = seg;
  // A zero-length segment (p1 === p2) has no middle for a point to be in.
  // Without this guard, every term below works out to 0 — cross product, dot
  // product AND length — so the final "dot > length" check is `0 > 0` (false)
  // and EVERY point on the sheet counts as lying on it. The split step then
  // cut the segment at every other wire's endpoint, producing a fan of long
  // diagonal wires from that one spot to every wire end on the sheet.
  if (p1.x === p2.x && p1.y === p2.y) return false;
  if ((pt.x === p1.x && pt.y === p1.y) || (pt.x === p2.x && pt.y === p2.y)) return false;

  const crossProduct = (pt.y - p1.y) * (p2.x - p1.x) - (pt.x - p1.x) * (p2.y - p1.y);
  if (Math.abs(crossProduct) > 0.001) return false;

  const dotProduct = (pt.x - p1.x) * (p2.x - p1.x) + (pt.y - p1.y) * (p2.y - p1.y);
  if (dotProduct < 0) return false;

  const squaredLength = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
  if (dotProduct > squaredLength) return false;

  return true;
}

// ---- Junction dots vs. crossing hops ----
// A "junction" is a point where wires are actually electrically connected (a T or +
// meeting of wire ends). A "crossing" is where two unconnected wires merely overlap
// visually on the page. Schematic convention: draw a filled dot at real junctions,
// and a small hop/bump where wires cross without connecting, so the two cases are
// never ambiguous at a glance.
function getWireSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 2; i += 2) {
    segs.push({ x1: points[i], y1: points[i + 1], x2: points[i + 2], y2: points[i + 3] });
  }
  return segs;
}

function computeJunctionPoints(wires) {
  // Count how many segment-ends (from ALL wires, at every vertex — not just each
  // wire's own first/last point) land at each coordinate. A plain bend within one
  // wire contributes 2 (the segment in, the segment out) — not a junction. A plain
  // end-to-end join between two separate wires also totals 2 — still not a junction
  // (it's just continuity, no branch). Only where 3+ segment-ends converge is there
  // an actual electrical branch, regardless of which wire object each segment
  // happened to end up grouped into after processWireIntersectionsAndMerges.
  const touchCounts = new Map();
  const key = (x, y) => `${x},${y}`;

  wires.forEach(wire => {
    const pts = wire.points;
    for (let i = 0; i < pts.length - 2; i += 2) {
      // A zero-length segment isn't a connection to anything, but it would add
      // two segment-ends at its spot — enough on its own to tip an ordinary
      // wire end past the threshold and draw a dot that isn't a junction.
      if (pts[i] === pts[i + 2] && pts[i + 1] === pts[i + 3]) continue;
      const k1 = key(pts[i], pts[i + 1]);
      const k2 = key(pts[i + 2], pts[i + 3]);
      touchCounts.set(k1, (touchCounts.get(k1) || 0) + 1);
      touchCounts.set(k2, (touchCounts.get(k2) || 0) + 1);
    }
  });

  const junctions = new Set();
  touchCounts.forEach((count, k) => { if (count >= 3) junctions.add(k); });
  return junctions;
}

// ---- Junction dots vs. the "hop" alternative ----
// An alternative to a filled dot: on a plain T-junction, the through-wire
// steps down toward the branch and back up, closing the gap where the
// branch's own end meets it — the wire's own shape shows the connection,
// with nothing extra drawn. Only unambiguous: exactly two of the three
// wire-ends at the junction opposite each other (a straight "through" line)
// and the third perpendicular to it (the "branch"). A 4-way "+", or any
// junction where nothing lines up straight, still gets the plain dot even
// with this style chosen — there's no clean way to hop three or four wires
// at once.
const NOTCH_HALF_SPAN = 6; // how far back along the through-wire, each side, before it starts dipping
const NOTCH_DEPTH = 6;     // how far toward the branch the dip reaches

export function classifyNotchJunction(x, y, wires) {
  const dirs = []; // unit direction, pointing AWAY from (x,y), for every segment-end that touches it
  wires.forEach(wire => {
    const pts = wire.points;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const p1x = pts[i], p1y = pts[i + 1], p2x = pts[i + 2], p2y = pts[i + 3];
      if (p1x === p2x && p1y === p2y) continue;
      if (p1x === x && p1y === y) {
        const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy);
        dirs.push({ dx: dx / len, dy: dy / len });
      }
      if (p2x === x && p2y === y) {
        const dx = p1x - p2x, dy = p1y - p2y, len = Math.hypot(dx, dy);
        dirs.push({ dx: dx / len, dy: dy / len });
      }
    }
  });
  if (dirs.length !== 3) return null;

  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (dirs[i].dx * dirs[j].dx + dirs[i].dy * dirs[j].dy < -0.999) { // exactly opposite -> a straight through-line
        const branch = dirs[3 - i - j]; // the one remaining direction
        const perpDot = dirs[i].dx * branch.dx + dirs[i].dy * branch.dy;
        if (Math.abs(perpDot) > 0.01) return null; // the third wire isn't perpendicular — not a clean T
        return { throughDir: dirs[i], branchDir: branch };
      }
    }
  }
  return null;
}

// Every junction that qualifies for a notch, keyed the same way computeJunctionPoints
// keys its own Set ("x,y") — anything NOT in this map still gets the plain dot.
export function computeNotchJunctions(wires) {
  const notchMap = new Map();
  computeJunctionPoints(wires).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const classified = classifyNotchJunction(x, y, wires);
    if (classified) notchMap.set(k, classified);
  });
  return notchMap;
}

// Returns a NEW points array (the original is never touched) with the dip
// spliced in at whichever end(s) of this wire land on a notched junction —
// two points for the through-wire side (a step back, then the dip), one for
// the branch side (stretched just that bit further to meet the dip exactly).
//
// direction picks which way the dip goes. 'toward' (the original look) dips the
// through-wire toward the branch, so the branch meets the point of the dip.
// 'away' mirrors it: the through-wire dips to the far side of its own line,
// and the branch carries on through the gap to meet it — the same connection
// shown the other way round, for when a dip toward the branch lands on
// something or simply reads better the other way.
export function applyNotchToWirePoints(points, notchMap, direction = 'toward') {
  if (!notchMap.size || points.length < 4) return points;

  const modifyEnd = (isStart) => {
    const xi = isStart ? 0 : points.length - 2;
    const x = points[xi], y = points[xi + 1];
    const info = notchMap.get(`${x},${y}`);
    if (!info) return null;

    const nxi = isStart ? 2 : points.length - 4;
    const dx = points[nxi] - x, dy = points[nxi + 1] - y, len = Math.hypot(dx, dy) || 1;
    const awayDir = { dx: dx / len, dy: dy / len }; // back toward this wire's OWN interior, away from the junction
    const isThrough = Math.abs(awayDir.dx * info.throughDir.dx + awayDir.dy * info.throughDir.dy) > 0.99;

    // Corner-and-diagonal look (info.square points toward the half of the
    // through-line that keeps a plain 90 degree corner with the branch, right at
    // the junction): that half, and the branch, are left exactly as they are. The
    // OTHER half stops short of the junction and reaches the branch by a 45 degree
    // diagonal instead — it ends NOTCH_HALF_SPAN back along its own line, then runs
    // diagonally to the point on the branch NOTCH_DEPTH from the junction. (45
    // degrees exactly, because those two are equal.)
    //
    // A VERTICAL through-line is different: it stays perfectly straight and
    // unbroken, with no right angle anywhere. The BRANCH is what changes — it
    // stops NOTCH_DEPTH short of the line and reaches it by the 45 degree diagonal,
    // meeting the line NOTCH_HALF_SPAN along it on the side away from info.square
    // (so the diagonal is on the same side as it was for the other orientation).
    if (info.square) {
      if (Math.abs(info.throughDir.dx) < 0.5) {
        if (isThrough) return null; // the vertical line itself is not touched
        return [
          { x: x + info.branchDir.dx * NOTCH_DEPTH, y: y + info.branchDir.dy * NOTCH_DEPTH },
          { x: x - info.square.dx * NOTCH_HALF_SPAN, y: y - info.square.dy * NOTCH_HALF_SPAN },
        ];
      }
      if (!isThrough) return null;
      if (awayDir.dx * info.square.dx + awayDir.dy * info.square.dy > 0.99) return null; // the square-cornered half
      return [
        { x: x + awayDir.dx * NOTCH_HALF_SPAN, y: y + awayDir.dy * NOTCH_HALF_SPAN },
        { x: x + info.branchDir.dx * NOTCH_DEPTH, y: y + info.branchDir.dy * NOTCH_DEPTH },
      ];
    }

    // A junction can carry its own dip direction (set by clicking it — see the
    // per-junction overrides below); otherwise it follows the drawing-wide one.
    const dipDir = info.dip || (direction === 'away' ? { dx: -info.branchDir.dx, dy: -info.branchDir.dy } : info.branchDir);
    const notchVertex = { x: x + dipDir.dx * NOTCH_DEPTH, y: y + dipDir.dy * NOTCH_DEPTH };
    if (isThrough) {
      const stepBack = { x: x + awayDir.dx * NOTCH_HALF_SPAN, y: y + awayDir.dy * NOTCH_HALF_SPAN };
      return [stepBack, notchVertex];
    }
    return [notchVertex];
  };

  const endReplacement = modifyEnd(false);
  const startReplacement = modifyEnd(true);

  let result = points;
  if (endReplacement) {
    result = result.slice(0, result.length - 2).concat(endReplacement.flatMap(p => [p.x, p.y]));
  }
  if (startReplacement) {
    result = startReplacement.slice().reverse().flatMap(p => [p.x, p.y]).concat(result.slice(2));
  }
  return result;
}

// ---- Per-junction overrides: automatic by default, clickable to change ----
//
// The ribbon's Junction (Dot / Hop) and Hop (Toward / Away) buttons are the
// AUTOMATIC setting for the whole drawing. Clicking an individual junction
// overrides just that one, stepping through its looks (Shift-click steps back):
//
//   dot
//   corner:end1 / :end2  (HORIZONTAL through-line) corner and diagonal: one half of the through-line makes
//                        a plain 90 degree corner with the branch at the
//                        junction, and the other half stops short and rejoins the
//                        branch by a 45 degree diagonal. end1 is the left half of
//                        a horizontal line / the upper half of a vertical one,
//                        end2 the other — the half named keeps the square corner.
//                        (VERTICAL through-line) the line stays straight and
//                        unbroken, and the branch reaches it by a 45 degree
//                        diagonal instead of a right angle: end1 puts the
//                        diagonal below the branch's level, end2 above it.
//
// (The symmetric V — 'toward' / 'away' — is only the AUTOMATIC Hop style from the
// ribbon's Hop button; it is not part of the click cycle. A junction saved with
// one from an earlier version still draws it, and its next click clears it back
// to automatic.)
//
// A junction whose look matches the automatic setting has no override at all,
// so going all the way round always lands back on following it.
//
// What is stored, per sheet, is sheet.junctionOverrides: { "x,y": value }, with
// value 'dot', the real direction a symmetric hop dips ('up' | 'down' | 'left' |
// 'right'), or 'corner:' plus the direction of the half that keeps the square
// corner ('corner:up' = upper half square, lower half on the diagonal). Real
// directions rather than "toward/away the branch", so a junction keeps its look
// if its branch is later re-routed to the other side.
const JUNCTION_LOOKS = ['dot', 'corner:end1', 'corner:end2']; // what a click steps through (the automatic look joins the cycle too, see nextJunctionOverride)
const NAME_BY_VECTOR = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };
const VECTOR_BY_NAME = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
const vectorKey = (v) => `${Math.round(v.dx)},${Math.round(v.dy)}`;
const sameVector = (a, b) => Math.abs(a.dx - b.dx) < 1e-9 && Math.abs(a.dy - b.dy) < 1e-9;
const reverseVector = (v) => ({ dx: -v.dx, dy: -v.dy });

function automaticJunctionAppearance(style, direction) {
  return style === 'notch' ? (direction === 'away' ? 'away' : 'toward') : 'dot';
}

// The two halves of a junction's through-line as unit vectors pointing out from
// the junction, in a fixed order: left then right for a horizontal line, up then
// down for a vertical one.
function throughEnds(info) {
  return Math.abs(info.throughDir.dx) > 0.5 ? [VECTOR_BY_NAME.left, VECTOR_BY_NAME.right] : [VECTOR_BY_NAME.up, VECTOR_BY_NAME.down];
}

// Only a T whose lines run exactly along the grid can be named by a direction
// (every wire the app draws does). Anything else just follows the automatic setting.
export function isClickableJunction(info) {
  const axisAligned = (v) => Math.abs(v.dx * v.dy) < 1e-9 && Math.abs(v.dx) + Math.abs(v.dy) > 0.999;
  return !!info && axisAligned(info.branchDir) && axisAligned(info.throughDir) && !!NAME_BY_VECTOR[vectorKey(info.branchDir)];
}

// The shape of a look: { dip } for a symmetric hop (which way it dips), or
// { square } for a corner-and-diagonal one (which half keeps the square corner).
// null for a plain dot.
export function junctionLookGeometry(info, look) {
  if (!look || look === 'dot') return null;
  const [kind, end] = look.split(':');
  if (kind === 'corner') return { square: end === 'end2' ? throughEnds(info)[1] : throughEnds(info)[0] };
  const dip = kind === 'away' ? reverseVector(info.branchDir) : { dx: info.branchDir.dx, dy: info.branchDir.dy };
  return { dip };
}

// The dip direction (a unit vector) of a symmetric hop, or null for a dot or a
// corner-and-diagonal look (which does not dip).
export function junctionDipVector(info, look) {
  const g = junctionLookGeometry(info, look);
  return g && g.dip ? g.dip : null;
}

function lookToOverride(info, look) {
  if (look === 'dot') return 'dot';
  const g = junctionLookGeometry(info, look);
  return g.square ? `corner:${NAME_BY_VECTOR[vectorKey(g.square)]}` : NAME_BY_VECTOR[vectorKey(g.dip)];
}

// The look an override stands for on THIS junction, or null if it does not fit
// (the junction has been re-wired since) or is not recognised.
function overrideToLook(info, override) {
  if (override === 'dot') return 'dot';
  if (typeof override !== 'string') return null;
  if (override.startsWith('corner:')) {
    const half = VECTOR_BY_NAME[override.slice('corner:'.length)];
    if (!half) return null;
    const ends = throughEnds(info);
    if (sameVector(half, ends[0])) return 'corner:end1';
    if (sameVector(half, ends[1])) return 'corner:end2';
    return null;
  }
  const dip = VECTOR_BY_NAME[override];
  if (!dip) return null;
  if (sameVector(dip, info.branchDir)) return 'toward';
  if (sameVector(dip, reverseVector(info.branchDir))) return 'away';
  return null;
}

// What a junction looks like right now: 'dot', one of the two corner-and-diagonal
// looks, or — as the automatic Hop style, or from an older saved choice — a
// symmetric 'toward' / 'away'.
export function currentJunctionAppearance(info, override, style, direction) {
  return overrideToLook(info, override) ?? automaticJunctionAppearance(style, direction);
}

// What the override should be after one click (step = 1) or one Shift-click
// (step = -1) — a value to store, or null for "no override: follow the
// automatic setting".
//
// The automatic look is part of the cycle: it is already 'dot' when Dot is the
// automatic style, and when Hop is the automatic style it comes first, then dot,
// then the two corner looks, then round to it again. A look that is not in the
// cycle at all (an older saved symmetric choice) goes straight to the start of
// it, which is the automatic look when going forward.
export function nextJunctionOverride(info, override, style, direction, step = 1) {
  const now = currentJunctionAppearance(info, override, style, direction);
  const auto = automaticJunctionAppearance(style, direction);
  const cycle = JUNCTION_LOOKS.includes(auto) ? JUNCTION_LOOKS : [auto, ...JUNCTION_LOOKS];
  const at = cycle.indexOf(now);
  const next = at === -1 ? (step > 0 ? cycle[0] : cycle[cycle.length - 1]) : cycle[(at + step + cycle.length) % cycle.length];
  if (next === auto) return null;
  return lookToOverride(info, next);
}

// Clicks one junction on a sheet round to its next look (or, with step -1, its previous one). Undoable, and housekeeping
// as it goes: overrides left behind where a junction no longer exists (its wires
// were moved) are dropped. Returns the new look, or null if there is nothing there
// to click.
export function cycleJunctionOverride(sheet, key, step = 1) {
  const info = computeNotchJunctions(sheet.wires).get(key);
  if (!isClickableJunction(info)) return null;

  pushHistory();
  const overrides = sheet.junctionOverrides || {};
  const next = nextJunctionOverride(info, overrides[key], state.junctionStyle, state.junctionHopDirection, step);
  if (next === null) delete overrides[key]; else overrides[key] = next;

  const stillJunctions = computeJunctionPoints(sheet.wires);
  Object.keys(overrides).forEach(k => { if (!stillJunctions.has(k)) delete overrides[k]; });
  if (Object.keys(overrides).length) sheet.junctionOverrides = overrides; else delete sheet.junctionOverrides;

  const look = currentJunctionAppearance(info, next, state.junctionStyle, state.junctionHopDirection);
  logWireOp('junction-look-set', { at: key, look, override: next });
  return look;
}

// The junctions on the sheet being drawn that can be clicked, for the click and
// hover handling — rebuilt on every render of the wires.
let clickableJunctionTargets = [];
const JUNCTION_CLICK_RADIUS = 9;       // drawing units — never smaller than this...
const JUNCTION_CLICK_RADIUS_PX = 12;   // ...nor smaller than this many pixels on screen, so zooming out does not shrink it to nothing
let lastWirePress = null;        // where the pointer went down on a wire, so a click only counts if it began at the junction too

// Hover feedback. In Hop style a junction has no dot to point at, so while the
// pointer is over one that can be clicked (Select tool only) it gets a faint ring
// and the pointer cursor.
let junctionHoverRing = null;
let junctionRingShown = false; // tracked here, so moving about away from junctions never redraws anything
let junctionCursorSet = false;

function hideJunctionHover() {
  if (junctionRingShown && junctionHoverRing) {
    junctionHoverRing.setAttrs({ visible: false });
    junctionRingShown = false;
    wirePreviewLayer.batchDraw();
  }
  if (junctionCursorSet) { setCanvasCursor(''); junctionCursorSet = false; }
}

function updateJunctionHover(raw) {
  const hit = raw && state.currentTool === 'select' && !isMainCanvasSpaceHeld() ? junctionNear(clickableJunctionTargets, raw) : null;
  if (!hit) { hideJunctionHover(); return; }
  if (!junctionHoverRing || !junctionHoverRing.getParent()) {
    junctionHoverRing = new Konva.Circle({ radius: 7, stroke: '#2563eb', strokeWidth: 1.5, fill: 'rgba(37, 99, 235, 0.12)', listening: false, visible: false });
    wirePreviewLayer.add(junctionHoverRing);
  }
  junctionHoverRing.setAttrs({ x: hit.x, y: hit.y, radius: Math.max(7, 10 / ((typeof stage.scaleX === 'function' && stage.scaleX()) || 1)), visible: true });
  junctionRingShown = true;
  wirePreviewLayer.batchDraw();
  setCanvasCursor('pointer');
  junctionCursorSet = true;
}

function junctionClickRadius() {
  const scale = (typeof stage.scaleX === 'function' && stage.scaleX()) || 1;
  return Math.max(JUNCTION_CLICK_RADIUS, JUNCTION_CLICK_RADIUS_PX / scale);
}

function junctionNear(targets, pt) {
  let best = null, bestDist = junctionClickRadius();
  targets.forEach(t => { const d = Math.hypot(t.x - pt.x, t.y - pt.y); if (d <= bestDist) { best = t; bestDist = d; } });
  return best;
}

// Cuts a wire's DRAWN line at every junction that has a look of its own, so each
// piece ends exactly at the junction. The app regroups wires as it goes
// (reconstructWiresFromSegments), and it does not stop at a three-way junction: a
// T is normally stored as one wire running THROUGH the junction (or an L-shaped
// wire of one half plus the branch) and another ending there — the junction is a
// middle vertex of a wire, not the end of three. applyNotchToWirePoints can only
// reshape the ends of the line it is given, so without this a look would only
// reach whichever wires happened to end at the junction, and the rest of the
// shape would be missing. Only the drawing is cut: the stored wire is untouched.
export function splitWirePointsAtJunctions(points, splitMap) {
  if (!splitMap || !splitMap.size || points.length < 6) return [points];
  const pieces = [];
  let from = 0;
  for (let i = 2; i < points.length - 2; i += 2) {
    if (splitMap.has(`${points[i]},${points[i + 1]}`)) {
      pieces.push(points.slice(from, i + 2));
      from = i;
    }
  }
  pieces.push(points.slice(from));
  return pieces;
}

// How close a wire endpoint has to be (in world units) to a pin or another wire
// before it's considered a "near miss" worth auto-healing, rather than two things
// that were deliberately left unconnected. Small — this should never accidentally
// join wires that are meaningfully apart.
const HEAL_TOLERANCE = 8;

function getAllPinPositions(sheet) {
  const positions = [];
  (sheet.components || []).forEach(comp => {
    const pins = getPinsForType(comp.type);

    const rad = ((comp.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    pins.forEach(p => {
      positions.push({
        x: comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin),
        y: comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos)
      });
    });
  });
  return positions;
}


// Every wire on the sheet that the given line (the cable tool's drag
// gesture) actually crosses, each as { wire, x, y } — the exact point it
// crosses at, so a tick can be drawn there. Each wire counted once even if
// crossed multiple times.
// The wires a drag line passes THROUGH: a wire counts only if its path goes
// from one side of the line to the other. One that merely touches it — ending
// on it, or turning at a corner that happens to sit on it — doesn't. That
// matters now the line snaps to the grid: grid lines are exactly where wires
// end and turn, so counting every touch would sweep in wires that never cross.
// (A line's own ends count as on it: dragging until you reach a wire includes it.)
function findWiresCrossedByLine(sheet, x1, y1, x2, y2) {
  const EPS = 1e-6;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len === 0) return [];
  // Signed distance from the drag line: negative / positive = the two sides, 0 = on it.
  const dist = (x, y) => (dx * (y - y1) - dy * (x - x1)) / len;
  const side = (x, y) => { const d = dist(x, y); return Math.abs(d) < EPS ? 0 : Math.sign(d); };
  const along = (x, y) => ((x - x1) * dx + (y - y1) * dy) / (len * len); // 0 at the line's start, 1 at its end

  const crossed = [];
  (sheet.wires || []).forEach(wire => {
    const pts = wire.points;
    if (!pts || pts.length < 4) return;

    let prevSide = 0, prevIdx = -1;
    for (let i = 0; i < pts.length; i += 2) {
      const s = side(pts[i], pts[i + 1]);
      if (s === 0) continue; // on the line itself — decided by what's on either side of it
      if (prevSide !== 0 && s !== prevSide) {
        // The path went from one side to the other between vertices prevIdx and i.
        // Where it met the line: at the first vertex sitting on it (a straight-through
        // vertex, or the start of a stretch running along it), or, with none, part-way
        // along the segment between them.
        let pt;
        if (i - prevIdx > 2) {
          pt = { x: pts[prevIdx + 2], y: pts[prevIdx + 3] };
        } else {
          const dA = dist(pts[prevIdx], pts[prevIdx + 1]), dB = dist(pts[i], pts[i + 1]);
          const t = dA / (dA - dB);
          pt = { x: pts[prevIdx] + t * (pts[i] - pts[prevIdx]), y: pts[prevIdx + 1] + t * (pts[i + 1] - pts[prevIdx + 1]) };
        }
        const u = along(pt.x, pt.y);
        if (u >= -EPS && u <= 1 + EPS) { crossed.push({ wire, x: pt.x, y: pt.y }); break; } // one core per wire
      }
      prevSide = s;
      prevIdx = i;
    }
  });
  return crossed;
}

// Whether this SPECIFIC wire currently occupies a cable core — used to give
// cable-bundled wires a distinct dash pattern instead of a solid line.
// Matches geometrically: does this wire's own current path pass through the
// exact point a cable marker crossed it at? That's more robust than tracking
// a wire's internal id, which can churn whenever wires get rebuilt elsewhere
// on the sheet. Matching by wireId alone would also dash the OTHER side of a
// terminal split, since both segments share the same net label — this stays
// specific to the actual segment that was crossed.
// Extracts every coordinate a symbol's path data actually visits — M/L pairs
// directly, and an arc's endpoint (the last two numbers; the earlier ones
// are radius/rotation/flags, not a position) — good enough for a bounding
// box even though it doesn't trace an arc's curve itself.
function extractPathCoordinates(pathData) {
  const coords = [];
  if (!pathData) return coords;
  // pathData is a plain string for built-in types but an array of
  // {d, dash} segments for custom symbols — normalize first so both work.
  normalizePathData(pathData).forEach(seg => {
    const tokens = (seg.d || '').match(/[MLA][^MLA]*/g) || [];
    tokens.forEach(token => {
      const cmd = token[0];
      const nums = (token.slice(1).match(/-?\d+\.?\d*/g) || []).map(Number);
      if (cmd === 'M' || cmd === 'L') {
        for (let i = 0; i + 1 < nums.length; i += 2) coords.push({ x: nums[i], y: nums[i + 1] });
      } else if (cmd === 'A' && nums.length >= 7) {
        coords.push({ x: nums[nums.length - 2], y: nums[nums.length - 1] });
      }
    });
  });
  return coords;
}

// A component's actual visual extent — from its pins, path geometry, and
// any labels drawn as part of the symbol itself — used to size the
// selection highlight to the real symbol instead of a fixed box that's
// often far bigger than small components, trapping neighbours underneath it.
let lastCompClick = { id: null, time: 0 };   // for double-click on a component symbol (see renderComponents)

function computeComponentBounds(pathData, pins, customTexts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const consider = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };

  (pins || []).forEach(p => consider(p.relX, p.relY));
  extractPathCoordinates(pathData).forEach(c => consider(c.x, c.y));
  (customTexts || []).forEach(t => consider(t.relX, t.relY));

  if (!isFinite(minX)) return { width: 30, height: 30, centerX: 0, centerY: 0 }; // no geometry found — safe fallback

  const PADDING = 8, MIN_SIZE = 24;
  return {
    width: Math.max(maxX - minX + PADDING * 2, MIN_SIZE),
    height: Math.max(maxY - minY + PADDING * 2, MIN_SIZE),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

// The area that belongs to a component: what responds to clicks AND what the
// blue selection outline draws. Deliberately one shared definition, so the two
// can never drift apart — before this, the outline hugged the symbol but the
// click area stayed a fixed 80x80 square centred on the origin, which was far
// too big for small symbols (an N.O contact caught clicks meant for its
// neighbours) and too small, or off-centre, for large ones (most of a relay
// couldn't be clicked at all). Terminals stay small, since they're placed
// densely like a real DIN rail strip.
const TERMINAL_HIT_SIZE = 16;

// How a terminal that has a block and position looks on the sheet: a solid dot
// inside a circle, on its wire, with its designator to the left and its position
// to the right, both on one line just above it. All distances are from the centre.
const TERMINAL_DOT_RADIUS = 2.25;
const TERMINAL_RING_RADIUS = 4.5;
const TERMINAL_DESIGNATOR_GAP = 6.5;  // the designator ends this far to the left of the centre (clear of the circle)...
const TERMINAL_POSITION_GAP = 6.5;   // ...and the position starts this far to its right
const TERMINAL_LABEL_RAISE = 10;     // the text sits this far above the centre
function getComponentHitBounds(comp, pathData, pins, customTexts) {
  if (comp.type === 'terminal') return { width: TERMINAL_HIT_SIZE, height: TERMINAL_HIT_SIZE, centerX: 0, centerY: 0 };
  return computeComponentBounds(pathData, pins, customTexts);
}

function isWireObjectAssignedToCable(sheet, wire) {
  const pts = wire.points;
  if (!pts || pts.length < 2) return false;

  return (sheet.cableMarkers || []).some(marker =>
    marker.kind !== 'connector' && (marker.coreAssignments || []).some(ca => {
      for (let i = 0; i < pts.length - 2; i += 2) {
        const seg = { x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] };
        if (closestPointOnSegment(ca.x, ca.y, seg).distSq < 0.01) return true;
      }
      return false;
    })
  );
}

// Projects (x,y) onto a segment, clamped to the segment's extent, and returns the
// closest point on it plus the squared distance to (x,y).
function closestPointOnSegment(x, y, seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: seg.x1, y: seg.y1, distSq: (x - seg.x1) ** 2 + (y - seg.y1) ** 2 };

  let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = seg.x1 + t * dx, py = seg.y1 + t * dy;
  return { x: px, y: py, distSq: (x - px) ** 2 + (y - py) ** 2 };
}

// Finds loose wire endpoints (not already touching a pin or another wire exactly)
// that sit within HEAL_TOLERANCE of one, without mutating anything — a dry run so
// callers can decide whether there's anything to undo-track before applying it.
function findHealableEndpoints(sheet, tolerance = HEAL_TOLERANCE) {
  const wires = sheet.wires || [];
  if (wires.length === 0) return [];

  const pinPositions = getAllPinPositions(sheet);
  const fixes = [];

  wires.forEach((wire, wireIdx) => {
    const pts = wire.points;
    if (!pts || pts.length < 2) return;

    [0, pts.length - 2].forEach(offset => {
      const x = pts[offset], y = pts[offset + 1];

      const touchesPinExactly = pinPositions.some(p => p.x === x && p.y === y);
      const touchesWireExactly = wires.some((other, oi) => {
        if (oi === wireIdx) return false;
        const opts = other.points;
        for (let i = 0; i < opts.length; i += 2) {
          if (opts[i] === x && opts[i + 1] === y) return true;
        }
        return false;
      });
      if (touchesPinExactly || touchesWireExactly) return; // already properly connected

      let best = null;
      let bestDistSq = tolerance * tolerance;

      pinPositions.forEach(p => {
        const distSq = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (distSq <= bestDistSq) { bestDistSq = distSq; best = { x: p.x, y: p.y }; }
      });

      wires.forEach((other, oi) => {
        if (oi === wireIdx) return;
        getWireSegments(other.points).forEach(seg => {
          const proj = closestPointOnSegment(x, y, seg);
          if (proj.distSq <= bestDistSq) { bestDistSq = proj.distSq; best = { x: proj.x, y: proj.y }; }
        });
      });

      if (best) fixes.push({ wireIdx, offset, x: best.x, y: best.y });
    });
  });

  return fixes;
}

// Applies fixes found by findHealableEndpoints, then re-runs the wire
// intersection/merge pass so any newly-exact touches become real junctions.
function applyHealFixes(sheet, fixes) {
  if (fixes.length > 0) {
    logWireOp('heal-endpoints', fixes.map(f => ({
      wireIdx: f.wireIdx, end: f.offset === 0 ? 'start' : 'end',
      from: [sheet.wires[f.wireIdx]?.points[f.offset], sheet.wires[f.wireIdx]?.points[f.offset + 1]], to: [f.x, f.y]
    })));
  }
  fixes.forEach(({ wireIdx, offset, x, y }) => {
    const pts = sheet.wires[wireIdx]?.points;
    if (!pts) return;
    pts[offset] = x;
    pts[offset + 1] = y;
  });
  if (fixes.length > 0) {
    sheet.wires = processWireIntersectionsAndMerges(sheet.wires, getTerminalPinPositions(sheet));
  }
}

// Public entry point: snaps loose wire endpoints on the given sheet onto a nearby
// pin or wire within HEAL_TOLERANCE. Returns how many endpoints were healed.
export function healSheetConnections(sheet, tolerance = HEAL_TOLERANCE) {
  const fixes = findHealableEndpoints(sheet, tolerance);
  applyHealFixes(sheet, fixes);
  return fixes.length;
}

// Two separate tolerances, deliberately far apart: a generous SEARCH radius
// just to find a candidate wire to pull toward (since the component's anchor
// point — what the cursor controls — isn't the same point as any of its
// pins, a visually-close drop needs real room to be detected at all); and a
// tight EXACT tolerance that's the only distance close enough to actually
// splice a connection in. The gap between them is what keeps a multi-pin
// component's other pins from misconnecting to a neighboring wire merely
// because it was "close enough" under one shared, looser tolerance.
const WIRE_SPLICE_SEARCH_TOLERANCE = 20;
const WIRE_SPLICE_EXACT_TOLERANCE = 3;
// Tighter than the general search radius above — placing a terminal is a
// single click with no drag feedback, so with the wider radius, two wires
// spaced a bit close together could both be "near enough" and a terminal
// could snap onto the wrong one. A click still has to land genuinely close.
const TERMINAL_TOOL_SEARCH_TOLERANCE = 10;

// Checks every pin of the given component against every wire on the sheet; if
// a pin lands on (or very near) the middle of a wire's segment, that wire gets
// a new vertex spliced in at the pin's exact position, making the component a
// genuine junction on that wire rather than just visually overlapping it.
// Returns how many splices were made.
// A terminal's identifying number comes from whatever wire is actually
// connected to it, not a manually-typed value — matching real DIN rail
// terminal strips, where the terminal's number is really a property of
// whichever circuit lands on it. Falls back to a manually-set value if no
// wire is connected yet, so it's never blank while wiring is in progress.
export function getTerminalEffectiveId(comp, sheet) {
  if (comp.type !== 'terminal') return comp.value || '';
  const pins = getPinsForType(comp.type);
  if (pins.length === 0) return comp.value || '';

  const rad = ((comp.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pinX = comp.x + (flipSX(comp) * pins[0].relX * cos - flipSY(comp) * pins[0].relY * sin);
  const pinY = comp.y + (flipSX(comp) * pins[0].relX * sin + flipSY(comp) * pins[0].relY * cos);

  for (const wire of sheet?.wires || []) {
    const pts = wire.points;
    if (!pts || pts.length < 2) continue;
    if ((pts[0] === pinX && pts[1] === pinY) || (pts[pts.length - 2] === pinX && pts[pts.length - 1] === pinY)) {
      return wire.wireId || comp.value || '';
    }
  }
  return comp.value || '';
}

// Places a terminal that has been given its block and position (by the terminal
// dialog) and wires it in if it was dropped onto a wire. The caller redraws.
export function placeTerminal(sheet, x, y, assignment) {
  if (!sheet.components) sheet.components = [];
  pushHistory();
  logWireOp('terminal-placed', { at: [x, y], block: assignment.blockName, position: assignment.position });
  const newComp = buildTerminalComponent(sheet, x, y, assignment, Date.now() + Math.floor(Math.random() * 1000));
  sheet.components.push(newComp);
  snapComponentIntoWires(newComp, sheet, TERMINAL_TOOL_SEARCH_TOLERANCE);
  scheduleAutosave();
  return newComp;
}

export function snapComponentIntoWires(comp, sheet, searchTolerance = WIRE_SPLICE_SEARCH_TOLERANCE) {
  if (!sheet?.wires || sheet.wires.length === 0) return 0;

  const pins = getPinsForType(comp.type);
  if (pins.length === 0) return 0;

  const rad = ((comp.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const getPinPos = (p, cx, cy) => ({
    x: cx + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin),
    y: cy + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos)
  });

  // Stage 1: gather every candidate shift within the generous search radius —
  // one per (pin, nearby wire segment) pair.
  const candidates = [];
  pins.forEach(p => {
    const pin = getPinPos(p, comp.x, comp.y);
    sheet.wires.forEach(wire => {
      getWireSegments(wire.points).forEach(seg => {
        const proj = closestPointOnSegment(pin.x, pin.y, seg);
        if (proj.distSq > searchTolerance * searchTolerance) return;
        candidates.push({ dx: proj.x - pin.x, dy: proj.y - pin.y, distSq: proj.distSq });
      });
    });
  });
  if (candidates.length === 0) return 0;

  // Stage 2: score each candidate shift by how many pins it would land within
  // the TIGHT tolerance of some wire — not just whichever single pin happened
  // to be nearest something. This is what keeps a multi-pin component from
  // aligning to one pin's neighbor while dragging the rest onto the wrong wires.
  let bestShift = null, bestScore = -1;
  candidates.forEach(cand => {
    let score = 0;
    pins.forEach(p => {
      const shifted = getPinPos(p, comp.x + cand.dx, comp.y + cand.dy);
      const connects = sheet.wires.some(wire =>
        getWireSegments(wire.points).some(seg =>
          closestPointOnSegment(shifted.x, shifted.y, seg).distSq <= WIRE_SPLICE_EXACT_TOLERANCE * WIRE_SPLICE_EXACT_TOLERANCE
        )
      );
      if (connects) score++;
    });
    if (score > bestScore || (score === bestScore && cand.distSq < bestShift.distSq)) {
      bestScore = score;
      bestShift = cand;
    }
  });

  if (bestShift && (bestShift.dx !== 0 || bestShift.dy !== 0)) {
    comp.x += bestShift.dx;
    comp.y += bestShift.dy;
  }

  // Stage 3: with the component now aligned, splice a real vertex into any
  // wire each pin lands on within the TIGHT tolerance — deliberately strict,
  // so a pin only ever connects to a wire it's landed almost exactly on.
  let spliceCount = 0;

  pins.forEach(p => {
    const pin = getPinPos(p, comp.x, comp.y);

    for (let wireIdx = 0; wireIdx < sheet.wires.length; wireIdx++) {
      const wire = sheet.wires[wireIdx];
      const pts = wire.points;
      if (!pts || pts.length < 4) continue;

      let alreadyVertex = false;
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] === pin.x && pts[i + 1] === pin.y) { alreadyVertex = true; break; }
      }
      if (alreadyVertex) continue;

      for (let i = 0; i < pts.length - 2; i += 2) {
        const seg = { x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] };
        const proj = closestPointOnSegment(pin.x, pin.y, seg);
        if (proj.distSq > WIRE_SPLICE_EXACT_TOLERANCE * WIRE_SPLICE_EXACT_TOLERANCE) continue;

        const atP1 = proj.x === seg.x1 && proj.y === seg.y1;
        const atP2 = proj.x === seg.x2 && proj.y === seg.y2;

        if (atP1) { logWireOp('pin-splice: moved wire vertex onto pin', { comp: comp.label || comp.type, pin: [pin.x, pin.y], wireId: wire.wireId, vertex: [pts[i], pts[i + 1]] }); pts[i] = pin.x; pts[i + 1] = pin.y; }
        else if (atP2) { logWireOp('pin-splice: moved wire vertex onto pin', { comp: comp.label || comp.type, pin: [pin.x, pin.y], wireId: wire.wireId, vertex: [pts[i + 2], pts[i + 3]] }); pts[i + 2] = pin.x; pts[i + 3] = pin.y; }
        else if (comp.type === 'terminal') {
          // A DIN rail terminal is a real physical splice point — split into
          // two separate wire objects here rather than threading one wire
          // through it. Both keep the original wire's ID (and the ID
          // propagation system will keep them in sync going forward, since
          // they still share this exact vertex).
          const beforePts = pts.slice(0, i + 2).concat([pin.x, pin.y]);
          const afterPts = [pin.x, pin.y].concat(pts.slice(i + 2));

          logWireOp('pin-splice: terminal split a wire in two', { comp: comp.label || comp.type, pin: [pin.x, pin.y], wireId: wire.wireId, original: [...pts] });
          const wireA = { ...wire, points: beforePts };
          const wireB = { ...wire, points: afterPts, id: Date.now() + Math.floor(Math.random() * 1000), labelX: undefined, labelY: undefined };

          sheet.wires.splice(wireIdx, 1, wireA, wireB);
          wireIdx++; // the second segment just landed at wireIdx+1; skip past it
        } else {
          logWireOp('pin-splice: inserted vertex mid-wire', { comp: comp.label || comp.type, pin: [pin.x, pin.y], wireId: wire.wireId });
          pts.splice(i + 2, 0, pin.x, pin.y); // insert a fresh vertex mid-segment
        }

        spliceCount++;
        break; // this pin is now handled for this wire; move on to the next wire
      }
    }
  });

  return spliceCount + breakWiresThroughPart(sheet, comp);   // and where it sits across a wire (two or more pins on it), the wire is broken there
}

// Draws a small pictogram of a symbol's own artwork (scaled way down) — used
// in a parent coil's contact mirror list so each reference shows what type of
// contact it actually is, not just where it is. Most contact-type symbols
// (N.O/N.C) span roughly a 60-unit range centered on their own origin, so a
// fixed scale/centering is a reasonable approximation without needing to
// compute each symbol's exact bounding box just for a tiny reference icon.
// A symbol's own extents (from its path and pins), or null if it has none.
function getSymbolExtents(def) {
  const xs = [], ys = [];
  extractPathCoordinates(def.pathData).forEach(c => { xs.push(c.x); ys.push(c.y); });
  (def.pins || []).forEach(p => { xs.push(p.relX); ys.push(p.relY); });
  if (xs.length === 0) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// How tall (on the label) this contact's icon actually draws once it's laid on
// its side: a single N.O/N.C is a thin line, a 3-pole contact is nearly as
// thick as it is long, so rows need different amounts of room. null = no icon.
function getContactIconThickness(symbolType, size) {
  const def = window.customSymbolDefinitions?.[symbolType];
  if (!def?.pathData) return null;
  const ext = getSymbolExtents(def);
  if (!ext) return null; // no geometry to draw (an empty symbol) — better no icon than an invisible gap
  return ext.w * (size / 60); // laid on its side, the symbol's width becomes its height
}

// Draws the icon centred on (centerX, centerY). Returns false if this symbol has no artwork to show.
function addContactMirrorIcon(labelGroup, centerX, centerY, symbolType, size) {
  const def = window.customSymbolDefinitions?.[symbolType];
  if (!def?.pathData) return false;

  const iconScale = size / 60;
  // Centre on the symbol's own middle rather than assuming it's drawn around
  // its origin — rotating 90deg maps a point (cx, cy) to (-cy, cx) about the
  // group origin, so the origin goes at centre + (cy, -cx) times the scale.
  const ext = getSymbolExtents(def) || { cx: 0, cy: 0 };
  const iconGroup = new Konva.Group({
    x: centerX + ext.cy * iconScale, y: centerY - ext.cx * iconScale,
    scale: { x: iconScale, y: iconScale },
    rotation: 90 // most contact symbols are drawn vertically; lay the icon on its side to match the reference layout
  });

  normalizePathData(def.pathData).forEach(seg => {
    iconGroup.add(new Konva.Path({
      data: seg.d, stroke: '#6b7280', strokeWidth: 1 / iconScale,
      dash: getDashArray(seg.dash || 'solid')
    }));
  });

  labelGroup.add(iconGroup);
  return true;
}

// Toolbar-facing wrapper: undo-tracked, user-facing feedback, only touches the
// undo stack and autosave when something actually changed.
export async function cleanUpConnections(renderCallback) {
  const sheet = getActiveSheet();
  if (!sheet) return;

  const fixes = findHealableEndpoints(sheet);
  if (fixes.length === 0) {
    await appAlert('No near-miss connections found — everything on this sheet is either already connected or clearly separate.');
    return;
  }

  pushHistory();
  applyHealFixes(sheet, fixes);
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
  await appAlert(`Snapped ${fixes.length} near-miss connection${fixes.length === 1 ? '' : 's'} together.`);
}

function reconstructWiresFromSegments(segments, breakPoints) {
  const result = [];
  const labelCandidates = []; // per result wire: Map of "x,y" -> { x, y, count } from the segments it absorbed

  while (segments.length > 0) {
    let current = [segments[0].p1.x, segments[0].p1.y, segments[0].p2.x, segments[0].p2.y];
    let chosenId = segments[0].wireId || null;
    let chosenManual = !!segments[0].wireIdManual;
    let chosenUser = !!segments[0].wireIdUser;   // the name was typed by the person (as opposed to carried across the net)
    let chosenObjId = segments[0].id || null;
    let chosenHide = !!segments[0].hideWireId;   // hidden if any piece of it was
    const candidates = new Map();
    const noteLabel = (seg) => {
      if (seg.hideWireId) chosenHide = true;
      if (seg.labelX === undefined || seg.labelY === undefined) return;
      const k = `${seg.labelX},${seg.labelY}`;
      const existing = candidates.get(k);
      if (existing) existing.count++;
      else candidates.set(k, { x: seg.labelX, y: seg.labelY, count: 1 });
    };
    noteLabel(segments[0]);
    segments.splice(0, 1);

    const considerId = (wireId, wireIdManual, wireIdUser) => {
      if (wireIdUser && !chosenUser && wireId) { chosenId = wireId; chosenManual = true; chosenUser = true; }
      else if (wireIdManual && !chosenManual) { chosenId = wireId; chosenManual = true; }
      else if (!chosenId && wireId) { chosenId = wireId; }
    };

    let grow = true;
    while (grow) {
      grow = false;
      const headX = current[0], headY = current[1];
      const tailX = current[current.length - 2], tailY = current[current.length - 1];
      const tailIsBreakPoint = breakPoints?.has(`${tailX},${tailY}`);
      const headIsBreakPoint = breakPoints?.has(`${headX},${headY}`);

      for (let i = 0; i < segments.length; i++) {
        const { p1, p2, wireId, wireIdManual, wireIdUser } = segments[i];

        if (tailIsBreakPoint && (tailX === p1.x && tailY === p1.y || tailX === p2.x && tailY === p2.y)) continue;
        if (headIsBreakPoint && (headX === p1.x && headY === p1.y || headX === p2.x && headY === p2.y)) continue;

        if (tailX === p1.x && tailY === p1.y) {
          current.push(p2.x, p2.y);
          considerId(wireId, wireIdManual, wireIdUser); noteLabel(segments[i]);
          segments.splice(i, 1);
          grow = true;
          break;
        } else if (tailX === p2.x && tailY === p2.y) {
          current.push(p1.x, p1.y);
          considerId(wireId, wireIdManual, wireIdUser); noteLabel(segments[i]);
          segments.splice(i, 1);
          grow = true;
          break;
        } else if (headX === p2.x && headY === p2.y) {
          current.unshift(p1.x, p1.y);
          considerId(wireId, wireIdManual, wireIdUser); noteLabel(segments[i]);
          segments.splice(i, 1);
          grow = true;
          break;
        } else if (headX === p1.x && headY === p1.y) {
          current.unshift(p2.x, p2.y);
          considerId(wireId, wireIdManual, wireIdUser); noteLabel(segments[i]);
          segments.splice(i, 1);
          grow = true;
          break;
        }
      }
    }
    result.push({ points: current, wireId: chosenId, wireIdManual: chosenManual, ...(chosenUser ? { wireIdUser: true } : {}), ...(chosenHide ? { hideWireId: true } : {}), id: chosenObjId || (Date.now() + Math.floor(Math.random() * 100000)) });
    labelCandidates.push(candidates);
  }

  // A dragged label position belongs to exactly one wire: when a wire gets
  // split (a new branch landing mid-wire, a terminal placed on it), the piece
  // that kept the most of the original's segments keeps the label where the
  // person put it, and the other piece falls back to its own default spot —
  // rather than both claiming the same position and stacking two labels there.
  const ownerByLabel = new Map(); // "x,y" -> { wireIdx, count }
  labelCandidates.forEach((cands, wireIdx) => {
    cands.forEach((c, k) => {
      const owner = ownerByLabel.get(k);
      if (!owner || c.count > owner.count) ownerByLabel.set(k, { wireIdx, count: c.count });
    });
  });
  labelCandidates.forEach((cands, wireIdx) => {
    let best = null;
    cands.forEach((c, k) => {
      if (ownerByLabel.get(k).wireIdx !== wireIdx) return;
      if (!best || c.count > best.count) best = c;
    });
    if (best) {
      result[wireIdx].labelX = best.x;
      result[wireIdx].labelY = best.y;
    }
  });

  return result;
}

// Wires that are actually touching (any shared vertex — a mere crossing never
// produces one, since processWireIntersectionsAndMerges/healSheetConnections
// always turn a real touch into an exact shared point) represent the same
// electrical net and should share one visible ID. Union-find over wire indices,
// then each connected group inherits whichever wire's ID appeared earliest —
// i.e. a newly-drawn branch takes on the ID of the existing wire it joined,
// not the other way around.
// Returns, for each wire, the union-find root of the other wires it's actually
// drawn connected to (sharing an endpoint) — its real electrical net. Two
// wires can carry the identical wireId text without being this: a DIN
// terminal splits one wire into two pieces that DO share this (the split
// keeps the same vertex), but two different, unconnected terminals that a
// person has manually given the same number — exactly what Link Terminals is
// for — do NOT. Callers that mean "the same net, drawn as several segments"
// (as opposed to "coincidentally/deliberately the same label") should key on
// this, not on wire.wireId.
// An automatic wire ID is an optional prefix of letters followed by a number ("105", "W105"). Returns { prefix, n } or null
// (a name typed by hand is told apart by wireIdManual, not by its shape).
const AUTO_ID = /^([A-Za-z._\-]{0,4})(\d+)$/;
export function splitAutoId(id) {
  const m = AUTO_ID.exec(String(id ?? ''));
  return m ? { prefix: m[1], n: parseInt(m[2], 10) } : null;
}

// Puts a sheet's automatic wire IDs into the prefix it should have now (W105 for 105, or 105 for W105, or C105 for W105),
// keeping the numbers. Cable cores, cable markers and connector pins that name a renamed wire follow it. Returns how many
// wires changed. IDs below the sheet's own range are left for the numbering to heal, as before.
export function convertSheetAutoIds(sheet, sheetNum) {
  if (!sheet || !sheet.wires) return 0;
  const prefix = wirePrefixOf(sheet);
  const floor = sheetNum * 100;
  const moves = new Map();
  sheet.wires.forEach(w => {
    if (w.wireIdManual || !w.wireId) return;
    const a = splitAutoId(w.wireId);
    if (!a || a.n < floor) return;
    const next = `${prefix}${a.n}`;
    if (next !== w.wireId) moves.set(w.wireId, next);
  });
  if (!moves.size) return 0;
  let changed = 0;
  sheet.wires.forEach(w => { if (!w.wireIdManual && moves.has(w.wireId)) { w.wireId = moves.get(w.wireId); changed++; } });
  (sheet.cableMarkers || []).forEach(m => (m.coreAssignments || []).forEach(ca => {
    if (!moves.has(ca.wireId)) return;
    const next = moves.get(ca.wireId);
    if (m.kind !== 'connector') {
      const cable = (state.cables || []).find(c => String(c.id) === String(m.cableId));
      if (cable && cable.coreWireIds && cable.coreWireIds[ca.coreNumber] === ca.wireId) cable.coreWireIds[ca.coreNumber] = next;
    }
    ca.wireId = next;
  }));
  return changed;
}

// A sheet's number changed (a sheet was added, deleted or moved): everything numbered from it follows. `before` is Map(sheet id -> the
// number the sheet had) taken before the change. On each sheet whose number changed, designators that start with the old sheet number
// (3K1, 3X) take the new one, children follow their parent's designator, and automatic wire IDs move into the new range (305 -> 205),
// with the cable cores that name them. Names typed by hand, and designators without a sheet number, are left alone. Returns how
// many things changed.
export function renumberSheetsFrom(before) {
  if (!before || !before.size) return 0;
  let changed = 0;
  const oldLabel = new Map();
  state.sheets.forEach((sheet, idx) => {
    if (getPageType(sheet) !== 'schematic') return;
    const oldNum = before.get(sheet.id), newNum = getSchematicSheetNumber(idx);
    if (oldNum === null || oldNum === undefined || newNum === null || oldNum === newNum) return;
    (sheet.components || []).forEach(c => {
      const m = /^(\d+)(\D.*)$/.exec(String(c.label ?? ''));
      if (m && Number(m[1]) === oldNum) { oldLabel.set(c.id, c.label); c.label = `${newNum}${m[2]}`; changed++; }
    });
    const delta = (newNum - oldNum) * 100, moves = new Map();
    (sheet.wires || []).forEach(w => {
      if (w.wireIdManual || !w.wireId) return;
      const a = splitAutoId(w.wireId);
      if (a && a.n >= oldNum * 100 && !moves.has(w.wireId)) moves.set(w.wireId, `${a.prefix}${a.n + delta}`);
    });
    if (moves.size) {
      (sheet.wires || []).forEach(w => { if (!w.wireIdManual && moves.has(w.wireId)) { w.wireId = moves.get(w.wireId); changed++; } });
      (sheet.cableMarkers || []).forEach(m => (m.coreAssignments || []).forEach(ca => {
        if (!moves.has(ca.wireId)) return;
        const next = moves.get(ca.wireId);
        if (m.kind !== 'connector') {
          const cable = (state.cables || []).find(cb => String(cb.id) === String(m.cableId));
          if (cable && cable.coreWireIds && cable.coreWireIds[ca.coreNumber] === ca.wireId) cable.coreWireIds[ca.coreNumber] = next;
        }
        ca.wireId = next;
      }));
    }
  });
  if (oldLabel.size) {   // a child shows its parent's designator (and its contact numbers after it)
    const byId = new Map();
    state.sheets.forEach(s => (s.components || []).forEach(c => byId.set(String(c.id), c)));
    state.sheets.forEach(s => (s.components || []).forEach(c => {
      const parent = c.parentId ? byId.get(String(c.parentId)) : null;
      const was = parent ? oldLabel.get(parent.id) : null;
      if (was && String(c.label || '').startsWith(was)) { c.label = parent.label + String(c.label).slice(was.length); changed++; }
    }));
  }
  if (changed && typeof window.refreshCanvas === 'function') window.refreshCanvas();
  return changed;
}
// For a project whose numbers are already out of step with the order of its sheets: works out each sheet's old number from what is on it
// (the most common sheet number at the start of its designators, else of its automatic wire IDs) and brings it into line.
export function renumberSheetsFromContent() {
  const before = new Map();
  state.sheets.forEach(sheet => {
    if (getPageType(sheet) !== 'schematic') return;
    const tally = new Map(), add = (n) => tally.set(n, (tally.get(n) || 0) + 1);
    (sheet.components || []).forEach(c => { const m = /^(\d+)\D/.exec(String(c.label ?? '')); if (m && !c.parentId) add(Number(m[1])); });
    if (!tally.size) (sheet.wires || []).forEach(w => { const a = (w.wireIdManual || !w.wireId) ? null : splitAutoId(w.wireId); if (a && a.n >= 100) add(Math.floor(a.n / 100)); });
    let best = null, top = 0; tally.forEach((n, k) => { if (n > top) { top = n; best = k; } });
    if (best !== null) before.set(sheet.id, best);
  });
  pushHistory();
  const n = renumberSheetsFrom(before);
  if (n) scheduleAutosave();
  return n;
}

// After the project's or a sheet's prefix is changed: every schematic sheet is brought into line and the view redrawn.
window.renumberSheetsFrom = renumberSheetsFrom;
window.renumberSheetsFromContent = renumberSheetsFromContent;
export function applyWirePrefixes() {
  let changed = 0;
  state.sheets.forEach((sheet, idx) => {
    if (getPageType(sheet) !== 'schematic') return;
    changed += convertSheetAutoIds(sheet, getSchematicSheetNumber(idx) ?? (idx + 1));
  });
  if (changed) { if (typeof window.refreshCanvas === 'function') window.refreshCanvas(); scheduleAutosave(); }
  return changed;
}

function propagateWireIds(wires, sheetNum, sheet) {
  const parent = wires.map((_, i) => i);
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  const pointMap = new Map();
  wires.forEach((wire, idx) => {
    const pts = wire.points;
    for (let i = 0; i < pts.length; i += 2) {
      const key = `${pts[i]},${pts[i + 1]}`;
      if (!pointMap.has(key)) pointMap.set(key, []);
      pointMap.get(key).push(idx);
    }
  });
  pointMap.forEach(indices => {
    for (let i = 1; i < indices.length; i++) union(indices[0], indices[i]);
  });
  const netRootOf = wires.map((_, i) => find(i)); // captured before `parent` is mutated further below by the ID-assignment passes, so it stays a pure connectivity answer

  // Two terminals joined with the Link Terminals tool are one electrical point, so the wires on them are one wire as far as the
  // numbering goes: both carry the same ID (the number is not used up again on the far side of the link). This is done after the
  // drawn-net answer above is taken, so labels and the like still go by what is actually drawn together.
  if (sheet && (sheet.terminalLinks || []).length) {
    const terminalById = new Map((sheet.components || []).filter(c => c.type === 'terminal').map(c => [c.id, c]));
    sheet.terminalLinks.forEach(link => {
      const a = terminalById.get(link.a), b = terminalById.get(link.b);
      if (!a || !b) return;
      const onA = pointMap.get(`${a.x},${a.y}`), onB = pointMap.get(`${b.x},${b.y}`);
      if (onA && onB) union(onA[0], onB[0]);
    });
  }

  // A manually-named wire (e.g. "24V", set via the wire edit modal) always wins
  // over an auto-generated one, regardless of array order — so naming a net
  // sticks even after later edits touch other wires in the same cluster.
  // A name the person TYPED on a wire (wireIdUser) outranks one that was only carried onto the wire because it was
  // connected to a named net. Without that difference, wiring R and S together by mistake stamped one name on both nets
  // for good, and deleting the wire that joined them left both still called the same.
  const manualIdByRoot = new Map();
  const typedRoots = new Set();
  wires.forEach((wire, idx) => {
    if (!wire.wireIdManual || !wire.wireId) return;
    const root = find(idx);
    if (wire.wireIdUser) {
      if (!typedRoots.has(root)) { typedRoots.add(root); manualIdByRoot.set(root, wire.wireId); }
    } else if (!manualIdByRoot.has(root)) manualIdByRoot.set(root, wire.wireId);
  });

  // A wire touching a supply symbol's pin gets no wire ID at all — the
  // symbol's own L1/L2/L3/N/PE labels already identify the conductor, so a
  // separate wire label is redundant. These clusters are also skipped when
  // handing out auto IDs below, so they don't eat into the numbering
  // sequence for the sheet's other, unrelated wires. A manual rename still
  // wins over this, same as it would over an auto ID.
  const supplyConnectedRoots = new Set();
  if (sheet) {
    const supplyPinPositions = new Set(); // "x,y" of any supply symbol's pin
    (sheet.components || []).forEach(comp => {
      if (!getPinLabelsForType(comp.type)) return; // not a supply type
      const pins = getPinsForType(comp.type);
      const rad = ((comp.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      pins.forEach(p => {
        const x = comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin);
        const y = comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos);
        supplyPinPositions.add(`${x},${y}`);
      });
    });

    if (supplyPinPositions.size > 0) {
      wires.forEach((wire, idx) => {
        const root = find(idx);
        if (supplyConnectedRoots.has(root)) return;
        const pts = wire.points;
        for (let i = 0; i < pts.length; i += 2) {
          if (supplyPinPositions.has(`${pts[i]},${pts[i + 1]}`)) { supplyConnectedRoots.add(root); break; }
        }
      });
    }
  }

  // A wire touching a protective-earth terminal is, by definition, a PE
  // conductor, so it is named "PE" automatically (still beaten by a manual
  // name). This wins over the "no label" rule for supply-connected nets too:
  // a PE terminal on the net means the wire needs a name for its marker.
  const peRoots = new Set();
  if (sheet) {
    const pePositions = new Set();
    (sheet.components || []).forEach(comp => {
      if (comp.type === 'terminal' && comp.terminalKind === 'pe') pePositions.add(`${comp.x},${comp.y}`);
    });
    if (pePositions.size > 0) {
      wires.forEach((wire, idx) => {
        const pts = wire.points;
        for (let i = 0; i < pts.length; i += 2) {
          if (pePositions.has(`${pts[i]},${pts[i + 1]}`)) { peRoots.add(find(idx)); break; }
        }
      });
    }
  }

  // Every cluster with no manual name, and not supply-connected, gets ONE
  // fresh auto ID, shared by every wire in that cluster, rather than each
  // regenerating separately (which would undo wires sharing an ID on
  // connection) or keeping whatever internal value they happened to be
  // created or merged with.
  //
  // The next ID continues from the HIGHEST numeric wire ID actually in use
  // on this sheet — manual or auto, e.g. "100" — not from a wire's position
  // in the array. A splice or merge can leave many more wire OBJECTS than
  // there are visible nets, so the array index a net's first wire happens to
  // sit at drifts further and further from how many nets are actually on the
  // sheet; a person who has already named a net "100" reasonably expects the
  // next one to be "101", regardless of how many wire objects came before it
  // internally. sheetNum still sets the starting point for an otherwise-empty
  // sheet (sheet 1 starts at 100, sheet 2 at 200, ...), and a manually-typed
  // ID past the sheet's own natural range (e.g. "150" on sheet 1) is honoured
  // and continued from too, rather than snapped back to the sheet's range.
  let highestNumericId = sheetNum * 100 - 1;
  wires.forEach(wire => {
    const a = wire.wireId ? splitAutoId(wire.wireId) : null;
    if (a && a.n > highestNumericId) highestNumericId = a.n;
  });
  const autoPrefix = wirePrefixOf(sheet);

  // A net that was already auto-numbered keeps that number across later
  // renders — otherwise adding one new wire anywhere on the sheet would
  // silently renumber every OTHER unrelated net too, since this whole
  // function reruns from scratch on every render. Only a root with no
  // existing numeric ID on any of its wires — a genuinely new net — gets a
  // freshly minted one. (If two previously-separate numbered nets get
  // joined by a new wire, the earlier of their two numbers wins; a rare
  // enough case that a clear, deterministic rule is enough.)
  // "Already numbered" only counts if that number is at least this sheet's
  // own starting point (sheet 1: 100+, sheet 2: 200+, ...) — the shape a
  // non-manual ID should always have if this algorithm assigned it (no upper
  // bound: a sheet with more than 100 auto-numbered nets naturally overflows
  // past e.g. 199, and that overflowed number is still perfectly valid, kept
  // as-is by the stability rule same as any other). A non-manual ID BELOW the
  // sheet's own floor (a bare "3", "4", "5" — the exact symptom reported:
  // numbering "gone", missing its page-number digit) can only be leftover
  // from an older, different numbering scheme; treated as unestablished, it
  // gets healed into the correct format below instead of being kept forever.
  const sheetRangeStart = sheetNum * 100;
  const existingIdByRoot = new Map();
  const lowestIdN = new Map();   // root -> the lowest auto number any of its wires carries
  wires.forEach((wire, idx) => {
    const a = (wire.wireIdManual || !wire.wireId) ? null : splitAutoId(wire.wireId);
    if (!a) return;
    if (a.n < sheetRangeStart) return; // below this sheet's own floor — stale, not a keeper
    const root = find(idx);
    // The number stays, the prefix is whatever the sheet uses now. When a net holds several numbers (a new wire joined onto an
    // existing net), the LOWEST wins: the established net's number is the older, and a wire drawn a moment ago was handed the next
    // number up. Taking whichever wire came first in the list renumbered the whole net to the new wire's number (702 -> 703).
    const known = lowestIdN.get(root);
    if (known === undefined || a.n < known) { lowestIdN.set(root, a.n); existingIdByRoot.set(root, `${autoPrefix}${a.n}`); }
  });

  // One number, one net. Moving a wire so it touches another net joins them under one number; moving it away again splits
  // them, and BOTH halves would still be carrying that number, so two separate nets ended up with the same ID. When several
  // nets claim a number, the biggest keeps it (the one that was split off is the smaller, usually the wire that was moved);
  // the rest drop their claim and are given a fresh number below. Ties go to whichever comes first.
  const rootSize = new Map();
  wires.forEach((_, idx) => { const r = find(idx); rootSize.set(r, (rootSize.get(r) || 0) + 1); });
  const ownerOfId = new Map();   // id -> root that keeps it
  existingIdByRoot.forEach((id, root) => {
    const owner = ownerOfId.get(id);
    if (owner === undefined || rootSize.get(root) > rootSize.get(owner)) ownerOfId.set(id, root);
  });
  [...existingIdByRoot.keys()].forEach(root => {
    if (ownerOfId.get(existingIdByRoot.get(root)) !== root) existingIdByRoot.delete(root);
  });

  const autoIdByRoot = new Map();
  wires.forEach((wire, idx) => {
    const root = find(idx);
    if (manualIdByRoot.has(root) || peRoots.has(root) || supplyConnectedRoots.has(root) || autoIdByRoot.has(root)) return;
    if (existingIdByRoot.has(root)) {
      autoIdByRoot.set(root, existingIdByRoot.get(root));
    } else {
      highestNumericId += 1;
      autoIdByRoot.set(root, `${autoPrefix}${highestNumericId}`);
    }
  });

  wires.forEach((wire, idx) => {
    const root = find(idx);
    if (manualIdByRoot.has(root)) {
      if (!(wire.wireIdUser && wire.wireId)) wire.wireId = manualIdByRoot.get(root);   // a wire the person named keeps its own name, even if another name was typed elsewhere on its net
      wire.wireIdManual = true; // the whole net is considered named, not just the one wire
    } else if (peRoots.has(root)) {
      wire.wireId = 'PE';
      wire.wireIdManual = false;
    } else if (supplyConnectedRoots.has(root)) {
      wire.wireId = ''; // no label — the supply symbol's own conductor labels already identify it
      wire.wireIdManual = false;
    } else {
      wire.wireId = autoIdByRoot.get(root);
      wire.wireIdManual = false;
    }
  });

  return netRootOf;
}

// Finds every wire endpoint, across the WHOLE document, that's genuinely
// bare — not landing on a component pin (terminals included) and not
// touching another wire — grouped by wireId. Works for both manually-named
// wires (e.g. "24V", set via the wire edit modal) and auto-generated ones:
// auto IDs already carry the sheet number as their leading digit(s) (e.g.
// "100" on sheet 1, "200" on sheet 2), so a genuine cross-sheet string
// collision essentially can't happen by coincidence. A terminal counts as a
// real connection here, same as any other component's pin — it's the far,
// undecorated end of a wire that represents "this continues elsewhere".
export function findOpenWireEndpoints() {
  const byWireId = new Map();

  state.sheets.forEach((sheet, sheetIdx) => {
    const wires = sheet.wires || [];
    if (wires.length === 0) return;
    const pinPositions = getAllPinPositions(sheet);

    wires.forEach((wire, wireIdx) => {
      if (!wire.wireId) return;
      const pts = wire.points;
      if (!pts || pts.length < 2) return;

      [[0, 1], [pts.length - 2, pts.length - 1]].forEach(([xi, yi]) => {
        const x = pts[xi], y = pts[yi];

        const touchesPin = pinPositions.some(p => p.x === x && p.y === y);
        if (touchesPin) return;

        const touchesOtherWire = wires.some((other, oi) => {
          if (oi === wireIdx) return false;
          const opts = other.points;
          for (let i = 0; i < opts.length; i += 2) {
            if (opts[i] === x && opts[i + 1] === y) return true;
          }
          return false;
        });
        if (touchesOtherWire) return;

        if (!byWireId.has(wire.wireId)) byWireId.set(wire.wireId, []);
        byWireId.get(wire.wireId).push({ sheetIdx, x, y, wire });
      });
    });
  });

  return byWireId;
}

// Text sizes for the wire IDs and cable markings drawn on the sheet (both were 10).
const WIRE_LABEL_FONT_SIZE = 7;  // a wire's ID label
const CABLE_TEXT_FONT_SIZE = 6;  // a cable marker's descriptor and the core numbers beside each wire
const CABLE_LABEL_GAP = 10;      // clear space between a cable marker's descriptor and the start of its trunk
const CABLE_CORE_NUMBER_GAP = 4; // clear space between the trunk line and a core number (was 12)

// Every wire drawn connected to `start` (sharing an end point, directly or through other wires) — the pure drawn net, no
// naming involved.
function drawnNetOf(wires, start) {
  const at = new Map();
  wires.forEach(w => {
    const pts = w.points || [];
    for (let i = 0; i < pts.length; i += 2) {
      const k = `${pts[i]},${pts[i + 1]}`;
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(w);
    }
  });
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const w = queue.pop();
    const pts = w.points || [];
    for (let i = 0; i < pts.length; i += 2) {
      (at.get(`${pts[i]},${pts[i + 1]}`) || []).forEach(o => { if (!seen.has(o)) { seen.add(o); queue.push(o); } });
    }
  }
  return wires.filter(w => seen.has(w));
}

// Where a net that continues on another sheet ends up, if that is a PLC input or output: the
// module, address and function ("PLC1 I0.3 · Hydraulic"). A net can be several wires meeting at
// junctions, so every wire on that sheet with the same ID is looked at. Shown with the sheet
// reference at the open end, so you can see which PLC channel a wire goes to without turning
// to the PLC sheet.
export function plcDataForOpenEnd(match) { return plcEntriesForOpenEnd(match).join(', '); }

// The same, as a list with one entry per PLC connection.
export function plcEntriesForOpenEnd(match) {
  if (state.showWirePlcData === false || !match.wire || !match.wire.wireId) return [];
  const sheet = state.sheets[match.sheetIdx];
  if (!sheet) return [];
  const lines = [];
  // Only the wires drawn connected to this open end. Matching on the ID alone also pulled in any other net on the sheet that
  // happens to carry the same name — e.g. the 24V1 that runs to a relay's 47 and 13 and finishes at a terminal — and listed
  // those pins against a wire they are not on.
  const wiresOnNet = drawnNetOf(sheet.wires || [], match.wire);
  wiresOnNet.filter(w => w.wireId === match.wire.wireId).forEach(w => {
    wirePlcConnections(w, sheet.components, window.customSymbolDefinitions).forEach(c => {
      const line = describePlcConnection(c);
      if (!lines.includes(line)) lines.push(line);
    });
  });
  return lines;
}

// Packs entries into lines of about `maxChars` characters, so a long list of destinations wraps instead of running
// off along the wire. An entry is never split, and each line but the last ends in a comma.
export function wrapEntries(entries, maxChars = 24) {
  const lines = [];
  let cur = '';
  entries.forEach(e => {
    if (cur && (cur + ', ' + e).length > maxChars) { lines.push(cur + ','); cur = e; }
    else cur = cur ? cur + ', ' + e : e;
  });
  if (cur) lines.push(cur);
  return lines;
}

export function renderWires() {
  const sheet = getActiveSheet();
  if (!sheet.wires) sheet.wires = [];
  auditWires(sheet); // first thing, so a bad wire is caught even if it would make the rest of this render throw

  // Always derive 1-based current sheet number dynamically
  const sheetNum = getSchematicSheetNumber(state.activeSheetIndex) ?? ((state.activeSheetIndex ?? 0) + 1);

  applySwapMemory(sheet);   // a part swapped for another keeps the old part's wire IDs
  const netRootOf = propagateWireIds(sheet.wires, sheetNum, sheet); // assigns every wire's display ID — manual names, inherited supply pin labels, and one shared auto ID per connected cluster

  wireLayer.destroyChildren();
  wireLabelLayer.destroyChildren();

  // Which wires should actually show a label: the same net (wireId) can be
  // made of several wire objects meeting at a junction, and each rendering
  // its own label nearby just clutters the drawing with repeated text —
  // labels far apart on the same net (spanning a large area) still all show,
  // since those genuinely help track the net across the sheet.
  // Grouped by the wire's REAL, drawn-connected net (netRootOf), not by
  // matching label text: two different, unconnected nets that happen to
  // carry the same wireId — most often two Link-Terminals'd terminals, each
  // manually numbered the same on purpose — declutter independently, so
  // neither one being nearby ever hides the other's label.
  const LABEL_CLUSTER_THRESHOLD = 120;
  const shouldShowLabel = new Array(sheet.wires.length).fill(true);
  {
    const byNet = new Map();
    sheet.wires.forEach((wire, idx) => {
      if (!wire.points || wire.points.length < 4 || !wire.wireId) return;
      const root = netRootOf[idx];
      if (!byNet.has(root)) byNet.set(root, []);
      byNet.get(root).push(idx);
    });

    byNet.forEach(indices => {
      if (indices.length < 2) return; // only one wire object for this net — nothing to declutter
      const claimed = [];
      // Manually-positioned labels always show, and claim their spot first —
      // an auto-placed label shouldn't get to suppress one the person moved on purpose.
      indices.forEach(idx => {
        const wire = sheet.wires[idx];
        if (wire.labelX === undefined) return;
        claimed.push({ x: wire.labelX, y: wire.labelY });
      });
      indices.forEach(idx => {
        const wire = sheet.wires[idx];
        if (wire.labelX !== undefined) return; // already handled above
        const mid = getWireMidpoint(wire.points);
        const isNearClaimed = claimed.some(c => Math.hypot(c.x - mid.x, c.y - mid.y) < LABEL_CLUSTER_THRESHOLD);
        if (isNearClaimed) {
          shouldShowLabel[idx] = false;
        } else {
          claimed.push(mid);
        }
      });
    });
  }

  // No dot — and, for the same reason, no notch either — where a wire meets a
  // component's pin: the pin already marks that connection, and either one
  // would just clutter or visually cut through the symbol there.
  const componentPins = getAllPinPositions(sheet);

  // Every junction a hop CAN be drawn at, each given the look it actually has:
  // its own override if it has one (set by clicking it), otherwise the automatic
  // setting from the ribbon. A look of "dot" just leaves it out of the notch map,
  // so it gets its dot below, exactly as before.
  const notchJunctions = new Map();
  const splitJunctions = new Map(); // the ones with a look of their own: their wires are drawn in pieces (see splitWirePointsAtJunctions)
  clickableJunctionTargets = [];
  const junctionOverrides = sheet.junctionOverrides || {};
  computeNotchJunctions(sheet.wires).forEach((info, k) => {
    const [x, y] = k.split(',').map(Number);
    if (componentPins.some(p => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5)) return;
    const look = currentJunctionAppearance(info, junctionOverrides[k], state.junctionStyle, state.junctionHopDirection);
    if (look !== 'dot') {
      notchJunctions.set(k, { ...info, ...junctionLookGeometry(info, look) });
      const own = overrideToLook(info, junctionOverrides[k]);
      if (own && own !== 'dot') splitJunctions.set(k, true);
    }
    if (isClickableJunction(info)) clickableJunctionTargets.push({ key: k, x, y });
  });

  sheet.wires.forEach((wire, index) => {
    const isSelected = state.selectedWireIndex === index || state.rubberBandWireIndices.includes(index);

    // Render wire path line — a wire currently assigned to a cable core gets
    // a distinct dash-dash-line pattern; clearing that assignment (see
    // 7_cables.js) reverts it to solid automatically, since this is derived
    // fresh from state.cables on every render rather than stored on the wire.
    // Only the RENDERED points get the notch dip spliced in where this wire
    // meets a notched junction — wire.points itself (hit-testing, label
    // midpoint, wire-id logic, everything else) is untouched.
    // Normally one shape per wire. A wire passing through a junction that has a
    // look of its own is drawn as separate pieces ending at that junction, each
    // behaving exactly like the wire (same click, delete and edit handling).
    splitWirePointsAtJunctions(wire.points, splitJunctions).forEach((piece) => {
      const wireShape = new Konva.Line({
        name: 'schematicWire', ghostKey: `w:${index}`,
        points: applyNotchToWirePoints(piece, notchJunctions, state.junctionHopDirection),
        stroke: isSelected ? '#2563eb' : '#0f172a',
        strokeWidth: isSelected ? 2 : 1,
        lineCap: 'square',
        lineJoin: 'miter',
        hitStrokeWidth: 20,
        dash: isWireObjectAssignedToCable(sheet, wire) ? [8, 4, 8, 4, 20, 4] : undefined
      });

      // Where the pointer went DOWN on a wire — a click only counts as one on a
      // junction if it began there too, not merely ended there after a drag.
      wireShape.on('mousedown touchstart', () => { lastWirePress = rawWorldPointer(); });

      wireShape.on('click tap', (e) => {
        e.cancelBubble = true;
        if (state.currentTool === 'delete') {
          pushHistory();
          logWireOp('wire-deleted (delete tool)', { wireId: wire.wireId, points: [...wire.points] });
          sheet.wires.splice(index, 1);
          if (state.selectedWireIndex === index) state.selectedWireIndex = null;
          renderWires();
        } else if (state.currentTool !== 'wire' && state.currentTool !== 'multiwire') {
          // In the Select tool, a click right on a hop-able junction sets just that
          // junction's look rather than selecting the wire passing through it —
          // other tools are untouched, so e.g. Delete still removes the wire.
          if (state.currentTool === 'select' && !isMainCanvasSpaceHeld()) {
            const here = rawWorldPointer();
            const hit = here ? junctionNear(clickableJunctionTargets, here) : null;
            const beganThere = hit && lastWirePress && junctionNear(clickableJunctionTargets, lastWirePress)?.key === hit.key;
            lastWirePress = null;
            if (hit && beganThere && cycleJunctionOverride(sheet, hit.key, e.evt && e.evt.shiftKey ? -1 : 1)) { renderWires(); return; }
          }
          state.selectedWireIndex = index;
          state.selectedComponentId = null;
          state.selectedShapeId = null;
          state.selectedImageId = null;
          state.selectedTerminalLinkId = null;
          renderWires();
          if (typeof contentLayer !== 'undefined') contentLayer.draw();
        }
      });

      wireShape.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        if (typeof window.openWireEditModal === 'function') window.openWireEditModal(wire);
      });

      wireShape.on('contextmenu', (e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        pushHistory();
        logWireOp('wire-deleted (right-click)', { wireId: wire.wireId, points: [...wire.points] });
        sheet.wires.splice(index, 1);
        if (state.selectedWireIndex === index) state.selectedWireIndex = null;
        renderWires();
      });

      wireLayer.add(wireShape);
    });

    // --- DRAGGABLE WIRE LABEL WITH WHITE FILL ---
    // wire.hideWireId hides just this wire's label (the ID itself is kept, and still used by terminals and tables)
    if (state.showWireIds !== false && !wire.hideWireId && wire.points && wire.points.length >= 4 && wire.wireId && shouldShowLabel[index]) {
      const mid = getWireMidpoint(wire.points);
      const defaultMidX = mid.x;
      const defaultMidY = mid.y;

      // Text Element
      const wireText = new Konva.Text({
        text: wire.wireId,
        fontSize: WIRE_LABEL_FONT_SIZE,
        fontStyle: 'bold',
        fontFamily: 'sans-serif',
        fill: isSelected ? '#2563eb' : '#0f172a',
        padding: 2
      });

      const textWidth = wireText.width();
      const textHeight = wireText.height();
      const padding = 2;

      // Use stored label coordinates if previously dragged. Otherwise centre it
      // on the wire's midpoint, sitting a touch above it, so its white mask
      // still covers the wire — worked out from the label's own size rather
      // than a fixed offset tuned for one font size, which stopped covering
      // the wire once the text got smaller.
      const initialX = wire.labelX !== undefined ? wire.labelX : defaultMidX - textWidth / 2;
      const initialY = wire.labelY !== undefined ? wire.labelY : defaultMidY - 5 - textHeight / 2;

      // Create a draggable group for the label + white background mask
      const labelGroup = new Konva.Group({
        name: 'wireLabel', // the Wire tool ignores gestures on this — see isDragOnlyTarget
        x: initialX,
        y: initialY,
        draggable: true
      });

      // Background Rectangle (Solid White Mask)

      const bgRect = new Konva.Rect({
        x: -padding,
        y: -padding,
        width: textWidth + padding * 2,
        height: textHeight + padding * 2,
        fill: '#ffffff',
        stroke: isSelected ? '#2563eb' : null,
        strokeWidth: 1,
        cornerRadius: 2
      });

      labelGroup.add(bgRect);
      labelGroup.add(wireText);

      // Save custom dragged coordinates back to wire state when drag ends
      labelGroup.on('dragend', (e) => {
        const nx = snapToGrid(e.target.x(), GRID_SIZE / 2);
        const ny = snapToGrid(e.target.y(), GRID_SIZE / 2);
        e.target.position({ x: nx, y: ny });
        wire.labelX = nx;
        wire.labelY = ny;
        logWireOp('wire-label-dragged', { wireId: wire.wireId, to: [nx, ny] });
        scheduleAutosave();
      });

      // Double-click event on label group to edit wire ID
      labelGroup.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        if (typeof window.openWireEditModal === 'function') window.openWireEditModal(wire);
      });

      // Its own layer, above the components — not the wire layer, which sits
      // BELOW them, so any component (or a wire drawn later) covering the
      // label left it unreachable. Up here it is always the first thing under
      // the pointer, so it can always be grabbed and moved.
      wireLabelLayer.add(labelGroup);
    }
  });

  // Junction dots mark real connections. Plain crossings (two wires that merely
  // overlap without touching) are left unmarked, per preference — no hop/bridge.
  const junctionPoints = computeJunctionPoints(sheet.wires);

  junctionPoints.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    if (componentPins.some(p => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5)) return;
    if (notchJunctions.has(k)) return; // the wires themselves show this connection — see applyNotchToWirePoints above
    wireLayer.add(new Konva.Circle({ x, y, radius: 3.5, fill: '#0f172a', listening: false }));
  });

  // Cross-reference open ends of a net to any other open end sharing that
  // wire ID, elsewhere on this sheet or any other — whether the ID was
  // manually named or auto-generated (see findOpenWireEndpoints).
  const openEndpointsByWireId = findOpenWireEndpoints();
  const currentSheetIdx = state.activeSheetIndex ?? 0;

  sheet.wires.forEach(wire => {
    if (!wire.wireId) return;
    const matches = openEndpointsByWireId.get(wire.wireId);
    if (!matches || matches.length < 2) return;

    const pts = wire.points;
    if (!pts || pts.length < 2) return;

    [[0, 1], [pts.length - 2, pts.length - 1]].forEach(([xi, yi]) => {
      const x = pts[xi], y = pts[yi];
      const isOpenHere = matches.some(m => m.sheetIdx === currentSheetIdx && m.x === x && m.y === y);
      if (!isOpenHere) return;

      // Another open end with this ID: on a different sheet, or on this one when it is a separate drawn net (a wire that goes
      // off to a PLC pin elsewhere on the sheet, say). An open end on this wire's own drawn net is visibly connected already.
      const ownNet = drawnNetOf(sheet.wires, wire);
      const others = matches.filter(m => m.sheetIdx !== currentSheetIdx || !ownNet.includes(m.wire));
      if (others.length === 0) return;

      // A wire that runs on through several sheets is a chain: each open end points to ONE neighbour, not to every end carrying the ID.
      // An end that is the only one of its net on this sheet points back to the nearest earlier open end (the first in the chain has
      // nothing earlier, so it points on to the next). A wire that passes through the sheet has two ends here: the left (or upper) end
      // continues from the earlier sheet and the right (or lower) end carries on to the later one.
      const orderOf = m => m.sheetIdx * 1e9 + m.y * 1e4 + m.x;   // sheet first, then position down the sheet
      const here = orderOf({ sheetIdx: currentSheetIdx, x, y });
      const sorted = others.slice().sort((a, b) => orderOf(a) - orderOf(b));
      const earlier = sorted.filter(m => m.sheetIdx < currentSheetIdx || (m.sheetIdx === currentSheetIdx && orderOf(m) < here));
      const later = sorted.filter(m => !earlier.includes(m));
      const ownEnds = matches.filter(m => m.sheetIdx === currentSheetIdx && ownNet.includes(m.wire))
        .sort((a, b) => (a.x - b.x) || (a.y - b.y));
      const myRank = ownEnds.findIndex(m => m.x === x && m.y === y);
      let wantNext = false;                       // which side this end points to
      if (ownEnds.length >= 2) wantNext = myRank > 0;
      else wantNext = earlier.length === 0;
      let picked;
      if (wantNext) picked = later.length ? [later[0]] : [earlier[earlier.length - 1]];
      else picked = earlier.length ? [earlier[earlier.length - 1]] : [later[0]];

      const refText = picked
        .map(m => getRefText(m.x, m.y, m.sheetIdx))
        .join(', ');
      // Where that continues to a PLC input or output, which one: shown under the reference, smaller and in italics
      const plcEntries = [];
      picked.forEach(m => plcEntriesForOpenEnd(m).forEach(e => { if (!plcEntries.includes(e)) plcEntries.push(e); }));
      const plcText = wrapEntries(plcEntries).join('\n');   // a long list wraps onto several lines

      // The reference continues the wire's own line: centred on it, starting a
      // small gap beyond the open end and running away from the wire's body,
      // in the wire's own direction — text rotated to run along a vertical
      // wire, horizontal text along a horizontal one. (Before, it sat beside
      // the wire, and on a horizontal wire's left end it was even drawn over
      // the wire itself.)
      const isStart = xi === 0;
      const adjX = isStart ? pts[2] : pts[pts.length - 4];
      const adjY = isStart ? pts[3] : pts[pts.length - 3];
      const isVertical = adjX === x && adjY !== y;
      const bodyIsToTheRight = adjX > x; // for a horizontal end: the wire's body lies to its right, so the label goes left

      const fontSize = 9;
      const REF_GAP = 4; // clear space between the open end and the label
      const arrow = (!isVertical && bodyIsToTheRight) ? '←' : '→'; // always points outward, away from the wire
      const textConfig = {
        text: `${arrow} ${refText}`, fontSize, fontStyle: 'bold', fill: '#6b7280', listening: false
      };

      // A Konva.Text is positioned by its top-left corner, and rotation turns
      // it about that corner — so each case needs the corner placed such that
      // the rotated box ends up centred on the wire's line (half the text
      // height either side).
      const PLC_FONT_SIZE = 7;
      const plcConfig = plcText ? {
        text: plcText, fontSize: PLC_FONT_SIZE, fontStyle: 'italic', fill: '#6b7280', listening: false, lineHeight: 1.15
      } : null;
      const PLC_LINE_GAP = 1;   // clear space between the reference and the line under it

      if (isVertical) {
        const extendsUp = y < adjY; // this endpoint sits above the rest of the wire
        if (extendsUp) {           // rotated -90: box hangs up and to the right of the corner
          textConfig.rotation = -90;
          textConfig.x = x - fontSize / 2;
          textConfig.y = y - REF_GAP;
          // under the reference = to its right
          if (plcConfig) wireLayer.add(new Konva.Text({ ...plcConfig, rotation: -90, x: textConfig.x + fontSize + PLC_LINE_GAP, y: textConfig.y }));
        } else {                   // rotated +90: box runs down and to the left of the corner
          textConfig.rotation = 90;
          textConfig.x = x + fontSize / 2;
          textConfig.y = y + REF_GAP;
          // under the reference = to its left
          if (plcConfig) wireLayer.add(new Konva.Text({ ...plcConfig, rotation: 90, x: textConfig.x - fontSize - PLC_LINE_GAP, y: textConfig.y }));
        }
        wireLayer.add(new Konva.Text(textConfig));
      } else {
        textConfig.y = y - fontSize / 2;
        const textNode = new Konva.Text({ ...textConfig, x: x + REF_GAP });
        if (bodyIsToTheRight) textNode.x(x - REF_GAP - textNode.width()); // running left: its right edge, not its left, sits the gap from the end
        wireLayer.add(textNode);
        if (plcConfig) {
          const plcNode = new Konva.Text({ ...plcConfig, align: bodyIsToTheRight ? 'right' : 'left', x: x + REF_GAP, y: textConfig.y + fontSize + PLC_LINE_GAP });
          if (bodyIsToTheRight) plcNode.x(x - REF_GAP - plcNode.width());   // lined up on the same side as the reference
          wireLayer.add(plcNode);
        }
      }
    });
  });

  wireLayer.batchDraw();
  wireLabelLayer.batchDraw();
  scheduleAutosave();
}

export function renderComponents(openEditModalCallback) {
  contentLayer.destroyChildren(); 
  const sheet = getActiveSheet(); 
  if (!sheet.components) sheet.components = []; 
  if (getPageType(sheet) === 'panel' && typeof window.renderPanelSheet === 'function') { window.renderPanelSheet(sheet, openEditModalCallback); return; }   // a panel sheet draws itself (22_panel_layout.js)

  renderWires();
  refreshTerminalWireIds(sheet); // each terminal carries the wire ID(s) on it, saved with the project — the wires are numbered by now
  renderSheetImages(openEditModalCallback);
  renderSheetShapes(openEditModalCallback);

  sheet.components.forEach((comp) => { 
    const isSelected = comp.id === state.selectedComponentId || state.rubberBandComponentIds.includes(comp.id); 
    const compRotation = comp.rotation || 0; 

    const group = new Konva.Group({ 
      ghostKey: `c:${comp.id}`,
      x: comp.x,
      y: comp.y,
      rotation: compRotation,
      scaleX: flipSX(comp), scaleY: flipSY(comp),   // a mirrored symbol (see flipSelectedComponent)
      draggable: state.currentTool !== 'link' && state.currentTool !== 'multiwire' // the Link and Multi-wire tools picks terminals with a click — a press-and-move must not drag them
    }); 

    const handleEdit = (e) => { 
      if (e) e.cancelBubble = true; 
      if (typeof openEditModalCallback === 'function') openEditModalCallback(comp);
    };

    group.on('click tap', (e) => { 
      e.cancelBubble = true; 
      if (state.currentTool === 'wire' || state.currentTool === 'link' || state.currentTool === 'multiwire') return;

      // Two quick clicks on the same component open its details. Konva's own double-click is lost
      // here: the first click redraws the sheet, so the second lands on a new shape.
      const now = Date.now();
      if (lastCompClick.id === comp.id && now - lastCompClick.time < 400) { lastCompClick = { id: null, time: 0 }; handleEdit(e); return; }
      lastCompClick = { id: comp.id, time: now };

      state.selectedComponentId = comp.id; 
      state.selectedWireIndex = null;
      state.selectedShapeId = null;
      state.selectedImageId = null;
      state.selectedTerminalLinkId = null;
      renderComponents(openEditModalCallback); 
    });

    group.on('dblclick dbltap', handleEdit);

    // Right-click: select the part and offer its menu (swap, edit details, delete) — see 40_component_menu.js.
    group.on('contextmenu', (e) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      if (state.currentTool === 'wire' || state.currentTool === 'link' || state.currentTool === 'multiwire') return;
      if (state.selectedComponentId !== comp.id) {
        state.selectedComponentId = comp.id; state.selectedWireIndex = null; state.selectedShapeId = null; state.selectedImageId = null; state.selectedTerminalLinkId = null;
        renderComponents(openEditModalCallback);
      }
      if (typeof window.showComponentMenu === 'function') window.showComponentMenu(comp.id, e.evt.clientX, e.evt.clientY);
    });

    group.on('dragstart', () => { pushHistory(); dragAttachments = null; beginGroupGhost('c', comp.id, comp.x, comp.y); });

    const { pathData, customTexts, pins, pinOutward } = resolveComponentArtwork(comp);

    // The click area is the same box the blue selection outline draws — see
    // getComponentHitBounds for why that matters.
    const hitBounds = getComponentHitBounds(comp, pathData, pins, customTexts);
    const hitBox = new Konva.Rect({ 
      x: hitBounds.centerX - hitBounds.width / 2, y: hitBounds.centerY - hitBounds.height / 2,
      width: hitBounds.width, height: hitBounds.height, fill: 'transparent'
    }); 
    hitBox.on('dblclick dbltap', handleEdit); 
    group.add(hitBox); 

    if (comp.type === 'terminal' && (isPETerminal(comp) || isAssignedTerminal(comp))) {
      // The terminal symbol: a circle with the marker inside it. The circle is
      // filled white, so the wire stops at its edge rather than running through it.
      group.add(new Konva.Circle({ x: 0, y: 0, radius: TERMINAL_RING_RADIUS, fill: '#ffffff', stroke: isSelected ? '#2563eb' : '#0f172a', strokeWidth: isSelected ? 1.5 : 1 }));
      if (isPETerminal(comp)) {
        // A protective-earth terminal: the green-and-yellow of PE, split on the
        // diagonal, in place of the black dot (the label also says PE, for a
        // black-and-white print).
        const PE_R = 2.8;
        group.add(new Konva.Wedge({ x: 0, y: 0, radius: PE_R, angle: 180, rotation: 135, fill: '#facc15' }));
        group.add(new Konva.Wedge({ x: 0, y: 0, radius: PE_R, angle: 180, rotation: -45, fill: '#16a34a' }));
      } else {
        // A solid dot. (The fill colour setting only counts if it has been changed
        // from white — its default, which would make the dot disappear.)
        const dotColor = comp.fillColor && String(comp.fillColor).toLowerCase() !== '#ffffff' ? comp.fillColor : '#0f172a';
        group.add(new Konva.Circle({ x: 0, y: 0, radius: TERMINAL_DOT_RADIUS, fill: isSelected ? '#2563eb' : dotColor }));
      }
    } else if (comp.type === 'terminal') {
      // Small circle marker. Selection still always shows as blue (clear,
      // consistent feedback); otherwise uses the terminal's own custom fill
      // color if one has been set, or plain white/hollow if not.
      group.add(new Konva.Circle({
        x: 0, y: 0, radius: 3,
        fill: isSelected ? '#2563eb' : (comp.fillColor || '#ffffff'),
        stroke: '#0f172a', strokeWidth: 1
      }));
    }

    if (pathData) { 
      normalizePathData(pathData).forEach(seg => {
        const pathShape = new Konva.Path({ 
          data: seg.d, 
          stroke: isSelected ? '#2563eb' : '#0f172a', 
          strokeWidth: isSelected ? 2 : 1,
          dash: getDashArray(seg.dash || 'solid')
        });
        pathShape.on('dblclick dbltap', handleEdit); 
        group.add(pathShape);
      });
    }

    // Turning a part turns its drawing, but never its writing: pin numbers and other text in the symbol are turned back
    // by exactly as much, so they keep the angle the symbol was designed with (horizontal, normally). A mirrored
    // part turns the same text the other way, hence the sign.
    const mirroredOnce = flipSX(comp) * flipSY(comp) < 0;
    const artDef = window.customSymbolDefinitions?.[comp.type];
    const pivotText = !!(artDef && (artDef.plc || artDef.drive));
    const isTerminalTable = isTerminalTableSymbol(comp.type);
    // The title block (model, make, description...) is the run of texts at the start of a module's list. It is stacked
    // down the label block, so turned a quarter it would run sideways, upright lines on top of one another (and turned
    // half way round it would read upside down): those lines are stacked again, model first, one under another on
    // screen, about the same centre.
    const headNames = new Set([artDef?.modelNo, artDef?.make, artDef?.description, artDef?.drive?.rating].filter(Boolean));
    let headCount = 0;
    if (pivotText) {
      const desc = artDef.description || '';
      while (headCount < customTexts.length) {
        const tx = customTexts[headCount];
        if (tx.head || headNames.has(tx.text) || (desc && tx.text.endsWith('\u2026') && desc.startsWith(tx.text.slice(0, -1)))) headCount++; else break;
      }
    }
    const items = customTexts.map((t, i) => {
      // A text that runs along a pin (a function written beside a pin's lead, turned up the box) belongs to the pin: when
      // the module turns, it turns with it, so it still lies along the lead and is not left standing across it. It is
      // kept readable (left to right, or upward on a vertical lead, never upside down). Every other text keeps the angle
      // the symbol was designed with, as above.
      let screenRot = t.rotation || 0;
      if (pivotText && screenRot) {
        const th = (screenRot * Math.PI) / 180;
        const along = (Math.atan2(flipSY(comp) * Math.sin(th), flipSX(comp) * Math.cos(th)) * 180) / Math.PI + compRotation;
        screenRot = ((((along + 90) % 180) + 180) % 180) - 90;
      }
      let textRotDeg = mirroredOnce ? compRotation - screenRot : screenRot - compRotation;
      if (isTerminalTable) {
        // A terminal table turns as one piece: its writing turns with the body, so every label stays beside its own terminal
        // position. It is kept readable (left to right, or upward when the table stands on end, never upside down): a label that
        // would be upside down is turned half way round about its own centre, which keeps it in the same place.
        let total = ((((compRotation + (t.rotation || 0)) + 180) % 360) + 360) % 360 - 180;   // -180..180
        if (total === 90) total = -90; else if (total > 90) total -= 180; else if (total < -90) total += 180;
        textRotDeg = total - compRotation;
      }
      const textShape = new Konva.Text({
        x: t.relX, y: t.relY, text: t.text,
        fontSize: t.fontSize ? t.fontSize * 0.5 : 6,
        ...symbolTextStyle(t), fill: isSelected ? '#2563eb' : '#0f172a',
        rotation: textRotDeg,
        scaleX: flipSX(comp), scaleY: flipSY(comp)   // text stays readable on a mirrored symbol; only its anchor moves with the mirror
      });
      const w = textShape.width(), h = textShape.height();
      const tr = ((t.rotation || 0) * Math.PI) / 180;
      return { t, textShape, w, h, textRotDeg, head: i < headCount,
        cx: t.relX + (Math.cos(tr) * w / 2 - Math.sin(tr) * h / 2),   // the label's centre as the module was designed
        cy: t.relY + (Math.sin(tr) * w / 2 + Math.cos(tr) * h / 2) };
    });
    const headItems = items.filter(it => it.head);
    if (pivotText && (compRotation !== 0 || flipSY(comp) < 0) && headItems.length > 1 && !headItems.some(it => it.t.rotation)) {
      const gap = 3, total = headItems.reduce((n, it) => n + it.h, 0) + gap * (headItems.length - 1);
      const bx = headItems.reduce((n, it) => n + it.cx, 0) / headItems.length;   // the block's centre, as designed
      const by = (Math.min(...headItems.map(it => it.cy - it.h / 2)) + Math.max(...headItems.map(it => it.cy + it.h / 2))) / 2;
      const rad = (compRotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      let top = -total / 2;
      headItems.forEach(it => {   // on screen the line sits at offset (0, dy) from the block's centre; take that back into the symbol's own frame
        const dy = top + it.h / 2; top += it.h + gap;
        it.cx = bx + flipSX(comp) * (dy * sin);
        it.cy = by + flipSY(comp) * (dy * cos);
      });
    }
    items.forEach(({ t, textShape, w, h, textRotDeg, cx, cy }) => {
      // A PLC module or drive keeps each label's CENTRE where the turn (or mirror) puts it. Turning a text about its own
      // top-left corner left a name written inside the body on one edge sitting over the pin stub on the opposite one.
      if (pivotText || isTerminalTable) {
        const r = (textRotDeg * Math.PI) / 180;
        const ox = flipSX(comp) * w / 2, oy = flipSY(comp) * h / 2;
        textShape.setAttrs({ x: cx - (Math.cos(r) * ox - Math.sin(r) * oy), y: cy - (Math.sin(r) * ox + Math.cos(r) * oy) });
      }
      textShape.on('dblclick dbltap', handleEdit);
      group.add(textShape);
    });

    if (comp.type !== 'terminal') {
      pins.forEach(p => { 
        group.add(new Konva.Line({ 
          x: p.relX, y: p.relY,
          points: [-4, 0, 4, 0],
          rotation: p.rotation || 0,
          stroke: '#000000', strokeWidth: 1 
        }));
      });
    }

    if (isSelected) { 
      group.add(new Konva.Rect({ 
        x: hitBounds.centerX - hitBounds.width / 2, y: hitBounds.centerY - hitBounds.height / 2,
        width: hitBounds.width, height: hitBounds.height,
        stroke: '#38bdf8', strokeWidth: 1.5, dash: [4, 4], listening: false
      }));
    }

    contentLayer.add(group); 
    if (comp.linkContactId) {
      const other = sheet.components.find(c => String(c.id) === String(comp.linkContactId));
      if (other && Number(comp.id) < Number(other.id)) drawMechanicalLink(comp, other);   // drawn once per pair
    }
    if (comp.isParent && comp.linkChildren) {   // dotted lines to its child contacts on this sheet
      sheet.components.forEach(ch => { if (ch.parentId && String(ch.parentId) === String(comp.id) && String(ch.id) !== String(comp.id)) drawParentLink(comp, ch, isSelected || ch.id === state.selectedComponentId || state.rubberBandComponentIds.includes(ch.id), openEditModalCallback); });
    }
    if (comp.isParent && comp.jointToId) {   // the same link between two mechanically joined coils on this sheet
      const main = sheet.components.find(c => String(c.id) === String(comp.jointToId));
      if (main) drawMechanicalLink(comp, main);
    }

    // An assigned terminal's label is centred on its dot (designator to the left,
    // position to the right), raised just above it. An unassigned one keeps the
    // offset it always had.
    const assignedTerminalLabel = comp.type === 'terminal' && isAssignedTerminal(comp);
    const defaultLabelOffsetX = assignedTerminalLabel ? 0 : (comp.type === 'terminal' ? 4 : 35);  // unassigned terminal: was 8 — tucked in snug beside the pin
const defaultLabelOffsetY = assignedTerminalLabel ? -TERMINAL_LABEL_RAISE : (comp.type === 'terminal' ? -8 : -18);  // unassigned terminal: was -14 — just above the pin
let labelX = comp.labelX !== undefined ? comp.labelX : comp.x + defaultLabelOffsetX;
let labelY = comp.labelY !== undefined ? comp.labelY : comp.y + defaultLabelOffsetY;
// A big PLC module or drive that has been turned (or mirrored) covers the spot a symbol's designator normally sits at, so
// until the label has been moved by hand it goes just above the module as it now lies.
if (pivotText && comp.labelX === undefined && comp.labelY === undefined && (compRotation || comp.flipX || comp.flipY)) {
  const wb = componentWorldBox(comp);
  labelX = wb.left + 4;
  labelY = wb.top + defaultLabelOffsetY;
}

const labelGroup = new Konva.Group({ 
  ghostKey: `c:${comp.id}`,
  name: 'componentLabel', // the Wire tool ignores gestures on this — see isDragOnlyTarget
  x: labelX, 
  y: labelY, 
  rotation: 0, 
  draggable: true 
});
    
    labelGroup.on('dragend', (e) => {
  const nx = snapToGrid(e.target.x(), GRID_SIZE / 2);
  const ny = snapToGrid(e.target.y(), GRID_SIZE / 2);
  e.target.position({ x: nx, y: ny });
  comp.labelX = nx;
  comp.labelY = ny;
  scheduleAutosave();
});
    
    labelGroup.on('dblclick dbltap', handleEdit); 

    let displayLabel = comp.label; 
    if (comp.parentId && typeof window.findComponentById === 'function') { 
      const parent = window.findComponentById(comp.parentId); 
      if (parent) { 
        const contactSuffix = comp.contactNo ? `.${comp.contactNo}` : ''; 
        displayLabel = `${parent.label}${contactSuffix}`; 
      }
    }
    // +ABBR- prefix only when this component's effective location genuinely
    // departs from the sheet's own prevailing one — plain "K1" is still the
    // common case, "+CP-K1" only when it's actually somewhere else.
    displayLabel = getDisplayDesignator(displayLabel, comp, sheet);

    let currentY = 0; 
    const SUPPLY_TYPES = ['supply_3n_pe', 'supply_1n_pe', 'supply_3_pe'];
    // A terminal that has a block and position shows them: the designator to the
    // left of its dot (with the location in front, "+MP-X1", only where it is not
    // the sheet's own and not hidden), the position to the right.
    const terminalParts = comp.type === 'terminal' ? terminalLabelParts(comp, sheet) : null;
    const detailX = terminalParts ? TERMINAL_POSITION_GAP : 0; // part number and description line up under the position
    // A generated terminal table is documentation, like a shield: no designator
    // and no value drawn above it.
    const isDocumentationSymbol = isTerminalTableSymbol(comp.type);
    // Terminal row designator (e.g. "1X") left blank for now, per request —
    // revisit later. Supply symbols skip it permanently — their own
    // L1/L2/L3/N/PE labels already identify each conductor, so a separate
    // auto-numbered designator (SUP1, SUP2...) would be redundant.
    if (terminalParts) {
      // Small, grey italic: these identify the terminal without competing with the wiring.
      const textFill = isSelected ? '#2563eb' : '#6b7280';
      const TERMINAL_TEXT_SIZE = 6;
      // No designator at all when the terminal is set to show its position alone.
      if (terminalParts.designator !== '') {
        const designatorText = new Konva.Text({ x: 0, y: currentY, text: terminalParts.designator, fontSize: TERMINAL_TEXT_SIZE, fontStyle: 'italic', fill: textFill });
        // Right-aligned to the dot: moved left by its own width (measured where the
        // drawing library can, estimated where it cannot).
        const designatorWidth = typeof designatorText.getTextWidth === 'function' ? designatorText.getTextWidth() : terminalParts.designator.length * TERMINAL_TEXT_SIZE * 0.6;
        designatorText.setAttrs({ x: -(TERMINAL_DESIGNATOR_GAP + designatorWidth) });
        labelGroup.add(designatorText);
      }
      labelGroup.add(new Konva.Text({ x: TERMINAL_POSITION_GAP, y: currentY, text: terminalParts.position, fontSize: TERMINAL_TEXT_SIZE, fontStyle: 'italic', fill: textFill }));
      currentY += 11; 
    } else if (comp.type !== 'terminal' && !SUPPLY_TYPES.includes(comp.type) && !String(comp.type).startsWith('custom_shield_') && !isDocumentationSymbol && !(comp.hiddenFields || []).includes('designator')) {
      labelGroup.add(new Konva.Text({ 
        x: 0, y: currentY, text: displayLabel, fontSize: 7, fontStyle: 'bold',
        fill: isSelected ? '#2563eb' : '#000' 
      }));
      currentY += 13; 
    }

    // A coil mechanically joined to another (a forward/reverse contactor): each shows the other's designator.
    const jointNames = jointPartnerLabels(comp);
    if (jointNames.length && !isDocumentationSymbol) {
      labelGroup.add(new Konva.Text({ x: 0, y: currentY - 3, text: '\u21C4 ' + jointNames.join(', '), fontSize: 6, fontStyle: 'italic', fill: isSelected ? '#2563eb' : '#6b7280' }));
      currentY += 9;
    }

    const LABEL_FONT_SIZE = 7;
    const LABEL_LINE_HEIGHT = 11;
    const CONTACT_ICON_SIZE = 15; // length of the child-contact icon in the reference list (was 11)

    // A child (a contact of a coil, say) is the same device as its parent, so it shows the parent's value, part number and description,
    // exactly as the edit dialog lists them, each one unless it is unticked under "Show on the sheet". A push button's contact or lamp
    // keeps its own details, and a coil mechanically joined to another shows the main coil's.
    const shared = (comp.jointToId || comp.parentId) && typeof window.getEffectiveComponentDetails === 'function' ? window.getEffectiveComponentDetails(comp) : comp;
    const displayValue = comp.type === 'terminal' ? (terminalParts ? '' : getTerminalEffectiveId(comp, sheet)) : (isDocumentationSymbol ? '' : shared.value);
    if (displayValue && !(comp.hiddenFields || []).includes('value')) { 
      labelGroup.add(new Konva.Text({ 
        x: detailX, y: currentY, text: displayValue, fontSize: LABEL_FONT_SIZE, fill: '#475569' 
      }));
      currentY += LABEL_LINE_HEIGHT; 
    }

    // A PLC module's header already shows its model and description.
    const headerShowsDetails = !!(window.customSymbolDefinitions?.[comp.type]?.plc || (window.customSymbolDefinitions?.[comp.type]?.drive && window.customSymbolDefinitions[comp.type].drive.layout !== 'block'));   // a block-layout drive leaves its part number and description to the label

    if (shared.modelNo && !headerShowsDetails && !(comp.hiddenFields || []).includes('modelNo')) { 
      labelGroup.add(new Konva.Text({ 
        x: detailX, y: currentY, text: `PN: ${shared.modelNo}`, fontSize: LABEL_FONT_SIZE, fontStyle: 'bold', fill: '#334155' 
      }));
      currentY += LABEL_LINE_HEIGHT; 
    }

    if (shared.description && !headerShowsDetails && !(comp.hiddenFields || []).includes('description')) { 
      labelGroup.add(new Konva.Text({ 
        x: detailX, y: currentY, text: shared.description, fontSize: LABEL_FONT_SIZE, fontStyle: 'italic', fill: '#64748b' 
      }));
      currentY += LABEL_LINE_HEIGHT; 
    }

    // A note on a PLC module or drive: the free text that goes with this one (where it is mounted, what it drives...).
    if (comp.note && !isDocumentationSymbol) {
      labelGroup.add(new Konva.Text({ x: detailX, y: currentY, text: comp.note, fontSize: LABEL_FONT_SIZE, fontStyle: 'italic', fill: '#64748b' }));
      currentY += LABEL_LINE_HEIGHT;
    }

    if (typeof window.getCrossReferenceData === 'function') { 
      const refData = (comp.hiddenFields || []).includes('crossRef') ? null : window.getCrossReferenceData(comp);   // "Cross-reference" unticked under Show on the sheet

      if (refData) { 
        currentY += 3; // small gap: visually separates "this component's own details" from "related elsewhere"

        if (refData.type === 'child') { 
          labelGroup.add(new Konva.Text({ 
            x: 0, y: currentY, text: `-[/]- ${refData.text}`, fontSize: LABEL_FONT_SIZE, fontStyle: 'bold', fill: '#6b7280' 
          }));
          currentY += LABEL_LINE_HEIGHT; 
        } else if (refData.type === 'parent' && refData.contacts?.length > 0) { 
          refData.contacts.forEach((contact) => { 
            const iconThickness = getContactIconThickness(contact.symbolType, CONTACT_ICON_SIZE);
            const hasIcon = iconThickness !== null;

            // A row is as tall as its icon needs (never less than a plain text
            // line), with the text centred on the icon — so a thin N.O stays
            // compact while a chunky 3-pole contact gets the room it needs.
            const rowHeight = hasIcon ? Math.max(LABEL_LINE_HEIGHT, iconThickness + 3) : LABEL_LINE_HEIGHT;
            const textY = currentY + (rowHeight - LABEL_LINE_HEIGHT) / 2;

            if (hasIcon) addContactMirrorIcon(labelGroup, 6 + CONTACT_ICON_SIZE / 2, textY + LABEL_FONT_SIZE / 2, contact.symbolType, CONTACT_ICON_SIZE);
            const textX = hasIcon ? 6 + CONTACT_ICON_SIZE + 4 : 6;

            labelGroup.add(new Konva.Text({ 
              x: textX, y: textY, text: `→ ${contact.text}`, fontSize: LABEL_FONT_SIZE, fontStyle: 'bold', fill: '#6b7280' 
            }));
            currentY += rowHeight; 
          });
        }
      }
    }

    group.on('dragmove', (e) => {
  const nx = snapToGrid(e.target.x());
  const ny = snapToGrid(e.target.y());

  const dx = nx - comp.x;
  const dy = ny - comp.y;
  moveGroupGhost(nx, ny);

  // First step of this drag: remember which wire ends are on this component's
  // pins, and what the wires look like right now (before anything moves).
  if (!dragAttachments || dragAttachments.compId !== comp.id) {
    dragAttachments = captureDragAttachments(comp, pins, getActiveSheet(), rubberBandWireSet(getActiveSheet()));
  }

  comp.x = nx;
  comp.y = ny;

  // Move label with component while maintaining manual offset
  if (comp.labelX !== undefined) comp.labelX += dx;
  if (comp.labelY !== undefined) comp.labelY += dy;

  labelGroup.position({
    x: labelGroup.x() + dx,
    y: labelGroup.y() + dy
  });

  const currentSheet = getActiveSheet();
  if (currentSheet?.wires && (dx !== 0 || dy !== 0)) {
    // Re-route the wires attached to this component's pins for its new
    // position — see the notes above routeAttachedWire.
    applyDragAttachments(dragAttachments, comp, pins, pinOutward, currentSheet);

    renderWires();
  }

  contentLayer.batchDraw();
});

    group.on('dragend', (e) => {
      endGroupGhost();
      const nx = snapToGrid(e.target.x());
      const ny = snapToGrid(e.target.y());
      // The delta for the WHOLE gesture (where the drag started, to here) —
      // not "since the last event". dragmove already advances comp.x/y as
      // the pointer moves, and dragend's own pointer position is normally
      // the same spot the last dragmove already reported, so diffing against
      // the (already-updated) comp.x here reliably comes out at zero. That
      // silently broke "the rest of the group follows" for every real drag,
      // and it's only this narrow window (a component with no attached
      // wires, dragged so fast no dragmove ever fired) where comp.x is still
      // truly the start of the gesture and this falls back to it correctly.
      const gestureStartX = (dragAttachments && dragAttachments.compId === comp.id) ? dragAttachments.startX : comp.x;
      const gestureStartY = (dragAttachments && dragAttachments.compId === comp.id) ? dragAttachments.startY : comp.y;
      const groupDx = nx - gestureStartX, groupDy = ny - gestureStartY;

      e.target.position({ x: nx, y: ny });
      comp.x = nx;
      comp.y = ny;

      applyMainGroupDelta(groupDx, groupDy, 'component', comp.id);

      snapComponentIntoWires(comp, getActiveSheet()); // wire it in if it now lands on a wire

      // The snap above can nudge the component onto a nearby wire; re-route
      // the wires attached to its pins for wherever it finally came to rest,
      // so they stay attached rather than being left behind.
      if (dragAttachments && dragAttachments.compId === comp.id) {
        applyDragAttachments(dragAttachments, comp, pins, pinOutward, getActiveSheet());
      }
      dragAttachments = null;

      // Full refresh now that the drag is complete: picks up cross-reference
      // labels on any linked parent/child components, plus junction dots and
      // wire IDs affected by the wires we just reshaped.
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    contentLayer.add(labelGroup); 
  });

  renderSheetTexts(openEditModalCallback);
  renderCableMarkers(openEditModalCallback);

  contentLayer.draw(); 
}

// Free-floating text annotations placed directly on the sheet (not attached to
// any component) — titles, notes, callouts. Selectable, draggable, editable
// via double-click, deletable and rotatable like everything else.
// Tracked outside renderSheetTexts (and thus outside any single Konva node's
// lifecycle) so it survives the full layer rebuild that happens between the
// two clicks of a double-click — see the click handler below for why.
let lastTextClickId = null;
let lastTextClickTime = 0;

function renderSheetTexts(openEditModalCallback) {
  const sheet = getActiveSheet();
  if (!sheet.texts) sheet.texts = [];

  sheet.texts.forEach((textEl) => {
    const isSelected = state.selectedTextId === textEl.id || state.rubberBandTextIds.includes(textEl.id);

    const styleParts = [];
    if (textEl.bold) styleParts.push('bold');
    if (textEl.italic) styleParts.push('italic');

    const textShape = new Konva.Text({
      name: 'sheetTextBox', // the Wire tool ignores gestures on this — see isDragOnlyTarget
      ghostKey: `t:${textEl.id}`,
      x: textEl.x, y: textEl.y,
      text: textEl.text,
      fontSize: textEl.fontSize || 14,
      fontFamily: textEl.fontFamily || 'Arial, sans-serif',
      fontStyle: styleParts.length ? styleParts.join(' ') : 'normal',
      textDecoration: textEl.underline ? 'underline' : '',
      fill: isSelected ? '#2563eb' : '#0f172a',
      rotation: textEl.rotation || 0,
      draggable: true
    });

    textShape.on('click tap', (ev) => {
      ev.cancelBubble = true;

      const now = Date.now();
      const isDoubleClick = lastTextClickId === textEl.id && (now - lastTextClickTime) < 400;
      lastTextClickId = isDoubleClick ? null : textEl.id; // reset so a 3rd click doesn't chain into another "double"
      lastTextClickTime = now;

      if (isDoubleClick) {
        if (typeof window.openTextBoxModalForEdit === 'function') {
          window.openTextBoxModalForEdit(textEl);
        }
        return;
      }

      state.selectedTextId = textEl.id;
      state.selectedComponentId = null;
      state.selectedWireIndex = null;
      state.selectedShapeId = null;
      state.selectedImageId = null;
      state.selectedTerminalLinkId = null;
      renderComponents(openEditModalCallback);
    });

    textShape.on('dragstart', () => { pushHistory(); beginGroupGhost('t', textEl.id, textEl.x, textEl.y); });
    textShape.on('dragmove', () => moveGroupGhost(snapToGrid(textShape.x()), snapToGrid(textShape.y())));

    textShape.on('dragend', () => {
      endGroupGhost();
      const nx = snapToGrid(textShape.x()), ny = snapToGrid(textShape.y());
      const groupDx = nx - textEl.x, groupDy = ny - textEl.y;

      textEl.x = nx;
      textEl.y = ny;
      applyMainGroupDelta(groupDx, groupDy, 'text', textEl.id);

      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    contentLayer.add(textShape);
  });
}

// Draws every cable marker on the current sheet — a trunk line along the
// drag gesture, with a short dashed tick and core number at each wire's
// actual crossing point (standard EE cable-diagram convention), and the
// cable's designator/type/core-count/CSA label at the start of the trunk.
// Reads the cable's live data from state.cables via cableId, so a rename or
// core reassignment shows up immediately.
let lastConnectorClick = { id: null, t: 0 };
function renderCableMarkers(openEditModalCallback) {
  const sheet = getActiveSheet();
  if (!sheet.cableMarkers) sheet.cableMarkers = [];

  sheet.cableMarkers.forEach(marker => {
    const isConnector = marker.kind === 'connector';
    const cable = isConnector ? null : (state.cables || []).find(c => c.id === marker.cableId);
    if (!cable && !isConnector) return; // the cable was deleted elsewhere — orphaned marker, don't draw it

    const isSelected = state.selectedCableMarkerId === marker.id || state.rubberBandCableMarkerIds.includes(marker.id);
    const color = isSelected ? '#2563eb' : '#0f172a';
    const textColor = isSelected ? '#2563eb' : '#6b7280'; // cable text is small, grey italic
    const interactive = state.currentTool === 'select'; // click-through otherwise, so e.g. the Cable tool can draw a new line across an existing one without this stealing the click

    const dx = marker.x2 - marker.x1, dy = marker.y2 - marker.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const perpX = -uy, perpY = ux; // unit vector perpendicular to the trunk, ticks extend this way

    // Where the details go: at the end the line was dragged towards, like the shield tool's drain (a marker made before this was saved
    // has no direction and keeps its details at the left / top end).
    const atEnd = marker.labelDir === 1;
    const markerGroup = new Konva.Group({ ghostKey: `m:${marker.id}`, draggable: interactive, listening: interactive });

    // Trunk line along the drag gesture
    markerGroup.add(new Konva.Line({
      points: [marker.x1, marker.y1, marker.x2, marker.y2],
      stroke: color, strokeWidth: 0.75, hitStrokeWidth: 14
    }));

    if (isConnector) {
      // A connector: a thin dashed line across the poles, the mated plug/socket symbol on every wire, and the pin number
      // beside each. All text stays horizontal.
      const FS = CABLE_TEXT_FONT_SIZE;
      markerGroup.findOne('Line').dash([4, 3]);
      const maleDir = marker.maleDir || { x: 0, y: -1 };
      const horizTrunk = Math.abs(dx) >= Math.abs(dy);
      (marker.coreAssignments || []).forEach(core => {
        const g = connectorGlyph(core.x, core.y, maleDir);
        const style = { stroke: color, strokeWidth: 1.4, lineCap: 'round', lineJoin: 'round', hitStrokeWidth: 10 };
        markerGroup.add(new Konva.Line({ points: g.male, ...style }));
        markerGroup.add(new Konva.Line({ points: g.female, ...style }));
        markerGroup.add(new Konva.Text({
          x: horizTrunk ? core.x + 7 : core.x - 3, y: horizTrunk ? core.y - FS - 4 : core.y - 6 - FS - 4,
          text: String(core.pin ?? core.coreNumber), fontSize: FS, fontStyle: 'italic', fill: textColor, listening: false
        }));
      });
      // Designator, then (unless hidden) the description and part number, stacked beside the start of the line.
      const lines = [{ text: marker.designator || '', size: FS + 1, style: 'bold', fill: color }];
      if (marker.description && !marker.hideDescription) lines.push({ text: marker.description, size: FS, style: 'italic', fill: textColor });
      if (marker.partNo && !marker.hidePartNo) lines.push({ text: `PN: ${marker.partNo}`, size: FS, style: 'bold', fill: textColor });
      const nodes = lines.map(l => new Konva.Text({ text: l.text, fontSize: l.size, fontStyle: l.style, fill: l.fill, listening: false }));
      const LH = FS + 4;
      nodes.forEach((n, k) => {
        const w = n.width();
        if (atEnd) {      // at the end the line was dragged towards
          if (horizTrunk) n.setAttrs({ x: marker.x2 + CABLE_LABEL_GAP, y: marker.y2 - (FS + 1) / 2 + k * LH });
          else n.setAttrs({ x: marker.x2 - w / 2, y: marker.y2 + 8 + k * LH });
        } else if (horizTrunk) n.setAttrs({ x: ux >= 0 ? marker.x1 - CABLE_LABEL_GAP - w : marker.x1 + CABLE_LABEL_GAP, y: marker.y1 - (FS + 1) / 2 + k * LH });
        else n.setAttrs({ x: marker.x1 - w / 2, y: uy >= 0 ? marker.y1 - FS - 8 - (nodes.length - 1 - k) * LH : marker.y1 + 8 + k * LH });
        markerGroup.add(n);
      });
    } else {
    // Descriptor label (designator, type, core count x CSA), in line with the
    // trunk: centred on its line and just in front of where it starts, so it
    // reads as a caption for the line rather than floating above it. On a
    // horizontal trunk it runs alongside; on a vertical one it turns to run
    // along the line too, reading upward. Placed from its measured size, so
    // the gap in front of the trunk is exact whatever the text says.
    const labelText = [cable.designator, cable.cableType, cable.csa ? `${cable.coreCount}x${cable.csa}mm\u00B2` : `${cable.coreCount} core`]
      .filter(Boolean).join(' ');
    const labelNode = new Konva.Text({ text: labelText, fontSize: CABLE_TEXT_FONT_SIZE, fontStyle: 'italic', fill: textColor, listening: false });
    const labelWidth = labelNode.width();
    if (atEnd) {
      if (Math.abs(dx) >= Math.abs(dy)) labelNode.setAttrs({ x: marker.x2 + CABLE_LABEL_GAP, y: marker.y2 - CABLE_TEXT_FONT_SIZE / 2 });
      else labelNode.setAttrs({ rotation: -90, x: marker.x2 - CABLE_TEXT_FONT_SIZE / 2, y: marker.y2 + CABLE_LABEL_GAP + labelWidth });
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      labelNode.setAttrs({
        x: ux >= 0 ? marker.x1 - CABLE_LABEL_GAP - labelWidth : marker.x1 + CABLE_LABEL_GAP,
        y: marker.y1 - CABLE_TEXT_FONT_SIZE / 2
      });
    } else {
      // Rotated -90 the text hangs up and to the right of its corner, so the
      // corner sits half a text-height left of the line, at the near end.
      labelNode.setAttrs({
        rotation: -90,
        x: marker.x1 - CABLE_TEXT_FONT_SIZE / 2,
        y: uy >= 0 ? marker.y1 - CABLE_LABEL_GAP : marker.y1 + CABLE_LABEL_GAP + labelWidth
      });
    }
    markerGroup.add(labelNode);

    // Core number at each wire's actual crossing point — the wire itself
    // now carries the dash-dash-line pattern to show it's cable-assigned,
    // so no separate tick mark is needed here.
    (marker.coreAssignments || []).forEach(core => {
      // A core shows its colour code (BRN, BLK ...) if it has a colour, otherwise
      // its number - never both. The code sits where the number would. Across a
      // horizontal trunk the wires run vertically, so the code runs along the
      // wire to keep clear of its neighbours; across a vertical trunk it reads
      // left to right.
      const colourCode = coreColourOf(cable, core.coreNumber);
      if (!colourCode) {
        markerGroup.add(new Konva.Text({
          x: core.x + ux * 6 - perpX * CABLE_CORE_NUMBER_GAP, y: core.y - perpY * CABLE_CORE_NUMBER_GAP - CABLE_TEXT_FONT_SIZE, // minus one text height: its bottom edge stays where it was
          text: `${core.coreNumber}`, fontSize: CABLE_TEXT_FONT_SIZE, fontStyle: 'italic', fill: textColor, listening: false
        }));
      } else {
        const codeNode = new Konva.Text({ text: colourCode, fontSize: CABLE_TEXT_FONT_SIZE, fontStyle: 'italic', fill: textColor, listening: false });
        const bx = core.x + ux * 6;
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (perpY >= 0) codeNode.setAttrs({ rotation: -90, x: bx, y: core.y - CABLE_CORE_NUMBER_GAP - 3 });
          else codeNode.setAttrs({ rotation: 90, x: bx + CABLE_TEXT_FONT_SIZE, y: core.y + CABLE_CORE_NUMBER_GAP + 3 });
        } else {
          codeNode.setAttrs({
            x: perpX >= 0 ? core.x - CABLE_CORE_NUMBER_GAP - 3 - codeNode.width() : core.x + CABLE_CORE_NUMBER_GAP + 3,
            y: core.y - CABLE_TEXT_FONT_SIZE
          });
        }
        markerGroup.add(codeNode);
      }
    });
    }

    markerGroup.on('click tap', (ev) => {
      ev.cancelBubble = true;
      // Double-click to edit: a connector opens its own dialog, a cable marker opens the Cable Manager. Timed here rather
      // than with Konva's dblclick, because the first click redraws the sheet and the second then lands on a new node,
      // which Konva doesn't count as a double-click.
      {
        const now = Date.now();
        if (lastConnectorClick.id === marker.id && now - lastConnectorClick.t < 450) {
          lastConnectorClick = { id: null, t: 0 };
          if (isConnector) { if (typeof window.openConnectorEditor === 'function') window.openConnectorEditor(marker.id); }
          else if (typeof window.openCableManagerModal === 'function') window.openCableManagerModal(marker.cableId);
          return;
        }
        lastConnectorClick = { id: marker.id, t: now };
      }
      clearMainRubberBandSelection();
      state.selectedCableMarkerId = marker.id;
      state.selectedComponentId = null;
      state.selectedTextId = null;
      state.selectedWireIndex = null;
      state.selectedShapeId = null;
      state.selectedImageId = null;
      state.selectedTerminalLinkId = null;
      renderComponents(openEditModalCallback);
    });

    markerGroup.on('dragstart', () => { pushHistory(); beginGroupGhost('m', marker.id, 0, 0); });
    markerGroup.on('dragmove', () => moveGroupGhost(snapToGrid(markerGroup.x()), snapToGrid(markerGroup.y())));

    markerGroup.on('dragend', () => {
      endGroupGhost();
      // Konva reports the drag as a move of the GROUP's own (0,0) origin —
      // translate the marker's line endpoints and every core's recorded
      // crossing point by that same delta, so the numbers stay exactly where
      // they were relative to the trunk (and to whatever wires moved with
      // it, if this was dragged as part of a rubber-band group).
      const moveDx = snapToGrid(markerGroup.x()), moveDy = snapToGrid(markerGroup.y());
      marker.x1 += moveDx; marker.y1 += moveDy;
      marker.x2 += moveDx; marker.y2 += moveDy;
      (marker.coreAssignments || []).forEach(core => { core.x += moveDx; core.y += moveDy; });
      markerGroup.position({ x: 0, y: 0 });
      applyMainGroupDelta(moveDx, moveDy, 'cableMarker', marker.id); // the rest of a rubber-band group, if this was part of one, follows along
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    contentLayer.add(markerGroup);
  });
}

export function deleteSelectedSheetText(renderCallback) {
  if (!state.selectedTextId) return;
  const sheet = getActiveSheet();
  if (!sheet?.texts) return;
  pushHistory();
  sheet.texts = sheet.texts.filter(t => t.id !== state.selectedTextId);
  state.selectedTextId = null;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

export function rotateSelectedSheetText(renderCallback) {
  if (!state.selectedTextId) return;
  const sheet = getActiveSheet();
  const textEl = (sheet?.texts || []).find(t => t.id === state.selectedTextId);
  if (!textEl) return;
  pushHistory();
  textEl.rotation = ((textEl.rotation || 0) + 90) % 360;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

/**
 * Calculates the midpoint coordinates along a multi-segment wire.
 * @param {Array<number>} points - Flat array of coordinate pairs [x1, y1, x2, y2, ...]
 * @returns {{x: number, y: number}} The midpoint coordinates
 */
export function getWireMidpoint(points) {
  if (!points || points.length < 4) {
    return { x: 0, y: 0 };
  }

  // Calculate segment lengths and total wire length
  let totalLength = 0;
  const segments = [];

  for (let i = 0; i < points.length - 2; i += 2) {
    const x1 = points[i];
    const y1 = points[i + 1];
    const x2 = points[i + 2];
    const y2 = points[i + 3];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    segments.push({ x1, y1, x2, y2, dx, dy, length });
    totalLength += length;
  }

  const halfLength = totalLength / 2;
  let accumulatedLength = 0;

  // Traversal to locate the point at half of the total wire distance
  for (const seg of segments) {
    if (accumulatedLength + seg.length >= halfLength) {
      const remainingDistance = halfLength - accumulatedLength;
      const ratio = seg.length === 0 ? 0 : remainingDistance / seg.length;

      return {
        x: Math.round(seg.x1 + seg.dx * ratio),
        y: Math.round(seg.y1 + seg.dy * ratio)
      };
    }
    accumulatedLength += seg.length;
  }

  // Fallback to the last point
  return {
    x: points[points.length - 2],
    y: points[points.length - 1]
  };
}

export function rotateSelectedComponent(renderCallback) {
  if (getPageType(getActiveSheet()) === 'panel') { if (typeof window.panelRotateSelected === 'function') window.panelRotateSelected(); return; }
  if (!state.selectedComponentId) return;
  const sheet = getActiveSheet();
  const comp = sheet.components.find(c => c.id === state.selectedComponentId);
  if (comp) {
    pushHistory();
    comp.rotation = ((comp.rotation || 0) + 90) % 360;
    if (typeof renderCallback === 'function') renderCallback();
    scheduleAutosave();
  }
}

// Mirrors the selected component left-right ('x') or top-bottom ('y'), about the middle of its pins, so a two-pin
// symbol keeps its wires where they are (the pins swap sides).
export function flipSelectedComponent(axis, renderCallback) {
  if (getPageType(getActiveSheet()) === 'panel') return;
  if (!state.selectedComponentId) { appAlert('Click a component first, then choose Flip.'); return; }
  const sheet = getActiveSheet();
  const comp = sheet.components.find(c => c.id === state.selectedComponentId);
  if (!comp) return;
  const { pins, pinOutward } = resolveComponentArtwork(comp);
  if (!pins.length) return;
  pushHistory();
  const attachments = captureDragAttachments(comp, pins, sheet, null);
  const oldPos = pins.map(p => pinWorldPosition(comp, p));
  // The middle of the pins in the symbol's own (unmirrored) frame, then the origin shift that makes the mirror about it.
  const key = axis === 'y' ? 'relY' : 'relX';
  const vals = pins.map(p => p[key]);
  const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
  const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const lx = axis === 'y' ? 0 : 2 * mid * flipSX(comp), ly = axis === 'y' ? 2 * mid * flipSY(comp) : 0;
  comp.x = Math.round((comp.x + lx * cos - ly * sin) * 100) / 100;
  comp.y = Math.round((comp.y + lx * sin + ly * cos) * 100) / 100;
  if (axis === 'y') { if (comp.flipY) delete comp.flipY; else comp.flipY = true; }
  else { if (comp.flipX) delete comp.flipX; else comp.flipX = true; }
  // A wire end still sitting on one of the symbol's pins stays put (the pins of a two-pin symbol simply swap sides);
  // one left in the air, because the pin it was on has moved somewhere new, is re-routed to that pin.
  const newPos = pins.map(p => pinWorldPosition(comp, p));
  attachments.items.forEach(item => {
    if (item.rigid) return;
    const P = newPos[item.pinIdx], o = oldPos[item.pinIdx];
    if (newPos.some(q => Math.abs(q.x - o.x) < 0.01 && Math.abs(q.y - o.y) < 0.01)) return;
    const local = pinOutward ? pinOutward[item.pinIdx] : null;
    const d = local ? { x: Math.round(flipSX(comp) * local.x * cos - flipSY(comp) * local.y * sin) || 0, y: Math.round(flipSX(comp) * local.x * sin + flipSY(comp) * local.y * cos) || 0 } : null;
    const routed = routeAttachedWire(item.atStart ? item.orig : reversePoints(item.orig), P, d);
    const pts = item.atStart ? routed : reversePoints(routed);
    item.wire.points.splice(0, item.wire.points.length, ...pts);
  });
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

function pinWorldPosition(comp, p) {
  const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin), y: comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos) };
}

// Which of a symbol's pins the pins of another symbol correspond to, by where they sit on the symbol (scaled to its own size):
// the top-left pin to the top-left pin, and so on. One-to-one; a pin with no partner is left out. Returns Map(oldIdx -> newIdx).
function pairPinsByPosition(oldPins, newPins) {
  const norm = (pins) => {
    if (!pins.length) return [];
    const xs = pins.map(p => p.relX), ys = pins.map(p => p.relY);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const hx = (Math.max(...xs) - Math.min(...xs)) / 2 || 1, hy = (Math.max(...ys) - Math.min(...ys)) / 2 || 1;
    return pins.map(p => ({ x: (p.relX - cx) / hx, y: (p.relY - cy) / hy }));
  };
  const a = norm(oldPins), b = norm(newPins);
  const pairs = [];
  a.forEach((p, i) => b.forEach((q, j) => pairs.push({ i, j, d: Math.hypot(p.x - q.x, p.y - q.y) + (String(oldPins[i].id) === String(newPins[j].id) ? 0 : 0.01) })));
  pairs.sort((x, y) => x.d - y.d);
  const usedA = new Set(), usedB = new Set(), map = new Map();
  pairs.forEach(pr => { if (usedA.has(pr.i) || usedB.has(pr.j)) return; usedA.add(pr.i); usedB.add(pr.j); map.set(pr.i, pr.j); });
  return map;
}

// Can this part be swapped for another symbol? (Terminals have their own tools; supplies and grounds are drawn, not swapped.)
export function canSwapComponent(comp) {
  return !!comp && comp.type !== 'terminal' && !!window.customSymbolDefinitions?.[comp.type];
}

// Replaces a part's symbol with another one, in place: same designator, position, rotation and links, and the wires stay
// attached — only their ends move to the new symbol's pins — so every wire keeps its ID. Returns true when swapped.
export function swapComponent(compId, newType, renderCallback) {
  const sheet = getActiveSheet();
  const comp = (sheet.components || []).find(c => c.id === compId);
  if (!comp || !window.customSymbolDefinitions?.[newType] || newType === comp.type) return false;
  pushHistory();
  const oldPins = getPinsForType(comp.type);
  const att = captureDragAttachments(comp, oldPins, sheet, null);
  const ids = new Map((sheet.wires || []).map(w => [w, wireIdInfo(w)]));

  const newDef = window.customSymbolDefinitions[newType];
  const newPins = getPinsForType(newType);
  const pinMap = pairPinsByPosition(oldPins, newPins);

  comp.type = newType;
  // What belonged to the old symbol: its details, and settings keyed to its pins.
  const dflt = getPrefixAndValue(newType);
  comp.value = dflt.value;
  comp.make = ''; comp.modelNo = ''; comp.description = '';
  delete comp.plcFns; delete comp.driveFns;
  if (!newDef.childContact) { delete comp.contactRef; delete comp.contactNo; delete comp.contactTerms; }

  // Move each wire end that was on a pin to the partner pin on the new symbol.
  const { pinOutward } = resolveComponentArtwork(comp);
  const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  // A wire left behind (its pin has no partner on the new symbol) stays where it was; another must not be moved onto it, or two nets would join.
  const left = new Set(att.items.filter(it => !pinMap.has(it.pinIdx)).map(it => (it.atStart ? it.orig[0] + ',' + it.orig[1] : it.orig[it.orig.length - 2] + ',' + it.orig[it.orig.length - 1])));
  att.items.forEach(item => {
    const j = pinMap.get(item.pinIdx);
    if (j === undefined || !sheet.wires.includes(item.wire)) return;
    const P = pinWorldPosition(comp, newPins[j]);
    if (left.has(P.x + ',' + P.y)) return;
    const pts = item.wire.points;
    const cur = item.atStart ? { x: pts[0], y: pts[1] } : { x: pts[pts.length - 2], y: pts[pts.length - 1] };
    if (cur.x === P.x && cur.y === P.y) return;
    const local = pinOutward ? pinOutward[j] : null;
    const d = local ? { x: Math.round(flipSX(comp) * local.x * cos - flipSY(comp) * local.y * sin) || 0, y: Math.round(flipSX(comp) * local.x * sin + flipSY(comp) * local.y * cos) || 0 } : null;
    const routed = routeAttachedWire(item.atStart ? pts.slice() : reversePoints(pts.slice()), P, d);
    const out = item.atStart ? routed : reversePoints(routed);
    logWireOp('component-swapped-moved-wire-end', { wireId: item.wire.wireId, end: item.atStart ? 'start' : 'end', before: pts.slice(), after: out });
    pts.splice(0, pts.length, ...out);
  });
  // The numbers the wires had are theirs to keep, whatever the new symbol's pins now join.
  ids.forEach((info, w) => { if (info.wireId) { w.wireId = info.wireId; w.wireIdManual = info.manual; if (info.user) w.wireIdUser = true; else delete w.wireIdUser; } });
  removedPart = null;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
  return true;
}

// Coils joined to a coil that is about to be deleted become parts in their own right, keeping the main coil's details.
function releaseJoinedCoils(deleted) {
  const gone = new Map(deleted.map(c => [String(c.id), c]));
  if (!gone.size) return;
  state.sheets.forEach(s => (s.components || []).forEach(c => {
    const main = c.jointToId ? gone.get(String(c.jointToId)) : null;
    if (!main || gone.has(String(c.id))) return;
    c.value = main.value || ''; c.make = main.make || ''; c.modelNo = main.modelNo || ''; c.description = main.description || '';
    if (!(c.auxItems || []).length) c.auxItems = (main.auxItems || []).map(a => ({ ...a }));   // (a coil with aux items of its own keeps them)
    delete c.jointToId;
  }));
}

// ==========================================
// A PART SWAPPED FOR ANOTHER KEEPS THE WIRE IDs
// ==========================================
// Taking a part out of a run joins the wires either side of it (and closes the numbering up); putting another one in its
// place breaks them again with new numbers. When one part is swapped for another that should leave the wires with the IDs
// they had. So when a part is deleted its wires' IDs are remembered by pin, and when a new part then appears where it was,
// the wires that meet its pins take the IDs of the old part's nearest pins, and the rest of the sheet goes back to the
// numbers it had. Held in memory only, for ten minutes or until every old pin has been matched.
let removedPart = null;
const SWAP_MEMORY_MS = 10 * 60 * 1000;
const SWAP_REACH = 200;   // how far from the old part the new one may be and still count as its replacement
const nearPt = (a, b) => Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5;

function wireEndsAt(sheet, q) {
  return (sheet.wires || []).filter(w => {
    const p = w.points || [], n = p.length;
    return n >= 4 && (nearPt({ x: p[0], y: p[1] }, q) || nearPt({ x: p[n - 2], y: p[n - 1] }, q));
  });
}
const wireIdInfo = (w) => ({ wireId: w.wireId, manual: !!w.wireIdManual, user: !!w.wireIdUser });

function rememberRemovedPart(sheet, part) {
  removedPart = null;
  if (!part || part.type === 'terminal') return;
  const pins = getPinsForType(part.type).map(p => pinWorldPosition(part, p));
  if (pins.length < 2) return;
  const records = [];
  pins.forEach(q => {
    const hit = wireEndsAt(sheet, q);
    if (hit.length === 1 && hit[0].wireId) records.push({ x: q.x, y: q.y, ...wireIdInfo(hit[0]), used: false });
  });
  if (!records.length) return;
  const all = new Map();
  (sheet.wires || []).forEach(w => all.set(w.id, wireIdInfo(w)));
  const cores = [];
  (state.cables || []).forEach(c => Object.keys(c.coreWireIds || {}).forEach(k => cores.push({ holder: c.coreWireIds, key: k, value: c.coreWireIds[k] })));
  (sheet.cableMarkers || []).forEach(m => (m.coreAssignments || []).forEach(ca => cores.push({ holder: ca, key: 'wireId', value: ca.wireId })));
  removedPart = { sheet, x: part.x, y: part.y, records, all, cores, compIds: new Set((sheet.components || []).filter(c => c.id !== part.id).map(c => c.id)), reverted: false, at: Date.now() };
}

// Called as the sheet is drawn: once a new part sits where the old one was and wires meet its pins, they take the old IDs.
function applySwapMemory(sheet) {
  const m = removedPart;
  if (!m || m.sheet !== sheet) return;
  if (Date.now() - m.at > SWAP_MEMORY_MS) { removedPart = null; return; }
  const cand = (sheet.components || [])
    .filter(c => !m.compIds.has(c.id) && c.type !== 'terminal' && getPinsForType(c.type).length >= 2 && Math.hypot(c.x - m.x, c.y - m.y) <= SWAP_REACH)
    .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
  if (!cand) return;
  const pins = getPinsForType(cand.type).map(p => pinWorldPosition(cand, p));
  const pairs = [];
  pins.forEach((q, qi) => {
    const hit = wireEndsAt(sheet, q);
    if (hit.length !== 1) return;
    m.records.forEach((o, oi) => { if (!o.used) pairs.push({ qi, oi, wire: hit[0], d: Math.hypot(q.x - o.x, q.y - o.y) }); });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedPin = new Set(), usedRec = new Set(), chosen = [];
  pairs.forEach(pr => {
    if (usedPin.has(pr.qi) || usedRec.has(pr.oi) || pr.d > SWAP_REACH) return;
    usedPin.add(pr.qi); usedRec.add(pr.oi); chosen.push(pr);
  });
  if (!chosen.length) return;   // no wire on the new part yet: keep waiting

  const apply = (w, info) => {
    w.wireId = info.wireId; w.wireIdManual = info.manual;
    if (info.user) w.wireIdUser = true; else delete w.wireIdUser;
  };
  if (!m.reverted) {   // the rest of the sheet goes back to the numbers it had before the part came out
    sheet.wires.forEach(w => { const info = m.all.get(w.id); if (info && !w.wireIdManual && !info.manual) apply(w, info); });
    m.cores.forEach(r => { if (r.holder[r.key] !== r.value) r.holder[r.key] = r.value; });
    m.reverted = true;
  }
  chosen.forEach(pr => {
    const rec = m.records[pr.oi];
    if (!pr.wire.wireIdManual) apply(pr.wire, rec);
    rec.used = true;
  });
  logWireOp('part swapped: wire IDs kept', { part: cand.label || cand.type, wires: chosen.length });
  if (m.records.every(r => r.used)) removedPart = null;
}

export function deleteSelectedComponent(renderCallback) {
  if (getPageType(getActiveSheet()) === 'panel') { if (typeof window.panelDeleteSelected === 'function') window.panelDeleteSelected(); return; }
  const hasGroup = state.rubberBandComponentIds.length > 0 || state.rubberBandTextIds.length > 0 || state.rubberBandWireIndices.length > 0 || state.rubberBandCableMarkerIds.length > 0;
  if (!state.selectedComponentId && !hasGroup) return;

  pushHistory();
  const sheet = getActiveSheet();
  releaseJoinedCoils(hasGroup ? (sheet.components || []).filter(c => state.rubberBandComponentIds.includes(c.id)) : (sheet.components || []).filter(c => c.id === state.selectedComponentId));

  const removedParts = hasGroup ? (sheet.components || []).filter(c => state.rubberBandComponentIds.includes(c.id)) : (sheet.components || []).filter(c => c.id === state.selectedComponentId);
  if (!hasGroup && removedParts.length === 1) rememberRemovedPart(sheet, removedParts[0]); else removedPart = null;   // a swap is one part out, one part in

  if (hasGroup) {
    sheet.components = (sheet.components || []).filter(c => !state.rubberBandComponentIds.includes(c.id));
    sheet.texts = (sheet.texts || []).filter(t => !state.rubberBandTextIds.includes(t.id));
    sheet.wires = (sheet.wires || []).filter((w, i) => !state.rubberBandWireIndices.includes(i));
    state.rubberBandCableMarkerIds.forEach(id => removeCableMarker(sheet, id)); // one call per marker — releases each one's cores correctly, same as a single delete
    state.rubberBandComponentIds = [];
    state.rubberBandTextIds = [];
    state.rubberBandWireIndices = [];
    state.rubberBandCableMarkerIds = [];
  } else {
    sheet.components = sheet.components.filter(c => c.id !== state.selectedComponentId);
  }
  const gone = [];
  removedParts.forEach(part => gone.push(...rejoinWiresAcrossPart(sheet, part)));
  [...new Set(gone.map(g => splitAutoId(g)?.n).filter(n => n !== undefined))].sort((p, q) => q - p).forEach(id => {   // the numbering closes up over each ID that went, highest first
    if (!sheet.wires.some(w => !w.wireIdManual && splitAutoId(w.wireId)?.n === id)) shiftSheetWireIds(sheet, id, -1);
  });   // a part taken out of a run leaves the wires on either side joined up

  state.selectedComponentId = null;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

// Clones the selected component a small offset away, with a freshly numbered label.
export function duplicateSelectedComponent(renderCallback) {
  if (!state.selectedComponentId) return;
  const sheet = getActiveSheet();
  const original = sheet.components.find(c => c.id === state.selectedComponentId);
  if (!original) return;

  pushHistory();

  const newId = Date.now() + Math.floor(Math.random() * 1000);
  const clone = {
    ...original,
    id: newId,
    x: snapToGrid(original.x + 40),
    y: snapToGrid(original.y + 40),
    label: nextLabelForType(sheet, original.type),
    // A duplicate is its own independent component, not a linked contact of the original.
    parentId: null,
    jointToId: undefined,
    linkContactId: undefined,
    contactNo: '',
    isParent: false,
    labelX: undefined,
    labelY: undefined,
    plcFns: original.plcFns ? { ...original.plcFns } : undefined,
    driveFns: original.driveFns ? { ...original.driveFns } : undefined,
    note: original.note || undefined
  };
  // A duplicated terminal stays on the same block but takes the next free
  // position — it must never be a second terminal on the same screw.
  if (isAssignedTerminal(original)) Object.assign(clone, duplicateTerminalFields(sheet, original));

  sheet.components.push(clone);
  state.selectedComponentId = newId;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

export function deleteSelectedWire(renderCallback) {
  if (state.selectedWireIndex === null) return;
  pushHistory();
  const sheet = getActiveSheet();
  if (sheet && sheet.wires) {
    const doomed = sheet.wires[state.selectedWireIndex];
    logWireOp('wire-deleted (Delete key)', { wireId: doomed?.wireId, points: doomed ? [...doomed.points] : null, selectedWireIndex: state.selectedWireIndex });
    sheet.wires.splice(state.selectedWireIndex, 1);
  }
  state.selectedWireIndex = null;
  renderWires();
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
  scheduleAutosave();
}

// Attach Stage Wire Mouse Handlers
// Main-canvas rubber-band select (separate from the Symbol Studio's own copy)
let mainRubberBandStart = null;
let mainRubberBandRect = null;

// Drops an elastic-band drag in progress without changing the selection — for
// switching tools mid-drag (mirrors cancelShapeDraw / cancelTerminalLinkPick),
// so the box never gets left stuck on screen belonging to a tool that's no
// longer armed.
export function cancelRubberBandSelect() {
  if (!mainRubberBandRect) return;
  mainRubberBandRect.destroy();
  mainRubberBandRect = null;
  mainRubberBandStart = null;
  wirePreviewLayer.batchDraw();
}
// True for the instant right after a genuine (not just a click) elastic-band
// drag finishes. Releasing the mouse over empty canvas fires 'mouseup' and
// then a trailing 'click' on that same spot — without this, that click ran
// the "clicked empty canvas" handler below and immediately wiped out the
// selection the drag had just made, so a rubber-band select never stuck.
let rubberBandJustFinished = false;

// ==========================================
// WIRES RUNNING THROUGH PARTS
// ==========================================
// A wire drawn straight across a part that sits between its two ends (a contactor or breaker between a supply and a
// motor, say) lands on that part's pins on the way. A part passes the current through itself, so the wire is broken
// there: it stops at the pin it reaches and carries on from the part's other pin, instead of running through the
// symbol as though it were not there. A terminal in the way splits the wire into two that meet at the terminal.
// Returns the pieces as separate point lists ([points] unchanged when nothing is in the way).
function splitRouteAtParts(points, sheet, onlyPartId = null) {
  const TOL = 0.5;
  const n = points.length / 2;
  if (n < 2 || !sheet) return [points];
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(points[2 * i] - points[2 * i - 2], points[2 * i + 1] - points[2 * i - 1]));
  const total = cum[n - 1];
  if (total < TOL) return [points];

  const hitsByPart = new Map();
  const partsAtAnEnd = new Set();
  (sheet.components || []).forEach(comp => {
    if (onlyPartId !== null && comp.id !== onlyPartId) return;
    const pins = getPinsForType(comp.type);
    if (!pins.length) return;
    const seen = new Set();
    pins.forEach(pin => {
      const w = pinWorldPosition(comp, pin);
      const key = `${Math.round(w.x * 100)},${Math.round(w.y * 100)}`;
      if (seen.has(key)) return;
      seen.add(key);
      for (let i = 0; i < n - 1; i++) {
        const seg = { x1: points[2 * i], y1: points[2 * i + 1], x2: points[2 * i + 2], y2: points[2 * i + 3] };
        const proj = closestPointOnSegment(w.x, w.y, seg);
        if (proj.distSq > TOL * TOL) continue;
        const s = cum[i] + Math.hypot(proj.x - seg.x1, proj.y - seg.y1);
        if (s <= TOL || s >= total - TOL) { partsAtAnEnd.add(comp.id); break; }   // the wire's own ends are its connections, not something it passes through
        if (!hitsByPart.has(comp.id)) hitsByPart.set(comp.id, { terminal: comp.type === 'terminal', hits: [] });
        hitsByPart.get(comp.id).hits.push({ s, x: w.x, y: w.y });
        break;
      }
    });
  });

  const cuts = [];   // [from, to] stretches of the wire that are replaced by the part itself
  hitsByPart.forEach((info, id) => {
    if (info.terminal) { cuts.push({ a: info.hits[0], b: info.hits[0], join: true }); return; }
    if (partsAtAnEnd.has(id) || info.hits.length < 2) return;   // one pin only: just a connection, nothing passes through
    const sorted = info.hits.slice().sort((p, q) => p.s - q.s);
    cuts.push({ a: sorted[0], b: sorted[sorted.length - 1] });
  });
  if (!cuts.length) return [points];
  cuts.sort((p, q) => p.a.s - q.a.s);

  const startPoint = { s: 0, x: points[0], y: points[1] };
  const endPoint = { s: total, x: points[2 * n - 2], y: points[2 * n - 1] };
  const piece = (from, to) => {
    const out = [from.x, from.y];
    for (let i = 1; i < n - 1; i++) if (cum[i] > from.s + TOL && cum[i] < to.s - TOL) out.push(points[2 * i], points[2 * i + 1]);
    out.push(to.x, to.y);
    return out;
  };
  const pieces = [];
  let from = startPoint;
  cuts.forEach(cut => {
    if (cut.a.s < from.s + TOL && !cut.join) return;   // overlaps a stretch already cut out
    if (cut.a.s - from.s > TOL) pieces.push(piece(from, cut.a));
    from = cut.b;
  });
  if (endPoint.s - from.s > TOL) pieces.push(piece(from, endPoint));
  return pieces.length ? pieces : [points];
}

// The next `count` wire IDs for this sheet, continuing from the highest number already used (and never below the
// sheet's own range, 800s on sheet 8). IDs given out here are kept as they are; an ID below the sheet's range would
// be thrown away and renumbered in whatever order the wires happen to be stored.
function allocateWireIds(sheet, count) {
  let highest = (getSchematicSheetNumber(state.activeSheetIndex) ?? ((state.activeSheetIndex ?? 0) + 1)) * 100 - 1;
  (sheet.wires || []).forEach(w => { const a = w.wireId ? splitAutoId(w.wireId) : null; if (a) highest = Math.max(highest, a.n); });
  const prefix = wirePrefixOf(sheet);
  return Array.from({ length: count }, () => `${prefix}${++highest}`);
}

// Wire IDs count up along each conductor, one conductor after the next: a three-phase bundle through two contactors is
// 800 - K1 - 801 - K2 - 802 - motor for the first conductor, then 803, 804, 805 for the second, 806, 807, 808 for the third.
// Everything after a gap in the numbering moves up or down to make or close room, so the order always reads that way.
// (Cable cores that name a wire follow it to its new number.)
function shiftSheetWireIds(sheet, after, by) {
  if (!by || !sheet?.wires) return;
  const moves = new Map();
  sheet.wires.forEach(w => {
    const a = w.wireIdManual ? null : splitAutoId(w.wireId);
    if (!a) return;
    if (a.n > after && !moves.has(w.wireId)) moves.set(w.wireId, `${a.prefix}${a.n + by}`);
  });
  if (!moves.size) return;
  sheet.wires.forEach(w => { if (!w.wireIdManual && moves.has(w.wireId)) w.wireId = moves.get(w.wireId); });
  (state.cables || []).forEach(cable => {
    const ids = cable.coreWireIds || {};
    Object.keys(ids).forEach(core => { if (moves.has(ids[core])) ids[core] = moves.get(ids[core]); });
  });
  (sheet.cableMarkers || []).forEach(m => (m.coreAssignments || []).forEach(ca => { if (moves.has(ca.wireId)) ca.wireId = moves.get(ca.wireId); }));
}

// Adds drawn routes to the sheet as wires — more than one each where a route runs through parts on the way. Each
// route's wires are numbered one after another (see above), the routes in the order they were drawn.
// Does this run of wire touch the pin of a supply symbol (L1, L2, L3, N, PE)? The supply's own labels name that conductor, so
// a wire there carries no wire ID and must not use up a number in the sequence.
function touchesSupplyPin(points, sheet) {
  const at = new Set();
  (sheet.components || []).forEach(comp => {
    if (!getPinLabelsForType(comp.type)) return;
    getPinsForType(comp.type).forEach(p => { const q = pinWorldPosition(comp, p); at.add(`${q.x},${q.y}`); });
  });
  if (!at.size) return false;
  for (let i = 0; i < points.length; i += 2) if (at.has(`${points[i]},${points[i + 1]}`)) return true;
  return false;
}

export function addRoutesAsWires(sheet, routes, stamp) {
  const split = routes.map(r => splitRouteAtParts(r, sheet));
  const onSupply = split.map(pieces => pieces.map(pts => touchesSupplyPin(pts, sheet)));
  const ids = allocateWireIds(sheet, onSupply.reduce((n, flags) => n + flags.filter(f => !f).length, 0));
  let next = 0;
  split.forEach((pieces, r) => {
    pieces.forEach((pts, k) => sheet.wires.push({ id: stamp + r * 100 + k, wireId: onSupply[r][k] ? '' : ids[next++], points: pts }));
  });
  const extra = split.reduce((n, p) => n + p.length - 1, 0);
  if (extra) logWireOp('routes split at parts', { routes: routes.length, extraWires: extra });
  return extra;
}

// A part is deleted from a run of wire: where a wire reached one of its pins and another wire leaves the opposite
// pin in the same straight line, the two are joined back into one wire, which keeps the ID of the upstream one (a name
// the person typed wins, otherwise the lower number), so the net is whole again and reads as it did before the part
// went in. Pins that are not in a straight run (a coil, a junction) are left alone.
function rejoinWiresAcrossPart(sheet, comp) {
  if (!sheet?.wires?.length || comp.type === 'terminal') return [];
  const EPS = 0.5;
  const pins = getPinsForType(comp.type).map(p => pinWorldPosition(comp, p));
  const near = (x, y, q) => Math.abs(x - q.x) <= EPS && Math.abs(y - q.y) <= EPS;
  const endsAt = (q) => {
    const out = [];
    sheet.wires.forEach(w => {
      const pts = w.points; const n = pts ? pts.length : 0;
      if (n < 4) return;
      if (near(pts[0], pts[1], q)) out.push({ wire: w, atStart: true, dx: Math.sign(Math.round(pts[2] - pts[0])), dy: Math.sign(Math.round(pts[3] - pts[1])) });
      if (near(pts[n - 2], pts[n - 1], q)) out.push({ wire: w, atStart: false, dx: Math.sign(Math.round(pts[n - 4] - pts[n - 2])), dy: Math.sign(Math.round(pts[n - 3] - pts[n - 1])) });
    });
    return out;
  };
  const info = pins.map(q => { const e = endsAt(q); return e.length === 1 ? e[0] : null; });   // exactly one wire ends here
  const used = new Set();
  const numeric = w => { const a = w.wireId ? splitAutoId(w.wireId) : null; return a ? a.n : null; };
  let joined = 0;
  const droppedIds = [];   // wire IDs that no longer exist, for the caller to close up the numbering

  for (let i = 0; i < pins.length; i++) {
    const a = info[i];
    if (!a || used.has(i)) continue;
    let best = -1, bestDist = Infinity;
    for (let j = 0; j < pins.length; j++) {
      const b = info[j];
      if (j === i || !b || used.has(j) || b.wire === a.wire) continue;
      const vx = pins[j].x - pins[i].x, vy = pins[j].y - pins[i].y;
      const dist = Math.abs(vx) + Math.abs(vy);
      if (dist < EPS) continue;
      const straight = (Math.abs(vx) <= EPS && vy * -a.dy > 0 && a.dx === 0) || (Math.abs(vy) <= EPS && vx * -a.dx > 0 && a.dy === 0);   // directly through the part from where wire A arrives
      if (!straight || b.dx !== -a.dx || b.dy !== -a.dy) continue;                                                                // and wire B leaves heading on the same way
      if (dist < bestDist) { best = j; bestDist = dist; }
    }
    if (best < 0) continue;
    const b = info[best];
    used.add(i); used.add(best);

    const A = a.atStart ? reversePoints(a.wire.points) : a.wire.points.slice();   // ends at pin i
    const B = b.atStart ? b.wire.points.slice() : reversePoints(b.wire.points);   // starts at the opposite pin
    const merged = cleanRoute(A.concat(B)) || A.concat(B);
    // The wire that carries on is the one named by hand, else the lower-numbered (upstream) one.
    const aWins = a.wire.wireIdManual || (!b.wire.wireIdManual && (numeric(a.wire) ?? Infinity) <= (numeric(b.wire) ?? Infinity));
    const keep = aWins ? a.wire : b.wire, drop = aWins ? b.wire : a.wire;
    keep.points = merged;
    sheet.wires.splice(sheet.wires.indexOf(drop), 1);
    if (!drop.wireIdManual && splitAutoId(drop.wireId)) droppedIds.push(drop.wireId);
    joined++;
  }
  if (joined) logWireOp('part deleted: wires rejoined', { part: comp.label || comp.type, joined });
  return droppedIds;
}

// A part placed or dropped onto wires that already exist: wherever a wire runs across two or more of its pins, the
// wire is broken there (the part carries the current from its one pin to the other), the same as when a wire is
// drawn across a part. The new piece takes the very next number after the wire it came from, and everything numbered
// after that moves up one, so the IDs still count up along each conductor: 800 - K1 - 801 - motor becomes
// 800 - K1 - 801 - K2 - 802 - motor, and the next conductor starts at 803. A name the person typed stays on both pieces.
function breakWiresThroughPart(sheet, comp) {
  if (!sheet?.wires?.length || comp.type === 'terminal') return 0;
  const cut = [];
  sheet.wires.forEach(wire => {
    if (!wire.points || wire.points.length < 4) return;
    const pieces = splitRouteAtParts(wire.points, sheet, comp.id);
    if (pieces.length > 1) cut.push({ wire, pieces });
  });
  if (!cut.length) return 0;

  const isAuto = w => !w.wireIdManual && !!splitAutoId(w.wireId);
  const autoN = w => splitAutoId(w.wireId).n;
  const stamp = Date.now();
  let added = 0;
  // Highest ID first, so making room for one wire never disturbs the wires still to be done below it.
  cut.sort((p, q) => (isAuto(q.wire) ? autoN(q.wire) : -1) - (isAuto(p.wire) ? autoN(p.wire) : -1));
  cut.forEach((c, r) => {
    const x = isAuto(c.wire) ? autoN(c.wire) : null;
    const xPrefix = isAuto(c.wire) ? splitAutoId(c.wire.wireId).prefix : '';
    if (x !== null) shiftSheetWireIds(sheet, x, c.pieces.length - 1);   // room for the new pieces straight after this wire's number
    c.wire.points = c.pieces[0];
    for (let k = 1; k < c.pieces.length; k++) {
      const wireId = x !== null ? `${xPrefix}${x + k}` : (c.wire.wireId && c.wire.wireIdManual ? c.wire.wireId : (c.wire.wireId || ''));
      sheet.wires.push({ ...c.wire, id: stamp + r * 100 + k, points: c.pieces[k], labelX: undefined, labelY: undefined, wireId });
      added++;
    }
  });
  logWireOp('part dropped onto wires: wires broken', { part: comp.label || comp.type, wires: cut.length, added });
  return added;
}

// ==========================================
// MULTI-WIRE TOOL
// ==========================================
// Drag across a row of pins to pick them, then across the pins to join them to: one wire is drawn for each pair, in
// the order the lines passed over them (so 3 wires for a three-phase feed, 4 with a neutral, and so on). The pins in
// each sweep are paired off in the order dragged — drag the second line the other way to swap the pairing.
let mw = null;
function mwReset() {
  if (mw) {
    [...(mw.hints || []), ...(mw.live || []), ...(mw.preview || [])].forEach(n => n.destroy());
    if (mw.line) mw.line.destroy();
    if (mw.label) mw.label.destroy();
  }
  mw = { phase: 'idle', sheet: null, pins: [], start: null, end: null, line: null, src: null, hints: [], live: [], preview: [], label: null };
  wirePreviewLayer.batchDraw();
}
export function cancelMultiWire() { if (mw) mwReset(); }

// Every pin on the sheet: where it is, and (when the symbol says) which way a wire should leave it.
function mwCollectPins(sheet) {
  const out = [];
  (sheet.components || []).forEach(comp => {
    const art = resolveComponentArtwork(comp);
    const rad = ((comp.rotation || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    art.pins.forEach((p, i) => {
      const w = pinWorldPosition(comp, p);
      let dir = null;
      const o = art.pinOutward[i];
      if (o) {
        const dx = flipSX(comp) * o.x * cos - flipSY(comp) * o.y * sin;
        const dy = flipSX(comp) * o.x * sin + flipSY(comp) * o.y * cos;
        dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      }
      out.push({ x: w.x, y: w.y, compId: comp.id, pinId: p.id, out: dir });
    });
  });
  return out;
}

function mwText(msg, x, y) {
  const scale = stage.scaleX() || 1;
  if (mw.label) { mw.label.destroy(); mw.label = null; }
  if (!msg) { wirePreviewLayer.batchDraw(); return; }
  const label = new Konva.Label({ x, y: y - 34 / scale, listening: false });
  label.add(new Konva.Tag({ fill: '#1f2937', opacity: 0.92, cornerRadius: 4 / scale }));
  label.add(new Konva.Text({ text: msg, fontSize: 12 / scale, padding: 5 / scale, fill: '#ffffff', fontFamily: 'Arial' }));
  wirePreviewLayer.add(label);
  mw.label = label;
  wirePreviewLayer.batchDraw();
}

function mwRings(pins, colour, into) {
  const scale = stage.scaleX() || 1;
  pins.forEach(p => {
    const c = new Konva.Circle({ x: p.x, y: p.y, radius: 8, stroke: colour, strokeWidth: 2 / Math.max(scale, 0.5), fill: colour + '33', listening: false });
    wirePreviewLayer.add(c);
    into.push(c);
  });
}

// The routes for source -> destination pins, ready to draw or to keep.
function mwRoutes(srcPins, srcAxis, dstPins, dstAxis) {
  const dirS = bundleDirection(srcPins, srcAxis, dstPins);
  const dirD = bundleDirection(dstPins, dstAxis, srcPins);
  return routeBundle(srcPins, dstPins, dirS, dirD, snapToGrid);
}

// Cable tool: drag a line across a group of wires to bundle them into a cable
let cableDragStart = null;
let cableDragLine = null;
let shieldDragStart = null;
let shieldDragLine = null;

// Builds the pathData/pins for a Shield symbol scaled to N crossed wires: a
// short double-tick crossing mark at each wire's own relative position
// along the drag (not evenly spaced — wherever the real wires actually
// are), bracketed by semicircle arcs top and bottom representing the
// cable's screen, plus a short drain stub below the bottom arc ending in
// its own pin — where the real grounding terminal gets placed and wired.
// relPositions: each crossed wire's position along the local axis (y if
// the drag was vertical, x if horizontal), relative to the group's own
// center — so 0 sits in the middle of the whole symbol.
// Places the shield symbol itself, scaled to whichever wires the drag
// crossed. The drain end is just this symbol's own pin (the same kind the
// Symbol Studio's Add Pin tool creates) — not a separate terminal
// component, so it carries no designator of its own. Nothing here touches
// the cable system either (no core assignment, no BOM entry) — purely a
// drawn symbol.
function createShieldSymbol(sheet, crossed, x1, y1, x2, y2, renderCallback) {
  if (!sheet.components) sheet.components = [];

  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  // Each crossed wire's position along the local (pre-rotation) axis —
  // always treated as "y" in buildShieldGeometry's own coordinate system;
  // a horizontal drag's wires are spread along x instead, so their x
  // becomes the local axis here, and the whole symbol is rotated 90°
  // below to bring it back to actually running across them correctly.
  const axisValues = crossed.map(c => horizontal ? c.x : c.y);
  const crossAxisValues = crossed.map(c => horizontal ? c.y : c.x);
  const rawCenterAxis = (Math.min(...axisValues) + Math.max(...axisValues)) / 2;
  const rawCenterCrossAxis = crossAxisValues.reduce((a, b) => a + b, 0) / crossAxisValues.length;

  // The component's own x/y is snapped to the grid below, same as any other
  // placed component — but relPositions has to be worked out relative to
  // THAT SAME, SNAPPED point, not the raw centroid. Using the raw one here
  // (as an earlier version did) left every pin off by however far snapping
  // moved the component — invisible in the data, but visibly misaligned
  // from the real wires the moment it was drawn, correcting itself only if
  // the component was later nudged (which is what finally re-snaps it).
  const compX = snapToGrid(horizontal ? rawCenterAxis : rawCenterCrossAxis);
  const compY = snapToGrid(horizontal ? rawCenterCrossAxis : rawCenterAxis);
  const snappedCenterAxis = horizontal ? compX : compY;
  // A 90°-rotated component's own pin-position formula is comp.x - relY
  // (a mirror, not a plain offset — see getAllPinPositions, the same
  // rotation convention used everywhere else in the app), so relY has to
  // be the negative of the vertical-drag case for the two to still land
  // on the same real wire positions. Using the same sign for both (an
  // earlier version did) only happened to work when the snapped centre
  // exactly equalled the true centre — true for an odd wire count, where
  // the middle wire's own grid-aligned position IS that centre, but never
  // for an even one, where the true centre always falls exactly halfway
  // between two grid points and snapping moves it — which is exactly why
  // the bug only ever showed up on even counts.
  // The drain end goes the way the line was dragged: drag downward and it comes
  // out of the bottom, upward and it comes out of the top, and likewise right
  // and left. The symbol is built with its drain pointing along local +y, so
  // the rotation chosen here turns that to the drag direction (0 = down,
  // 90 = left, 180 = up, 270 = right) and relPositions mirrors whenever the
  // rotation flips the axis the wires are measured along.
  const rotation = horizontal ? (x2 >= x1 ? 270 : 90) : (y2 >= y1 ? 0 : 180);
  const flipped = rotation === 90 || rotation === 180;
  const relPositions = axisValues.map(v => flipped ? (snappedCenterAxis - v) : (v - snappedCenterAxis));

  const { pathSegments, pins } = buildShieldGeometry(relPositions);
  const symKey = `custom_shield_${Date.now()}`;
  pushHistory();
  window.customSymbolDefinitions[symKey] = {
    name: 'Shield', prefix: 'SH', value: ' ', // a lone space, not '' — see generateTerminalBlock for why
    pathData: pathSegments, pins, texts: [],
    hidden: true
  };

  const { value: compValue } = getPrefixAndValue(symKey);
  const shieldComp = {
    id: Date.now() + 1, type: symKey, label: nextLabelForType(sheet, symKey), value: compValue,
    modelNo: '', make: '', description: '',
    x: compX, y: compY, rotation
  };
  sheet.components.push(shieldComp);

  state.selectedComponentId = shieldComp.id;
  if (renderCallback) renderCallback();
  scheduleAutosave();
}

function buildShieldGeometry(relPositions) {
  // A single, fully solid capsule (stadium) outline — two straight sides and
  // two semicircular end caps, all one continuous stroke, nothing dashed.
  // Every wire still gets its own pair of connection pins at its real
  // position, for snapping into place — but there's no per-wire mark on the
  // outline itself; the closed capsule shape alone is the whole symbol.
  const WIRE_HALF_LEN = 14, CAPSULE_HALF_WIDTH = 5, DRAIN_STUB = 10;
  const sorted = [...relPositions].sort((a, b) => a - b);
  const minY = sorted[0], maxY = sorted[sorted.length - 1];
  const pathSegments = [];
  const pins = [];

  sorted.forEach((y, i) => {
    pins.push({ id: `${i + 1}L`, relX: -WIRE_HALF_LEN, relY: y });
    pins.push({ id: `${i + 1}R`, relX: WIRE_HALF_LEN, relY: y });
  });

  pathSegments.push({ d: `M ${-CAPSULE_HALF_WIDTH} ${minY} L ${-CAPSULE_HALF_WIDTH} ${maxY}`, dash: 'solid' });
  pathSegments.push({ d: `M ${CAPSULE_HALF_WIDTH} ${minY} L ${CAPSULE_HALF_WIDTH} ${maxY}`, dash: 'solid' });
  pathSegments.push({ d: `M ${-CAPSULE_HALF_WIDTH} ${minY} A ${CAPSULE_HALF_WIDTH} ${CAPSULE_HALF_WIDTH} 0 0 1 ${CAPSULE_HALF_WIDTH} ${minY}`, dash: 'solid' });
  pathSegments.push({ d: `M ${-CAPSULE_HALF_WIDTH} ${maxY} A ${CAPSULE_HALF_WIDTH} ${CAPSULE_HALF_WIDTH} 0 0 0 ${CAPSULE_HALF_WIDTH} ${maxY}`, dash: 'solid' });

  // The drain: not a separate terminal component any more — just this
  // symbol's own pin, the same kind of connection point any custom symbol
  // gets from the Symbol Studio's own Add Pin tool. Centred (x: 0), running
  // straight on from the bottom cap's own true apex (maxY + its radius,
  // not the midpoint between its two side-pins, which sits short of the
  // curve itself and would make the stub double back over the arc instead
  // of continuing cleanly out from it).
  const arcApexY = maxY + CAPSULE_HALF_WIDTH;
  const drainY = arcApexY + DRAIN_STUB;
  pathSegments.push({ d: `M 0 ${arcApexY} L 0 ${drainY}`, dash: 'solid' });
  pins.push({ id: 'drain', relX: 0, relY: drainY });

  return { pathSegments, pins };
}

function clearMainRubberBandSelection() {
  state.rubberBandComponentIds = [];
  state.rubberBandTextIds = [];
  state.rubberBandWireIndices = [];
  state.rubberBandCableMarkerIds = [];
}

// The wires currently in the rubber-band selection, as a Set of the actual
// wire OBJECTS (not indices) — for excluding them from a component's own
// unselected-attached-wire re-routing, since a selected wire moves rigidly
// with the rest of the group instead (see applyMainGroupDelta).
function rubberBandWireSet(sheet) {
  if (state.rubberBandWireIndices.length === 0) return null;
  const set = new Set();
  state.rubberBandWireIndices.forEach(i => { const w = sheet?.wires?.[i]; if (w) set.add(w); });
  return set;
}

// While one item of a multi-item selection is being dragged, the rest only move
// when it is dropped. So a faint copy of those others follows the pointer meanwhile,
// showing where the whole group will land. The copies are made from the drawn
// shapes, which each carry a `ghostKey` (c:<component>, t:<text>, m:<cable
// marker>, w:<wire index>) saying which item they belong to.
let groupGhost = null; // { node, startX, startY }

function beginGroupGhost(kind, id, startX, startY) {
  endGroupGhost();
  const total = state.rubberBandComponentIds.length + state.rubberBandTextIds.length + state.rubberBandWireIndices.length + state.rubberBandCableMarkerIds.length;
  if (total <= 1) return;
  const keys = new Set([
    ...state.rubberBandComponentIds.map(i => `c:${i}`),
    ...state.rubberBandTextIds.map(i => `t:${i}`),
    ...state.rubberBandCableMarkerIds.map(i => `m:${i}`),
    ...state.rubberBandWireIndices.map(i => `w:${i}`)
  ]);
  keys.delete(`${kind}:${id}`); // the one being dragged moves by itself
  if (keys.size === 0) return;
  const node = new Konva.Group({ name: 'dragGhost', opacity: 0.45, listening: false });
  [wireLayer, contentLayer].forEach(layer => {
    layer.find(n => keys.has(n.getAttr('ghostKey'))).forEach(n => {
      node.add(n.clone({ listening: false, draggable: false, ghostKey: undefined }));
    });
  });
  if (node.getChildren().length === 0) { node.destroy(); return; }
  shapeHandleLayer.add(node);
  groupGhost = { node, startX, startY };
  shapeHandleLayer.batchDraw();
}

function moveGroupGhost(x, y) {
  if (!groupGhost) return;
  groupGhost.node.position({ x: x - groupGhost.startX, y: y - groupGhost.startY });
  shapeHandleLayer.batchDraw();
}

function endGroupGhost() {
  if (!groupGhost) return;
  groupGhost.node.destroy();
  groupGhost = null;
  shapeHandleLayer.batchDraw();
}

// Moves every OTHER member of the current rubber-band selection by the same
// delta as whichever one was just dragged — so the whole group (components,
// text boxes, and any fully-enclosed wires) moves together as one block.
// A no-op unless more than one item is actually selected as a group.
function applyMainGroupDelta(dx, dy, excludeType, excludeId) {
  if (dx === 0 && dy === 0) return;
  const totalSelected = state.rubberBandComponentIds.length + state.rubberBandTextIds.length + state.rubberBandWireIndices.length + state.rubberBandCableMarkerIds.length;
  if (totalSelected <= 1) return;
  logWireOp('group-move (other selected items follow)', { dx, dy, components: state.rubberBandComponentIds.length, texts: state.rubberBandTextIds.length, wires: state.rubberBandWireIndices.length, cableMarkers: state.rubberBandCableMarkerIds.length });

  const sheet = getActiveSheet();
  const excludeWires = rubberBandWireSet(sheet); // the group's own selected wires — never independently re-routed, see below

  // Every fully-selected wire is inside the box at BOTH ends, so it (and
  // whatever else in the group it's attached to) moves as one rigid piece —
  // translate every vertex by the same delta.
  state.rubberBandWireIndices.forEach(i => {
    const wire = sheet?.wires?.[i];
    if (!wire || !wire.points) return;
    for (let k = 0; k < wire.points.length; k += 2) { wire.points[k] += dx; wire.points[k + 1] += dy; }
    // A manually-dragged ID label is stored as an absolute position, not
    // relative to the wire — without this it's left exactly where it was
    // while the wire moves out from under it. Matches the raw (unsnapped)
    // shift the wire's own single-drag path already applies to it.
    if (wire.labelX !== undefined) { wire.labelX += dx; wire.labelY += dy; }
  });

  state.rubberBandComponentIds.forEach(id => {
    if (excludeType === 'component' && id === excludeId) return; // the one actually dragged — its own dragend handler already moved it and re-routes its own wires
    const c = (sheet.components || []).find(x => x.id === id);
    if (!c) return;
    // Re-route THIS component's own attached wires that are not themselves
    // part of the group (e.g. a supply feed running off to the rest of the
    // sheet) — the same lead-preserving routing a direct drag already gets,
    // captured from where it stood before this move.
    const { pins, pinOutward } = resolveComponentArtwork(c);
    const attachments = captureDragAttachments(c, pins, sheet, excludeWires);
    c.x = snapToGrid(c.x + dx);
    c.y = snapToGrid(c.y + dy);
    applyDragAttachments(attachments, c, pins, pinOutward, sheet);
    // Same story as a wire's label, and the same fix — a component's OWN
    // single-drag path already does exactly this (see its dragmove
    // handler); this is that same behaviour for when the component instead
    // moves as a passenger in a rubber-band group.
    if (c.labelX !== undefined) { c.labelX += dx; c.labelY += dy; }
  });
  state.rubberBandTextIds.forEach(id => {
    if (excludeType === 'text' && id === excludeId) return;
    const t = (sheet.texts || []).find(x => x.id === id);
    if (t) { t.x = snapToGrid(t.x + dx); t.y = snapToGrid(t.y + dy); }
  });
  state.rubberBandCableMarkerIds.forEach(id => {
    if (excludeType === 'cableMarker' && id === excludeId) return; // the one actually dragged — its own dragend handler already moved it
    const m = (sheet.cableMarkers || []).find(x => x.id === id);
    if (!m) return;
    m.x1 += dx; m.y1 += dy; m.x2 += dx; m.y2 += dy;
    (m.coreAssignments || []).forEach(core => { core.x += dx; core.y += dy; });
  });
}

// ==========================================
// ANNOTATION SHAPES (line / rectangle / ellipse)
// ==========================================
// Free-floating drawing annotations — a boundary box around a panel, a
// dividing line, a callout ellipse. Stored per sheet in sheet.shapes as
//   { id, type: 'line' | 'rect' | 'ellipse', x1, y1, x2, y2, style }
// A shape is just two points: a line runs from one to the other, and a
// rectangle/ellipse fills the box between them as opposite corners — so
// dragging one corner past the other simply flips the shape, with no special
// cases. They live on their own layer BELOW wires and components, and are
// outline-only, so a box drawn around part of the schematic never covers or
// blocks anything inside it; only the outline itself can be clicked.
const SHAPE_TOOLS = { 'shape-line': 'line', 'shape-arrow': 'arrow', 'shape-rect': 'rect', 'shape-ellipse': 'ellipse', 'shape-location': 'rect' };
const SHAPE_STYLES = ['solid', 'dashed', 'dotted', 'dashdashline'];
const SHAPE_COLOR = '#0f172a';
const SHAPE_COLOR_SELECTED = '#2563eb';
const SHAPE_STROKE_WIDTH = 1.5;

function shapeKindForTool(tool) {
  return Object.prototype.hasOwnProperty.call(SHAPE_TOOLS, tool) ? SHAPE_TOOLS[tool] : null;
}

function setCanvasCursor(cursor) {
  const el = stage.container && stage.container();
  if (el && el.style) el.style.cursor = cursor;
}

function shapeBox(s) {
  return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

// Just the geometry part of a shape's Konva node — used both to create a node
// and to update one in place while a handle is being dragged.
function shapeNodeGeometry(s) {
  if (s.type === 'line') return { points: [s.x1, s.y1, s.x2, s.y2] };
  const b = shapeBox(s);
  if (s.type === 'rect') return { x: b.x, y: b.y, width: b.w, height: b.h };
  return { x: b.x + b.w / 2, y: b.y + b.h / 2, radiusX: b.w / 2, radiusY: b.h / 2 };
}

// ---- Arrows ----
// An arrow is a shape of type 'arrow': the same two points as a line, plus
//   head: 'end' | 'start' | 'both'      which end(s) carry a head
//   headStyle: 'filled' | 'open' | 'circle' | 'bar'
//   headSize: a multiple of the usual head size (0.7 to 3; absent = 1)
//   weight: line thickness (0.5 / 1 / 1.5)
//   note, noteDx, noteDy: an optional text note; (noteDx, noteDy) is the note box's top-left corner
//   measured from the arrow's first point, so the note travels with the arrow when it is moved.
// It is drawn as a Group (the shaft, plus one small node per head) so the heads are never dashed even
// when the shaft is. Everything is plain Konva Lines and Circles.
export const ARROW_HEADS = ['filled', 'open', 'circle', 'bar'];
export const ARROW_ENDS = ['end', 'both', 'start'];
export const ARROW_HEAD_SIZES = [0.7, 1, 1.5, 2, 3]; // small, normal (the original), large, extra large, huge: a multiple of the head's usual size
export const ARROW_WEIGHTS = [0.5, 1, 1.5]; // thin, medium, thick (an arrow saved with one of the older, heavier weights is drawn thick)

// Pure geometry for one arrowhead at `tip`, pointing along the unit vector (ux, uy) (out of the line).
export function arrowHeadGeometry(headStyle, tipX, tipY, ux, uy, weight, size = 1) {
  const L = (6 + 4 * weight) * size, W = L * 0.4;
  const nx = -uy, ny = ux;
  if (headStyle === 'circle') {
    const r = (2.5 + weight * 1.6) * size;
    return { kind: 'circle', x: tipX - ux * r, y: tipY - uy * r, radius: r };
  }
  if (headStyle === 'bar') {
    return { kind: 'line', closed: false, points: [tipX + nx * W * 1.3, tipY + ny * W * 1.3, tipX - nx * W * 1.3, tipY - ny * W * 1.3] };
  }
  const bx = tipX - ux * L, by = tipY - uy * L;
  return { kind: 'line', closed: headStyle === 'filled', points: [bx + nx * W, by + ny * W, tipX, tipY, bx - nx * W, by - ny * W] };
}

function arrowNormalised(s) {
  return {
    head: ARROW_ENDS.includes(s.head) ? s.head : 'end',
    headStyle: ARROW_HEADS.includes(s.headStyle) ? s.headStyle : 'filled',
    headSize: Number.isFinite(s.headSize) ? ARROW_HEAD_SIZES.reduce((best, z) => (Math.abs(z - s.headSize) < Math.abs(best - s.headSize) ? z : best), ARROW_HEAD_SIZES[1]) : 1,
    weight: Number.isFinite(s.weight) ? ARROW_WEIGHTS.reduce((best, w) => (Math.abs(w - s.weight) < Math.abs(best - s.weight) ? w : best), ARROW_WEIGHTS[0]) : 1
  };
}

function fillArrowNode(group, s, isSelected) {
  const colour = isSelected ? SHAPE_COLOR_SELECTED : SHAPE_COLOR;
  const { head, headStyle, weight, headSize } = arrowNormalised(s);
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
  group.add(new Konva.Line({
    points: [s.x1, s.y1, s.x2, s.y2], stroke: colour, strokeWidth: weight, dash: getDashArray(s.style),
    lineCap: 'round', hitStrokeWidth: 14, name: 'arrowShaft'
  }));
  if (len === 0) return;
  const ux = dx / len, uy = dy / len;
  const heads = [];
  if (head === 'end' || head === 'both') heads.push([s.x2, s.y2, ux, uy]);
  if (head === 'start' || head === 'both') heads.push([s.x1, s.y1, -ux, -uy]);
  heads.forEach(([tx, ty, hx, hy]) => {
    const g = arrowHeadGeometry(headStyle, tx, ty, hx, hy, weight, headSize);
    if (g.kind === 'circle') {
      group.add(new Konva.Circle({ x: g.x, y: g.y, radius: g.radius, fill: colour, stroke: colour, strokeWidth: 0.5, name: 'arrowHead' }));
    } else {
      group.add(new Konva.Line({
        points: g.points, closed: g.closed, fill: g.closed ? colour : undefined, stroke: colour,
        strokeWidth: Math.max(0.75, weight), lineCap: 'round', lineJoin: 'round', name: 'arrowHead'
      }));
    }
  });
}

function createArrowNode(s, isSelected, extra) {
  const group = new Konva.Group({ ...extra });
  group.setAttr('isSelectedArrow', !!isSelected);
  fillArrowNode(group, s, isSelected);
  return group;
}

function createShapeNode(s, isSelected, extra = {}) {
  if (s.type === 'arrow') return createArrowNode(s, isSelected, extra);
  const NodeClass = s.type === 'line' ? Konva.Line : s.type === 'rect' ? Konva.Rect : Konva.Ellipse;
  return new NodeClass({
    ...shapeNodeGeometry(s),
    stroke: isSelected ? SHAPE_COLOR_SELECTED : SHAPE_COLOR,
    strokeWidth: SHAPE_STROKE_WIDTH,
    dash: getDashArray(s.style),
    fillEnabled: false, // outline only — otherwise the whole interior would catch clicks meant for the sheet underneath
    hitStrokeWidth: 12, // generous target for the outline, since it's the only clickable part
    ...extra
  });
}

function updateShapeNode(node, s) {
  if (s.type === 'arrow') {
    node.destroyChildren();
    fillArrowNode(node, s, true);
    return;
  }
  node.setAttrs(shapeNodeGeometry(s));
}

// Where the end of a shape being drawn (or a handle being dragged) lands,
// given its fixed opposite point. Lines stay horizontal/vertical like every
// other line in the app unless Shift is held; Shift on a rectangle/ellipse
// forces equal sides (a square / circle).
function constrainShapeEnd(kind, fixedX, fixedY, x, y, shift) {
  if (kind === 'line' || kind === 'arrow') { // a line or arrow goes wherever you like; Shift squares it up to horizontal / vertical
    return shift ? getOrthogonalPoint(fixedX, fixedY, x, y) : { x, y };
  }
  if (shift) {
    const size = Math.max(Math.abs(x - fixedX), Math.abs(y - fixedY));
    return { x: fixedX + (x < fixedX ? -size : size), y: fixedY + (y < fixedY ? -size : size) };
  }
  return { x, y };
}

// Line, arrow, rectangle and ellipse snap to a finer step than the 20 px grid so they can be placed precisely: 5, 10 or 20 px
// (the choice is remembered in this browser).
export const SHAPE_SNAP_CHOICES = [5, 10, 20];
let SHAPE_SNAP = 5;
try { const v = parseInt(localStorage.getItem('ssShapeSnap'), 10); if (SHAPE_SNAP_CHOICES.includes(v)) SHAPE_SNAP = v; } catch (e) { /* storage blocked: the default stands */ }
export function getShapeSnap() { return SHAPE_SNAP; }
export function setShapeSnap(v) {
  v = parseInt(v, 10);
  if (!SHAPE_SNAP_CHOICES.includes(v)) return;
  SHAPE_SNAP = v;
  try { localStorage.setItem('ssShapeSnap', String(v)); } catch (e) { /* ignore */ }
}

function snappedWorldPointer() {
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  const scale = stage.scaleX();
  return { x: snapToGrid((pos.x - stage.x()) / scale, SHAPE_SNAP), y: snapToGrid((pos.y - stage.y()) / scale, SHAPE_SNAP) };
}

// Same conversion, without the grid-snap — for anything that should track
// the pointer smoothly rather than jump in 20-unit steps (the tool-icon
// label below; the crosshair guide deliberately uses the snapped version).
function rawWorldPointer() {
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  const scale = stage.scaleX();
  return { x: (pos.x - stage.x()) / scale, y: (pos.y - stage.y()) / scale };
}

function selectOnlyShape(id) {
  clearMainRubberBandSelection();
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  state.selectedTextId = null;
  state.selectedCableMarkerId = null;
  state.selectedTerminalLinkId = null;
  state.selectedShapeId = id;
}

// True if the node, or anything it sits inside, is something dragged around
// (a component, a label, a text box) — a press on one of those is a move, not
// the start of a new shape.
function isInsideDraggable(node) {
  for (let n = node; n && n.getParent && n.getParent(); n = n.getParent()) {
    if (typeof n.draggable === 'function' && n.draggable()) return true;
  }
  return false;
}

// Which corner/end each handle controls: [px, py] name the coordinates of the
// shape (x1/x2, y1/y2) that handle moves.
function shapeHandleSpecs(s) {
  if (s.type === 'line' || s.type === 'arrow') return [{ px: 'x1', py: 'y1' }, { px: 'x2', py: 'y2' }];
  return [{ px: 'x1', py: 'y1' }, { px: 'x2', py: 'y1' }, { px: 'x2', py: 'y2' }, { px: 'x1', py: 'y2' }];
}

// Resize handles are drawn small (so they don't hide the thing being resized) but
// grabbed from a much larger invisible square, so they are easy to hit. `hitPx` is
// the target's width on screen; the caller lowers it for a small shape so
// neighbouring handles don't fight over the same spot.
const HANDLE_HIT_PX = 26;
function enlargeHandleHit(handle, drawnSize, scale, hitPx = HANDLE_HIT_PX) {
  const hit = Math.max(drawnSize, hitPx / scale);
  handle.hitFunc((ctx, shape) => {
    ctx.beginPath();
    ctx.rect(drawnSize / 2 - hit / 2, drawnSize / 2 - hit / 2, hit, hit);
    ctx.closePath();
    ctx.fillStrokeShape(shape);
  });
}

function addShapeHandles(s, bodyNode, openEditModalCallback) {
  const scale = stage.scaleX() || 1;
  const size = 9 / scale; // stays the same on-screen size at any zoom
  const specs = shapeHandleSpecs(s);

  const handles = specs.map(spec => new Konva.Rect({
    name: 'shapeHandle',
    x: s[spec.px], y: s[spec.py], width: size, height: size, offsetX: size / 2, offsetY: size / 2,
    fill: '#ffffff', stroke: SHAPE_COLOR_SELECTED, strokeWidth: 1.5 / scale, draggable: true
  }));
  // A small shape gets smaller grab areas, so its handles don't overlap one another.
  const shapeSpanPx = (s.type === 'line' || s.type === 'arrow' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) : Math.min(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))) * scale;
  const shapeHitPx = Math.min(HANDLE_HIT_PX, Math.max(12, shapeSpanPx * 0.6));
  handles.forEach(h => enlargeHandleHit(h, size, scale, shapeHitPx));

  handles.forEach((handle, i) => {
    const spec = specs[i];

    handle.on('dragstart', () => pushHistory());

    handle.on('dragmove', (ev) => {
      // The opposite corner (or the other end of a line) stays put; this
      // handle's own position follows the pointer, snapped to the grid.
      const fixedX = spec.px === 'x1' ? s.x2 : s.x1;
      const fixedY = spec.py === 'y1' ? s.y2 : s.y1;
      const end = constrainShapeEnd(s.type, fixedX, fixedY, snapToGrid(handle.x(), SHAPE_SNAP), snapToGrid(handle.y(), SHAPE_SNAP), !!(ev.evt && ev.evt.shiftKey));

      s[spec.px] = end.x;
      s[spec.py] = end.y;
      handle.position({ x: end.x, y: end.y });

      // Every other handle tracks its own coordinates, so they stay on the corners.
      handles.forEach((other, j) => {
        if (other !== handle) other.position({ x: s[specs[j].px], y: s[specs[j].py] });
      });

      updateShapeNode(bodyNode, s);
      shapeLayer.batchDraw();
      shapeHandleLayer.batchDraw();
    });

    handle.on('dragend', () => {
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    shapeHandleLayer.add(handle);
  });
}

// ==========================================
// INSERTED IMAGES
// ==========================================
// An image lives on its sheet as sheet.images = [{ id, src, x, y, width,
// height, rotation, naturalWidth, naturalHeight }]. (x, y) is its top-left
// corner BEFORE rotation is applied (Konva's own rotation-around-origin
// convention — the same one components already use); naturalWidth/Height are
// the file's own pixel dimensions, kept so resizing can always stay
// proportional to the original, not to whatever size it happens to be at the
// moment of a later resize (which would drift over repeated resizes).
const MIN_IMAGE_SIZE = 20; // never shrink smaller than this, in sheet units

// Loaded native <img> elements, one per inserted image, kept so redrawing the
// sheet (which happens on nearly every interaction) doesn't redecode the same
// base64 data over and over — a noticeable stutter with more than one or two
// images on a busy sheet. An image's src never changes after it's inserted
// (there's no "replace image"), so caching by id for the life of the session
// is safe with no invalidation to worry about.
const imageElementCache = new Map();

function getCachedImageElement(imgEntry, onReady) {
  let el = imageElementCache.get(imgEntry.id);
  if (el && el.complete && el.naturalWidth > 0) { onReady(el); return; }
  if (!el) {
    el = new window.Image();
    imageElementCache.set(imgEntry.id, el);
    el.src = imgEntry.src;
  }
  el.onload = () => onReady(el);
}

function selectOnlyImage(id) {
  clearMainRubberBandSelection();
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  state.selectedTextId = null;
  state.selectedCableMarkerId = null;
  state.selectedShapeId = null;
  state.selectedTerminalLinkId = null;
  state.selectedImageId = id;
}

// Reads a File (from the Insert Image picker) and adds it to the active
// sheet: centred in the current viewport, sized to fit within a reasonable
// footprint while keeping its own proportions, selected and ready to
// reposition or resize straight away.
export function insertImageFromFile(file, renderCallback) {
  if (!file || !file.type || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const probe = new window.Image();
    probe.onload = () => {
      const sheet = getActiveSheet();
      if (!sheet) return;
      if (!sheet.images) sheet.images = [];

      const MAX_DIM = 300; // a sensible starting size — never dominate the sheet on insert
      const fitScale = Math.min(1, MAX_DIM / probe.naturalWidth, MAX_DIM / probe.naturalHeight);
      // Not snapped to the grid — snapping width and height independently
      // can round each to a different degree and skew the aspect ratio
      // (e.g. a 2:1 image landing at 300x160 instead of 300x150). Resizing
      // afterward doesn't snap the size either, only the position — this
      // keeps insert consistent with that.
      const width = Math.max(MIN_IMAGE_SIZE, probe.naturalWidth * fitScale);
      const height = Math.max(MIN_IMAGE_SIZE, probe.naturalHeight * fitScale);

      // Centred on the current viewport, in sheet coordinates, so it lands
      // wherever the person is actually looking rather than always at a
      // fixed spot that might be off-screen or already crowded.
      const scale = stage.scaleX() || 1;
      const viewCenterX = (stage.width() / 2 - stage.x()) / scale;
      const viewCenterY = (stage.height() / 2 - stage.y()) / scale;

      const id = Date.now();
      pushHistory();
      sheet.images.push({
        id, src, rotation: 0,
        x: snapToGrid(viewCenterX - width / 2), y: snapToGrid(viewCenterY - height / 2),
        width, height, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight
      });
      selectOnlyImage(id);
      state.currentTool = 'select';
      if (typeof renderCallback === 'function') renderCallback();
      scheduleAutosave();
    };
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

export function deleteSelectedImage(renderCallback) {
  if (state.selectedImageId === null) return;
  const sheet = getActiveSheet();
  const exists = (sheet?.images || []).some(im => im.id === state.selectedImageId);
  if (exists) {
    pushHistory();
    sheet.images = sheet.images.filter(im => im.id !== state.selectedImageId);
  }
  state.selectedImageId = null;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

export function rotateSelectedImage(renderCallback) {
  if (state.selectedImageId === null) return;
  const sheet = getActiveSheet();
  const img = (sheet?.images || []).find(im => im.id === state.selectedImageId);
  if (!img) return;
  pushHistory();
  img.rotation = ((img.rotation || 0) + 90) % 360;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

// Which local corner (as a fraction of width/height) each resize handle
// represents, and which corner stays fixed while it's dragged (the opposite one).
const IMAGE_HANDLE_SPECS = [
  { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 1, cy: 1 }, { cx: 0, cy: 1 }
];

// Pure geometry: given an image's CURRENT width/height/rotation, which corner
// is being dragged (spec, a fraction of width/height — 0 or 1 on each axis),
// where the pointer is NOW in the group's own local (rotated) frame, and the
// image's natural aspect ratio, works out the new width/height and how far
// the image's world-space (x, y) needs to shift so the OPPOSITE corner stays
// exactly where it was. Separated from the Konva event handling below so the
// rotation math — the one part of this genuinely easy to get subtly wrong —
// can be tested directly with plain numbers, no canvas involved.
export function computeImageResize(img, spec, localX, localY, aspectRatio) {
  const fixedX = (1 - spec.cx) * img.width, fixedY = (1 - spec.cy) * img.height; // the opposite corner, before this drag
  let newW = Math.max(MIN_IMAGE_SIZE, Math.abs(localX - fixedX));
  let newH = Math.max(MIN_IMAGE_SIZE, Math.abs(localY - fixedY));
  // Proportional to the image's ORIGINAL dimensions, not its current size —
  // keeps the ratio stable over many resizes rather than compounding
  // rounding drift. Driven by whichever dimension the drag moved further, so
  // it tracks the pointer naturally in either direction.
  if (newW / newH > aspectRatio) newW = newH * aspectRatio; else newH = newW / aspectRatio;

  // The image's local origin (0,0) needs to move whenever the fixed corner
  // isn't already at 0,0 — e.g. dragging the top-left handle means the
  // ORIGIN moves while the bottom-right corner stays put. (newLocalX0,
  // newLocalY0) is exactly that new origin, in the group's own (rotated)
  // local frame; rotating it back into world space gives the actual shift
  // to apply to the group's (and the data's) x/y.
  const newLocalX0 = spec.cx === 0 ? fixedX - newW : fixedX;
  const newLocalY0 = spec.cy === 0 ? fixedY - newH : fixedY;
  const rad = ((img.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const worldDX = newLocalX0 * cos - newLocalY0 * sin;
  const worldDY = newLocalX0 * sin + newLocalY0 * cos;

  return { width: newW, height: newH, worldDX, worldDY };
}

function addImageResizeHandles(img, group, openEditModalCallback) {
  const scale = stage.scaleX() || 1;
  const size = 9 / scale;
  const aspectRatio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : img.width / img.height;

  // The handles live in a group that sits exactly where the image does (same corner, same turn), so
  // their positions below are simply fractions of the image's own width and height. Added bare to the
  // top layer they sat at the sheet's own top-left corner instead, nowhere near an image placed elsewhere.
  const handleGroup = new Konva.Group({ name: 'imageHandle', x: img.x, y: img.y, rotation: img.rotation || 0 });
  const handles = IMAGE_HANDLE_SPECS.map(spec => new Konva.Rect({
    name: 'imageHandleBox',
    x: spec.cx * img.width, y: spec.cy * img.height,
    width: size, height: size, offsetX: size / 2, offsetY: size / 2,
    fill: '#ffffff', stroke: '#2563eb', strokeWidth: 1.5 / scale, draggable: true
  }));
  const imageHitPx = Math.min(HANDLE_HIT_PX, Math.max(12, Math.min(img.width, img.height) * scale * 0.4));
  handles.forEach(h => enlargeHandleHit(h, size, scale, imageHitPx));

  handles.forEach((handle, i) => {
    const spec = IMAGE_HANDLE_SPECS[i];

    handle.on('dragstart', () => pushHistory());

    handle.on('dragmove', () => {
      // Read in the GROUP's own local (unrotated, unscaled) coordinate
      // system — Konva does the rotation math, so dragging works exactly the
      // same whichever way the image is turned.
      const local = group.getRelativePointerPosition();
      if (!local) return;

      const result = computeImageResize(img, spec, local.x, local.y, aspectRatio);
      img.width = result.width;
      img.height = result.height;
      img.x = snapToGrid(group.x() + result.worldDX);
      img.y = snapToGrid(group.y() + result.worldDY);

      group.position({ x: img.x, y: img.y });
      handleGroup.position({ x: img.x, y: img.y });
      handles.forEach((other, j) => other.position({ x: IMAGE_HANDLE_SPECS[j].cx * img.width, y: IMAGE_HANDLE_SPECS[j].cy * img.height }));
      const imgNode = group.findOne('.imageBody');
      if (imgNode) imgNode.size({ width: img.width, height: img.height });
      const outline = group.findOne('.imageSelectionOutline');
      if (outline) outline.size({ width: img.width, height: img.height });

      imageLayer.batchDraw();
      shapeHandleLayer.batchDraw();
    });

    handle.on('dragend', () => {
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    handleGroup.add(handle);
  });
  shapeHandleLayer.add(handleGroup);
}

function renderSheetImages(openEditModalCallback) {
  imageLayer.destroyChildren();
  // Handles for a selected image share the same top layer as a selected
  // shape's — only one of the two is ever selected at once, so they never
  // collide, and it saves adding yet another always-on-top layer.
  shapeHandleLayer.getChildren(n => n.hasName && n.hasName('imageHandle')).forEach(n => n.destroy());

  const sheet = getActiveSheet();
  if (!sheet) return;
  if (!sheet.images) sheet.images = [];

  const interactive = state.currentTool === 'select';

  sheet.images.forEach(img => {
    const isSelected = state.selectedImageId === img.id;

    const group = new Konva.Group({
      name: 'sheetImage', x: img.x, y: img.y, rotation: img.rotation || 0,
      draggable: interactive, listening: interactive
    });

    getCachedImageElement(img, (el) => {
      const imgNode = new Konva.Image({ name: 'imageBody', image: el, x: 0, y: 0, width: img.width, height: img.height });
      group.add(imgNode);
      imgNode.moveToBottom();
      imageLayer.batchDraw();
    });

    if (isSelected) {
      group.add(new Konva.Rect({
        name: 'imageSelectionOutline', x: 0, y: 0, width: img.width, height: img.height,
        stroke: '#2563eb', strokeWidth: 1.5 / (stage.scaleX() || 1), dash: [5, 4], listening: false
      }));
    }

    group.on('click tap', (ev) => {
      ev.cancelBubble = true;
      selectOnlyImage(img.id);
      renderComponents(openEditModalCallback);
    });

    group.on('dragstart', () => pushHistory());

    group.on('dragend', () => {
      img.x = snapToGrid(group.x());
      img.y = snapToGrid(group.y());
      group.position({ x: img.x, y: img.y });
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    imageLayer.add(group);
    if (isSelected && interactive) addImageResizeHandles(img, group, openEditModalCallback);
  });

  imageLayer.batchDraw();
  shapeHandleLayer.batchDraw();
}

function renderSheetShapes(openEditModalCallback) {
  shapeLayer.destroyChildren();
  // Only ITS OWN handles/hints — shapeHandleLayer is shared with an inserted
  // image's resize handles (see renderSheetImages), and a blanket
  // destroyChildren() here would wipe those out whenever this runs after them.
  shapeHandleLayer.getChildren(n => n.hasName && (n.hasName('shapeHandle') || n.hasName('linkHint') || n.hasName('linkPreview'))).forEach(n => n.destroy());
  linkPreview = null; // destroyed with the rest of that layer; the next pointer move makes a new one

  const sheet = getActiveSheet();
  if (!sheet) return;
  if (!sheet.shapes) sheet.shapes = []; // sheets saved before shapes existed

  // Only clickable/draggable in Select mode. Under any other tool (wire,
  // terminal, text, a shape tool...) they're click-through, so drawing or
  // placing on top of a boundary line works exactly as it does on blank sheet.
  const interactive = state.currentTool === 'select';
  let selectedShape = null;

  sheet.shapes.forEach(s => {
    const isSelected = state.selectedShapeId === s.id;
    if (isSelected) selectedShape = s;

    // A location boundary is drawn in a distinct colour (its own line
    // style is still whatever the person picked via the shape-style
    // dropdown, same as any other annotation shape — only the colour marks
    // it out as a location, not forced dashing) with a small "+ABBR" label
    // at its top-left corner.
    const locExtra = (s.locationId && !isSelected) ? { stroke: '#0891b2' } : {};
    const node = createShapeNode(s, isSelected, { name: 'annotationShape', listening: interactive, draggable: interactive, ...locExtra });
    const startX = node.x(), startY = node.y(); // a line's node sits at 0,0 (points are absolute); a rect/ellipse's sits at its own position

    node.on('click tap', (ev) => {
      ev.cancelBubble = true;
      if (s.type === 'arrow' && isArrowDoubleClick(s.id)) { selectOnlyShape(s.id); openArrowNoteEditor(s.id, () => renderComponents(openEditModalCallback)); return; }
      selectOnlyShape(s.id);
      renderComponents(openEditModalCallback);
    });

    node.on('dragstart', () => {
      pushHistory();
      selectOnlyShape(s.id);
      shapeHandleLayer.destroyChildren(); // handles would be left behind while the body moves
      shapeHandleLayer.batchDraw();
    });

    node.on('dragend', () => {
      const dx = snapToGrid(node.x() - startX, SHAPE_SNAP), dy = snapToGrid(node.y() - startY, SHAPE_SNAP);
      s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy;
      renderComponents(openEditModalCallback);
      scheduleAutosave();
    });

    shapeLayer.add(node);
    if (s.type === 'arrow') {
      renderArrowNote(s, isSelected, interactive, openEditModalCallback);
    }
    if (s.locationId) {
      const loc = findLocationById(s.locationId);
      if (loc) {
        const b = shapeBox(s);
        const labelColor = isSelected ? SHAPE_COLOR_SELECTED : '#0891b2';
        shapeLayer.add(new Konva.Text({
          x: b.x + 4, y: b.y - 14, text: `+${loc.abbreviation}`, fontSize: 11, fontStyle: 'bold',
          fill: labelColor, listening: false, name: 'annotationShape'
        }));
        // The description, if there is one, printed small inside the box
        // itself — the abbreviation above the top edge is the quick-glance
        // label; this is the fuller detail for anyone actually reading the
        // drawing closely.
        if (loc.description) {
          shapeLayer.add(new Konva.Text({
            x: b.x + 4, y: b.y + 4, width: Math.max(0, b.w - 8), text: loc.description, fontSize: 9,
            fontStyle: 'italic', fill: labelColor, listening: false, name: 'annotationShape'
          }));
        }
      }
    }
    if (isSelected && interactive) addShapeHandles(s, node, openEditModalCallback);
  });

  renderTerminalLinks(sheet, interactive, openEditModalCallback);
  renderTerminalLinkHints(sheet);

  // Keep the ribbon's style dropdown showing the selected shape's style (or,
  // with nothing selected, the style the next shape will be drawn with).
  const styleSelect = document.getElementById('shapeStyleSelect');
  if (styleSelect) styleSelect.value = selectedShape ? selectedShape.style : state.shapeStyle;
  const arrowSrc = selectedShape && selectedShape.type === 'arrow' ? arrowNormalised(selectedShape) : state.arrowStyle;
  [['arrowHeadSelect', arrowSrc.headStyle], ['arrowEndsSelect', arrowSrc.head], ['arrowWeightSelect', String(arrowSrc.weight)], ['arrowSizeSelect', String(arrowSrc.headSize)]].forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });

  shapeLayer.batchDraw();
  shapeHandleLayer.batchDraw();
}

// ---- Arrow notes ----
const NOTE_PAD = 5, NOTE_MAX_LEN = 500;
export const NOTE_FONTS = ['Arial, sans-serif', "'Segoe UI', sans-serif", "'Times New Roman', serif", 'Georgia, serif', "'Courier New', monospace", 'Verdana, sans-serif'];
export const NOTE_COLOURS = ['#0f172a', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#64748b'];

// A note's look, from whatever its arrow carries (anything missing or out of range falls back to the default).
export function arrowNoteLook(s) {
  const size = Number(s.noteSize);
  return {
    font: NOTE_FONTS.includes(s.noteFont) ? s.noteFont : NOTE_FONTS[0],
    size: Number.isFinite(size) ? Math.min(72, Math.max(6, Math.round(size))) : 12,
    bold: !!s.noteBold, italic: !!s.noteItalic, underline: !!s.noteUnderline,
    colour: NOTE_COLOURS.includes(s.noteColor) ? s.noteColor : NOTE_COLOURS[0],
    box: s.noteBox !== false
  };
}

// Where the note box's top-left corner sits: where the person dragged it, or by default just beyond the
// arrow's first point (the tail), on the side away from the arrowhead.
export function arrowNotePosition(s, boxW, boxH) {
  if (Number.isFinite(s.noteDx) && Number.isFinite(s.noteDy)) return { x: s.x1 + s.noteDx, y: s.y1 + s.noteDy };
  const dx = s.x1 - s.x2, dy = s.y1 - s.y2, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const reach = 6 + Math.abs(ux) * boxW / 2 + Math.abs(uy) * boxH / 2;
  return { x: s.x1 + ux * reach - boxW / 2, y: s.y1 + uy * reach - boxH / 2 };
}

// Two quick clicks on the same arrow (or its note) open the note editor. Konva's own double-click is lost
// here: the first click redraws the sheet, so the second one lands on a new node.
let lastArrowClick = { id: null, time: 0 };
function isArrowDoubleClick(id) {
  const now = Date.now();
  const dbl = lastArrowClick.id === id && now - lastArrowClick.time < 400;
  lastArrowClick = dbl ? { id: null, time: 0 } : { id, time: now };
  return dbl;
}

function renderArrowNote(s, isSelected, interactive, openEditModalCallback) {
  const note = typeof s.note === 'string' ? s.note.trim().slice(0, NOTE_MAX_LEN) : '';
  if (!note) return;
  const colour = isSelected ? SHAPE_COLOR_SELECTED : SHAPE_COLOR;
  const look = arrowNoteLook(s);
  const maxW = Math.max(170, look.size * 14); // wraps at a width that grows with the font size
  const styleParts = [look.bold ? 'bold' : '', look.italic ? 'italic' : ''].filter(Boolean);
  const text = new Konva.Text({
    text: note, fontSize: look.size, fontFamily: look.font, fontStyle: styleParts.length ? styleParts.join(' ') : 'normal',
    textDecoration: look.underline ? 'underline' : '', fill: isSelected ? SHAPE_COLOR_SELECTED : look.colour, padding: NOTE_PAD, lineHeight: 1.2
  });
  let w = Number(text.width()), h = Number(text.height());
  if (!Number.isFinite(w) || w <= 0) { w = Math.min(maxW, look.size * 0.6 * Math.max(...note.split('\n').map(l => l.length)) + 2 * NOTE_PAD); h = look.size * 1.2 + 2 * NOTE_PAD; }
  if (w > maxW) { text.width(maxW); w = maxW; h = Number(text.height()) || h; }
  const pos = arrowNotePosition(s, w, h);

  // A leader from the arrow's tail to the note, only once the note has been dragged clear of it.
  const nearX = Math.max(pos.x, Math.min(s.x1, pos.x + w)), nearY = Math.max(pos.y, Math.min(s.y1, pos.y + h));
  if (Number.isFinite(s.noteDx) && Math.hypot(nearX - s.x1, nearY - s.y1) > 6) {
    shapeLayer.add(new Konva.Line({ points: [s.x1, s.y1, nearX, nearY], stroke: colour, strokeWidth: 1, dash: [3, 3], listening: false, name: 'annotationShape' }));
  }

  const group = new Konva.Group({ x: pos.x, y: pos.y, name: 'annotationShape arrowNote', listening: interactive, draggable: interactive });
  group.add(new Konva.Rect({ width: w, height: h, fill: look.box ? '#ffffff' : 'transparent', stroke: look.box ? colour : (isSelected ? colour : undefined), strokeWidth: look.box ? 1 : 0.75, dash: !look.box && isSelected ? [3, 3] : undefined, cornerRadius: 2 }));
  group.add(text);
  group.on('click tap', (ev) => {
    ev.cancelBubble = true;
    if (isArrowDoubleClick(s.id)) { selectOnlyShape(s.id); openArrowNoteEditor(s.id, () => renderComponents(openEditModalCallback)); return; }
    selectOnlyShape(s.id);
    renderComponents(openEditModalCallback);
  });
  group.on('dragstart', () => { pushHistory(); selectOnlyShape(s.id); });
  group.on('dragend', () => {
    s.noteDx = Math.round(group.x() - s.x1);
    s.noteDy = Math.round(group.y() - s.y1);
    renderComponents(openEditModalCallback);
    scheduleAutosave();
  });
  shapeLayer.add(group);
}

let arrowNoteEditId = null, arrowNoteRender = null;

export function openArrowNoteEditor(id, renderCallback) {
  const sheet = getActiveSheet();
  const a = (sheet?.shapes || []).find(x => x.id === id && x.type === 'arrow');
  const modal = document.getElementById('arrowNoteModal');
  if (!a || !modal) return;
  arrowNoteEditId = id;
  arrowNoteRender = renderCallback || null;
  const box = document.getElementById('arrowNoteText');
  box.value = a.note || '';
  // A note that has none yet starts from the look last used; an existing one shows its own.
  const look = a.note ? arrowNoteLook(a) : arrowNoteLook({ noteFont: state.arrowNoteStyle.font, noteSize: state.arrowNoteStyle.size, noteBold: state.arrowNoteStyle.bold,
    noteItalic: state.arrowNoteStyle.italic, noteUnderline: state.arrowNoteStyle.underline, noteColor: state.arrowNoteStyle.colour, noteBox: state.arrowNoteStyle.box });
  document.getElementById('arrowNoteFont').value = look.font;
  document.getElementById('arrowNoteSize').value = look.size;
  document.getElementById('arrowNoteColor').value = look.colour;
  document.getElementById('arrowNoteBox').checked = look.box;
  ['bold', 'italic', 'underline'].forEach(k => setArrowNoteStyleButton(k, look[k]));
  const an = arrowNormalised(a);
  [['arrowNoteHeadStyle', an.headStyle], ['arrowNoteHeadEnds', an.head], ['arrowNoteWeight', String(an.weight)], ['arrowNoteHeadSize', String(an.headSize)]].forEach(([i, v]) => {
    const el = document.getElementById(i); if (el) el.value = v;
  });
  document.getElementById('arrowNoteRemove').style.display = a.note ? '' : 'none';
  modal.style.display = 'flex';
  setTimeout(() => box.focus(), 0);
}

// The ribbon's "Arrow note" button: edits the note on the selected arrow.
export function editSelectedArrowNote(renderCallback) {
  const sheet = getActiveSheet();
  const a = state.selectedShapeId !== null ? (sheet?.shapes || []).find(x => x.id === state.selectedShapeId && x.type === 'arrow') : null;
  if (!a) { window.alert('Click an arrow first, then choose Arrow note. (You can also double-click an arrow.)'); return; }
  openArrowNoteEditor(a.id, renderCallback);
}

const ARROW_NOTE_STYLE_BUTTONS = { bold: 'arrowNoteBold', italic: 'arrowNoteItalic', underline: 'arrowNoteUnderline' };
function setArrowNoteStyleButton(key, on) {
  const el = document.getElementById(ARROW_NOTE_STYLE_BUTTONS[key]);
  if (el) el.classList.toggle('btn-primary', !!on);
}
function arrowNoteStyleButtonOn(key) {
  const el = document.getElementById(ARROW_NOTE_STYLE_BUTTONS[key]);
  return !!(el && el.classList.contains('btn-primary'));
}
export function toggleArrowNoteStyle(key) {
  if (ARROW_NOTE_STYLE_BUTTONS[key]) setArrowNoteStyleButton(key, !arrowNoteStyleButtonOn(key));
}

export function closeArrowNoteEditor() {
  const modal = document.getElementById('arrowNoteModal');
  if (modal) modal.style.display = 'none';
  arrowNoteEditId = null;
}

export function saveArrowNote(remove) {
  const sheet = getActiveSheet();
  const a = (sheet?.shapes || []).find(x => x.id === arrowNoteEditId && x.type === 'arrow');
  if (a) {
    const next = remove ? '' : String(document.getElementById('arrowNoteText').value || '').trim().slice(0, NOTE_MAX_LEN);
    const fmt = {
      noteFont: document.getElementById('arrowNoteFont').value,
      noteSize: Math.min(72, Math.max(6, Math.round(Number(document.getElementById('arrowNoteSize').value) || 12))),
      noteColor: document.getElementById('arrowNoteColor').value,
      noteBold: arrowNoteStyleButtonOn('bold'), noteItalic: arrowNoteStyleButtonOn('italic'), noteUnderline: arrowNoteStyleButtonOn('underline'),
      noteBox: document.getElementById('arrowNoteBox').checked
    };
    // Arrow look (shared with the ribbon dropdowns): applies even when the note is empty or removed.
    const an = arrowNormalised(a);
    const look = {
      headStyle: document.getElementById('arrowNoteHeadStyle').value,
      head: document.getElementById('arrowNoteHeadEnds').value,
      weight: Number(document.getElementById('arrowNoteWeight').value),
      headSize: Number(document.getElementById('arrowNoteHeadSize').value)
    };
    const lookOk = ARROW_HEADS.includes(look.headStyle) && ARROW_ENDS.includes(look.head) && ARROW_WEIGHTS.includes(look.weight) && ARROW_HEAD_SIZES.includes(look.headSize);
    const lookChanged = lookOk && Object.keys(look).some(k => an[k] !== look[k]);
    const fmtKeys = Object.keys(fmt);
    const changed = next !== (a.note || '') || (next && fmtKeys.some(k => (a[k] === undefined ? (k === 'noteBox' ? true : (k === 'noteSize' ? 12 : (k === 'noteFont' ? NOTE_FONTS[0] : (k === 'noteColor' ? NOTE_COLOURS[0] : false)))) : a[k]) !== fmt[k]));
    if (changed || lookChanged) {
      pushHistory();
      if (lookChanged) { Object.assign(a, look); Object.assign(state.arrowStyle, look); }
      if (!changed) { /* arrow look only */ }
      else if (next) {
        a.note = next;
        Object.assign(a, fmt);
        state.arrowNoteStyle = { font: fmt.noteFont, size: fmt.noteSize, bold: fmt.noteBold, italic: fmt.noteItalic, underline: fmt.noteUnderline, colour: fmt.noteColor, box: fmt.noteBox };
      } else { delete a.note; delete a.noteDx; delete a.noteDy; fmtKeys.forEach(k => delete a[k]); }
      scheduleAutosave();
    }
  }
  const cb = arrowNoteRender;
  closeArrowNoteEditor();
  if (typeof cb === 'function') cb();
}

// The ribbon's arrow dropdowns: change the selected arrow, and set what the next one is drawn with.
export function setArrowOption(key, value, renderCallback) {
  const ok = (key === 'headStyle' && ARROW_HEADS.includes(value)) || (key === 'head' && ARROW_ENDS.includes(value))
    || (key === 'weight' && ARROW_WEIGHTS.includes(Number(value))) || (key === 'headSize' && ARROW_HEAD_SIZES.includes(Number(value)));
  if (!ok) return;
  const v = (key === 'weight' || key === 'headSize') ? Number(value) : value;
  state.arrowStyle[key] = v;
  const sheet = getActiveSheet();
  const a = state.selectedShapeId !== null ? (sheet?.shapes || []).find(x => x.id === state.selectedShapeId && x.type === 'arrow') : null;
  if (a && a[key] !== v) { pushHistory(); a[key] = v; scheduleAutosave(); }
  if (typeof renderCallback === 'function') renderCallback();
}

export function deleteSelectedShape(renderCallback) {
  if (state.selectedShapeId === null) return;
  const sheet = getActiveSheet();
  const exists = (sheet?.shapes || []).some(s => s.id === state.selectedShapeId);
  if (exists) {
    pushHistory();
    sheet.shapes = sheet.shapes.filter(s => s.id !== state.selectedShapeId);
  }
  state.selectedShapeId = null; // also clears a stale selection (e.g. one left over from another sheet)
  state.selectedImageId = null;
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

// ==========================================
// TERMINAL LINKS — "these terminals are physically joined"
// ==========================================
// The geometry and data live in 10_terminal_links.js; this is the tool and the drawing.
const LINK_COLOUR = '#0f172a', LINK_COLOUR_SELECTED = '#2563eb', LINK_WIDTH = 1; // matches an unselected wire's own stroke width

let linkPickId = null;   // the first terminal chosen by the Link tool, waiting for the second
let linkPreview = null;  // the line from that terminal to the pointer

// Links sit in the shape layer: under the wires and the terminals themselves,
// so the terminal circles read as the two ends of one bar. Clickable only in
// Select mode, like the annotation shapes.
function renderTerminalLinks(sheet, interactive, openEditModalCallback) {
  pruneTerminalLinks(sheet); // a terminal deleted (or undone away) takes its links with it
  const routes = getAllTerminalLinkRoutes(sheet);
  (sheet.terminalLinks || []).forEach(link => {
    const route = routes.get(link.id);
    if (!route) return;
    const isSelected = state.selectedTerminalLinkId === link.id;
    const line = new Konva.Line({
      points: route, stroke: isSelected ? LINK_COLOUR_SELECTED : LINK_COLOUR, strokeWidth: LINK_WIDTH,
      lineCap: 'round', lineJoin: 'round', hitStrokeWidth: 12, name: 'terminalLink', listening: interactive
    });
    line.on('click tap', (ev) => {
      ev.cancelBubble = true;
      selectOnlyTerminalLink(link.id);
      renderComponents(openEditModalCallback);
    });
    shapeLayer.add(line);
  });
}

// While the Link tool is waiting for its second terminal: a ring round the one
// already chosen, and a dashed ring on every other terminal carrying the same
// number — the ones most likely to be the other half.
function renderTerminalLinkHints(sheet) {
  if (state.currentTool !== 'link') linkPickId = null; // however the tool was left, a half-made link doesn't outlive it
  if (linkPickId === null) return;
  const terminals = getTerminals(sheet);
  const pick = terminals.find(t => t.id === linkPickId);
  if (!pick) { linkPickId = null; return; } // e.g. the terminal is on another sheet, or was deleted
  const pickNumber = getTerminalEffectiveId(pick, sheet);
  terminals.forEach(t => {
    const isPick = t.id === pick.id;
    const sameNumber = !isPick && pickNumber && getTerminalEffectiveId(t, sheet) === pickNumber && !findTerminalLink(sheet, pick.id, t.id);
    if (!isPick && !sameNumber) return;
    shapeHandleLayer.add(new Konva.Circle({
      name: 'linkHint',
      x: t.x, y: t.y, radius: 8, stroke: isPick ? '#2563eb' : '#f59e0b', strokeWidth: 1.5,
      dash: isPick ? undefined : [3, 2], listening: false
    }));
  });
}

function selectOnlyTerminalLink(id) {
  clearMainRubberBandSelection();
  state.selectedComponentId = null;
  state.selectedWireIndex = null;
  state.selectedTextId = null;
  state.selectedCableMarkerId = null;
  state.selectedShapeId = null;
  state.selectedImageId = null;
  state.selectedTerminalLinkId = id;
}

// Drops a half-made link (the first terminal picked, the line following the pointer).
export function cancelTerminalLinkPick() {
  linkPickId = null;
  if (linkPreview) { linkPreview.destroy(); linkPreview = null; shapeHandleLayer.batchDraw(); }
}

export function deleteSelectedTerminalLink(renderCallback) {
  if (state.selectedTerminalLinkId === null) return;
  const sheet = getActiveSheet();
  const exists = (sheet?.terminalLinks || []).some(l => l.id === state.selectedTerminalLinkId);
  if (exists) {
    pushHistory();
    sheet.terminalLinks = sheet.terminalLinks.filter(l => l.id !== state.selectedTerminalLinkId);
  }
  state.selectedTerminalLinkId = null; // also clears a stale selection (e.g. one left over from another sheet)
  if (typeof renderCallback === 'function') renderCallback();
  scheduleAutosave();
}

// The ribbon's line-style dropdown. Restyles the selected shape, if any, and
// also becomes the style new shapes are drawn with.
export function setShapeStyle(style, renderCallback) {
  if (!SHAPE_STYLES.includes(style)) return;
  state.shapeStyle = style;

  const sheet = getActiveSheet();
  const selected = state.selectedShapeId !== null ? (sheet?.shapes || []).find(s => s.id === state.selectedShapeId) : null;
  if (selected && selected.style !== style) {
    pushHistory();
    selected.style = style;
    scheduleAutosave();
  }
  if (typeof renderCallback === 'function') renderCallback();
}

// Shape drawing in progress: the shape as it stands so far, plus the on-screen preview.
let shapeDraw = null; // { draft: { type, x1, y1, x2, y2, style }, preview }
let shapeRenderCallback = null;

export function cancelShapeDraw() {
  if (!shapeDraw) return;
  shapeDraw.preview.destroy();
  wirePreviewLayer.batchDraw();
  shapeDraw = null;
}

function finishShapeDraw() {
  if (!shapeDraw) return;
  const { draft, preview } = shapeDraw;
  shapeDraw = null;
  preview.destroy();
  wirePreviewLayer.batchDraw();

  const w = Math.abs(draft.x2 - draft.x1), h = Math.abs(draft.y2 - draft.y1);
  const degenerate = (draft.type === 'line' || draft.type === 'arrow') ? (w === 0 && h === 0) : (w === 0 || h === 0);
  if (degenerate) return; // a plain click rather than a drag — leave the tool armed for another go

  const sheet = getActiveSheet();
  if (!sheet) return;
  if (!sheet.shapes) sheet.shapes = [];

  pushHistory();
  // Unique within the sheet even if two shapes were somehow created in the same millisecond.
  let id = Date.now();
  while (sheet.shapes.some(s => s.id === id)) id++;
  const shape = { id, ...draft };
  sheet.shapes.push(shape);

  const wasLocationTool = state.currentTool === 'shape-location';
  state.currentTool = 'select'; // one shape per pick of the tool, like text boxes — and it's now selected, ready to adjust
  setCanvasCursor('');
  selectOnlyShape(shape.id);
  if (shapeRenderCallback) shapeRenderCallback();
  scheduleAutosave();

  // Prompted via window.* rather than a direct import — 5_portfolio_sheets.js
  // (where this actually lives) already imports FROM this file.
  if (wasLocationTool && typeof window.promptAndAssignLocationBoundary === 'function') {
    window.promptAndAssignLocationBoundary(shape, sheet);
  }
}

// Things that are dragged around the sheet rather than wired to: a wire's ID
// label, a component's label, and sheet text boxes. Grabbing one of these
// while the Wire tool is active is a move, not a wire click — treating it as
// one used to start or extend a wire at whatever happened to be underneath.
function isDragOnlyTarget(node) {
  for (let n = node; n && n.getParent && n.getParent(); n = n.getParent()) {
    if (n.hasName && (n.hasName('wireLabel') || n.hasName('componentLabel') || n.hasName('sheetTextBox'))) return true;
  }
  return false;
}

// The points to append when the wire in progress reaches a snap target (a pin
// or a spot on another wire). The target itself is used exactly, but if it
// isn't in line with the previous point, an elbow goes in first so the last
// segment stays horizontal/vertical like every other segment — otherwise it
// cuts a diagonal straight across the sheet.
function wireTailToSnap(lastX, lastY, snap) {
  if (lastX === snap.x || lastY === snap.y) return [snap.x, snap.y];
  const elbow = getOrthogonalPoint(lastX, lastY, snap.x, snap.y);
  return [elbow.x, elbow.y, snap.x, snap.y];
}

// ==========================================
// CROSSHAIR GUIDE
// ==========================================
// A light red horizontal/vertical guide through the pointer's SNAPPED
// position, spanning whatever's currently in view — an aid for lining up a
// new component or wire with something elsewhere on the sheet, not part of
// the drawing itself. Lives in wirePreviewLayer alongside the app's other
// temporary, on-top interactive overlays (the rubber-band box, the wire-draw
// preview), reusing its existing role rather than adding a whole new layer.
const CROSSHAIR_COLOR = '#fca5a5'; // a light, unmistakably-a-guide red — never the near-black of a real wire
let crosshairH = null, crosshairV = null;

// ==========================================
// TOOL ICON
// ==========================================
// A small label showing which tool is active, tucked just beside the
// pointer — the same icon its ribbon button uses, so there's nothing new to
// learn. Only tools that actually change what a click on the sheet DOES get
// one; Select is the ordinary, unmarked state every other tool returns to,
// so it shows nothing. Lives in wirePreviewLayer too, and tracks the RAW
// (unsnapped) pointer position rather than the crosshair's grid-snapped
// one, so it follows the cursor smoothly instead of jumping in grid steps.
const TOOL_ICONS = {
  wire: '⚡', multiwire: '⚡⚡', delete: '✂', text: '🔤', terminal: '⏺', link: '🔗', cable: '🔌', connector: '⇄', shield: '🛡️',
  'shape-line': '╱', 'shape-arrow': '➜', 'shape-rect': '▭', 'shape-ellipse': '◯', 'shape-location': '📍'
};
const TOOL_ICON_OFFSET = 14; // how far from the pointer, in screen pixels regardless of zoom
let toolIconLabel = null;

function hideToolIcon() {
  if (toolIconLabel) { toolIconLabel.destroy(); toolIconLabel = null; }
  wirePreviewLayer.batchDraw();
}

function updateToolIcon(x, y) {
  const icon = TOOL_ICONS[state.currentTool];
  if (!icon) { hideToolIcon(); return; }
  const scale = stage.scaleX() || 1;
  const offset = TOOL_ICON_OFFSET / scale;
  const fontSize = 16 / scale; // constant on screen at any zoom, like the crosshair's own stroke width

  if (!toolIconLabel) {
    toolIconLabel = new Konva.Text({ name: 'toolIconLabel', fontFamily: 'sans-serif', listening: false });
    wirePreviewLayer.add(toolIconLabel);
  }
  toolIconLabel.text(icon);
  toolIconLabel.fontSize(fontSize);
  toolIconLabel.position({ x: x + offset, y: y + offset });
  wirePreviewLayer.batchDraw();
}

function hideCrosshair() {
  if (crosshairH) { crosshairH.destroy(); crosshairH = null; }
  if (crosshairV) { crosshairV.destroy(); crosshairV = null; }
  wirePreviewLayer.batchDraw();
}

// Redraws the guide through (sheetX, sheetY) — already snapped to the grid,
// same as wherever a component or wire endpoint would actually land right
// now. Spans exactly the visible viewport at the current pan/zoom, so it's
// never longer (or shorter) than what's actually on screen.
function updateCrosshair(sheetX, sheetY) {
  if (!state.crosshairEnabled) { hideCrosshair(); return; }
  const scale = stage.scaleX() || 1;
  const viewLeft = -stage.x() / scale, viewRight = (stage.width() - stage.x()) / scale;
  const viewTop = -stage.y() / scale, viewBottom = (stage.height() - stage.y()) / scale;
  const strokeWidth = 1 / scale; // constant on screen at any zoom, like a wire's own stroke

  if (!crosshairH) {
    crosshairH = new Konva.Line({ name: 'crosshairGuide', stroke: CROSSHAIR_COLOR, listening: false });
    crosshairV = new Konva.Line({ name: 'crosshairGuide', stroke: CROSSHAIR_COLOR, listening: false });
    wirePreviewLayer.add(crosshairH, crosshairV);
  }
  crosshairH.points([viewLeft, sheetY, viewRight, sheetY]);
  crosshairH.strokeWidth(strokeWidth);
  crosshairV.points([sheetX, viewTop, sheetX, viewBottom]);
  crosshairV.strokeWidth(strokeWidth);
  wirePreviewLayer.batchDraw();
}

// Turns the guide on/off — bound to the View ribbon's Crosshair button.
export function toggleCrosshair() {
  state.crosshairEnabled = !state.crosshairEnabled;
  if (!state.crosshairEnabled) hideCrosshair();
  return state.crosshairEnabled;
}

// Switches every sheet between a filled dot at real junctions and the "hop"
// alternative (see applyNotchToWirePoints above) — a drawing-wide look, not
// a per-wire choice, so it stays consistent across a whole set of sheets.
// The caller re-renders the active sheet afterward to show the change.
// Shows or hides the wire ID labels on the wires, for the whole drawing. Hiding
// only stops them being drawn: every wire keeps its ID (still editable by
// double-clicking the wire, still used by the terminal tables and wire references).
export function toggleWireIds() {
  state.showWireIds = state.showWireIds === false;
  return state.showWireIds;
}

// Shows or hides the PLC connection under a wire's ID, for the whole drawing.
export function toggleWirePlcData() {
  state.showWirePlcData = state.showWirePlcData === false;
  return state.showWirePlcData;
}

export function toggleJunctionStyle() {
  state.junctionStyle = state.junctionStyle === 'notch' ? 'dot' : 'notch';
  return state.junctionStyle;
}

// Which way the hop dips — toward the branch, or away from it. Drawing-wide
// like the style itself, and only visible while the style is Hop.
export function toggleJunctionHopDirection() {
  state.junctionHopDirection = state.junctionHopDirection === 'away' ? 'toward' : 'away';
  return state.junctionHopDirection;
}

// Brings the two ribbon buttons into line with the settings: the labels, which
// one is lit, and the direction button greyed out while the style is Dot (there
// is no hop to turn round). Called after either toggle, and after a project is
// opened, since the settings travel with the project. That is why it is written
// to tolerate anything odd about the page (a missing button, an element with no
// class list): refreshing two buttons must never be able to stop a project from
// opening.
export function syncJunctionControls() {
  const idsBtn = document.getElementById('wireIdToggleBtn');
  if (idsBtn) idsBtn.classList?.toggle('ribbon-btn-toggled-on', state.showWireIds === false);
  const plcBtn = document.getElementById('wirePlcToggleBtn');
  if (plcBtn) plcBtn.classList?.toggle('ribbon-btn-toggled-on', state.showWirePlcData === false);
  const plcLabel = document.getElementById('wirePlcToggleLabel');
  if (plcLabel) plcLabel.innerHTML = state.showWirePlcData === false ? 'PLC data:<br>Hidden' : 'PLC data:<br>Shown';
  const idsLabel = document.getElementById('wireIdToggleLabel');
  if (idsLabel) idsLabel.innerHTML = state.showWireIds === false ? 'Wire IDs:<br>Hidden' : 'Wire IDs:<br>Shown';
  const hop = state.junctionStyle === 'notch';
  const away = state.junctionHopDirection === 'away';
  const styleBtn = document.getElementById('junctionStyleToggleBtn');
  if (styleBtn) styleBtn.classList?.toggle('ribbon-btn-toggled-on', hop);
  const styleLabel = document.getElementById('junctionStyleToggleLabel');
  if (styleLabel) styleLabel.innerHTML = hop ? 'Junction:<br>Hop' : 'Junction:<br>Dot';
  const dirBtn = document.getElementById('junctionHopDirBtn');
  if (dirBtn) {
    dirBtn.disabled = !hop;
    dirBtn.classList?.toggle('ribbon-btn-toggled-on', hop && away);
  }
  const dirLabel = document.getElementById('junctionHopDirLabel');
  if (dirLabel) dirLabel.innerHTML = away ? 'Hop:<br>Away' : 'Hop:<br>Toward';
}

// Leaves whichever tool is active and returns to Select — for Escape, on a
// tool with no in-progress gesture of its own to cancel first (Terminal,
// Delete Wire: both act on a single click, and stay armed for the next one
// afterward, with nothing to back out of before just leaving the tool).
export function exitToSelectTool(renderCallback) {
  state.currentTool = 'select';
  setCanvasCursor('');
  if (typeof renderCallback === 'function') renderCallback();
}

export function setupStageWireEvents(renderCallback) {
  shapeRenderCallback = renderCallback;

  // Always active, whatever tool is armed — unlike every other handler in
  // this function, which only does something for ITS OWN tool.
  stage.on('mousemove touchmove', () => {
    const p = snappedWorldPointer();
    if (p) updateCrosshair(p.x, p.y); else hideCrosshair();
    const raw = rawWorldPointer();
    if (raw) updateToolIcon(raw.x, raw.y); else hideToolIcon();
    updateJunctionHover(raw);
  });
  stage.on('mouseleave', hideJunctionHover);
  stage.on('mouseleave', () => { hideCrosshair(); hideToolIcon(); }); // don't leave either sitting over the ribbon/sidebar once the pointer's left the sheet

  // ---- Drawing an annotation shape: press, drag, release ----
  stage.on('mousedown touchstart', (e) => {
    const kind = shapeKindForTool(state.currentTool);
    if (!kind || shapeDraw) return;
    if (e.evt && e.evt.button > 0) return;  // left button only
    if (isMainCanvasSpaceHeld()) return;    // Space+drag pans the sheet
    if (isInsideDraggable(e.target)) return; // grabbing a component / label / text box to move it, not drawing

    const p = snappedWorldPointer();
    if (!p) return;
    const draft = { type: kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, style: state.shapeStyle };
    if (kind === 'arrow') Object.assign(draft, { head: state.arrowStyle.head, headStyle: state.arrowStyle.headStyle, headSize: state.arrowStyle.headSize, weight: state.arrowStyle.weight });
    const preview = createShapeNode(draft, true, { listening: false }); // blue while drawing, in the chosen style
    wirePreviewLayer.add(preview);
    wirePreviewLayer.batchDraw();
    shapeDraw = { draft, preview };
  });

  stage.on('mousemove touchmove', (e) => {
    if (!shapeDraw) return;
    const p = snappedWorldPointer();
    if (!p) return;
    const d = shapeDraw.draft;
    const end = constrainShapeEnd(d.type, d.x1, d.y1, p.x, p.y, !!(e.evt && e.evt.shiftKey));
    d.x2 = end.x;
    d.y2 = end.y;
    updateShapeNode(shapeDraw.preview, d);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mouseup touchend', () => finishShapeDraw());
  // Releasing outside the canvas never reaches the stage — finish there too rather than leaving a shape stuck to the cursor.
  window.addEventListener('mouseup', () => finishShapeDraw());

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !shapeKindForTool(state.currentTool)) return;
    cancelShapeDraw();
    state.currentTool = 'select';
    setCanvasCursor('');
    renderCallback(); // shapes become clickable again
  });




  stage.on('click tap', (e) => {
    if (rubberBandJustFinished) { rubberBandJustFinished = false; return; } // this click is the tail end of the drag that just selected something — not a fresh click to deselect it
    if (e.target === stage || e.target.hasName('paper-bg')) {
      state.selectedComponentId = null;
      state.selectedWireIndex = null;
      state.selectedTextId = null;
      state.selectedCableMarkerId = null;
      state.selectedShapeId = null;
      state.selectedImageId = null;
      state.selectedTerminalLinkId = null;
      clearMainRubberBandSelection();
      renderCallback();
    }
  });

  // Elastic-band multi-select: only when the 'select' tool is active, space
  // isn't held (that pans instead), and the click starts on empty canvas.
  stage.on('mousedown tap', (e) => {
    if (state.currentTool !== 'select' || isMainCanvasSpaceHeld()) return;
    if (e.target !== stage && !e.target.hasName('paper-bg')) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    const worldPos = { x: (pos.x - stage.x()) / scale, y: (pos.y - stage.y()) / scale };

    clearMainRubberBandSelection();
    state.selectedComponentId = null;
    state.selectedWireIndex = null;
    state.selectedTextId = null;
    state.selectedShapeId = null;
    state.selectedImageId = null;
    state.selectedTerminalLinkId = null;
    renderCallback();

    mainRubberBandStart = worldPos;
    mainRubberBandRect = new Konva.Rect({
      x: worldPos.x, y: worldPos.y, width: 0, height: 0,
      fill: 'rgba(37, 99, 235, 0.12)', stroke: '#2563eb', strokeWidth: 1, dash: [4, 4], listening: false
    });
    wirePreviewLayer.add(mainRubberBandRect);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mousemove', () => {
    if (!mainRubberBandStart || !mainRubberBandRect) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    const worldX = (pos.x - stage.x()) / scale, worldY = (pos.y - stage.y()) / scale;

    mainRubberBandRect.position({ x: Math.min(mainRubberBandStart.x, worldX), y: Math.min(mainRubberBandStart.y, worldY) });
    mainRubberBandRect.size({ width: Math.abs(worldX - mainRubberBandStart.x), height: Math.abs(worldY - mainRubberBandStart.y) });
    wirePreviewLayer.batchDraw();
  });

  function finishRubberBandSelect() {
    if (!mainRubberBandStart || !mainRubberBandRect) return;

    const rx1 = mainRubberBandRect.x(), ry1 = mainRubberBandRect.y();
    const rx2 = rx1 + mainRubberBandRect.width(), ry2 = ry1 + mainRubberBandRect.height();

    if (mainRubberBandRect.width() > 3 || mainRubberBandRect.height() > 3) {
      rubberBandJustFinished = true;
      const sheet = getActiveSheet();

      // A component "in" the selection box means its visual footprint
      // overlaps the box at all — not just that its single origin point
      // happens to land inside it, which excluded components whose symbol
      // was clearly visible inside the drawn box but whose own origin
      // (often an edge or corner, not the visual center) sat just outside.
      const componentIntersectsRect = (comp) => {
        const pins = getPinsForType(comp.type);
        const points = pins.length > 0 ? pins : [{ relX: 0, relY: 0 }];
        const rad = ((comp.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(p => {
          const x = comp.x + (flipSX(comp) * p.relX * cos - flipSY(comp) * p.relY * sin);
          const y = comp.y + (flipSX(comp) * p.relX * sin + flipSY(comp) * p.relY * cos);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        });
        // Always include the origin itself too, in case every pin sits to one side of it
        minX = Math.min(minX, comp.x); maxX = Math.max(maxX, comp.x);
        minY = Math.min(minY, comp.y); maxY = Math.max(maxY, comp.y);

        return minX <= rx2 && maxX >= rx1 && minY <= ry2 && maxY >= ry1;
      };

      state.rubberBandComponentIds = (sheet.components || [])
        .filter(componentIntersectsRect)
        .map(c => c.id);
      state.rubberBandTextIds = (sheet.texts || [])
        .filter(t => t.x >= rx1 && t.x <= rx2 && t.y >= ry1 && t.y <= ry2)
        .map(t => t.id);

      // A wire joins the group only if it's ENTIRELY inside the box (every
      // vertex, not just a touch) — unlike a component's generous
      // touches-at-all test. A wire is a connection: if it merely clipped the
      // edge of the box, one of its ends would be attached to something
      // outside the group, and dragging the group would rigidly drag that end
      // away and break the connection. Full containment guarantees both ends
      // (and so whatever they're attached to) are within the selected area.
      state.rubberBandWireIndices = (sheet.wires || [])
        .map((w, i) => i)
        .filter(i => {
          const pts = sheet.wires[i].points;
          if (!pts || pts.length < 4) return false;
          for (let k = 0; k < pts.length; k += 2) {
            if (pts[k] < rx1 || pts[k] > rx2 || pts[k + 1] < ry1 || pts[k + 1] > ry2) return false;
          }
          return true;
        });

      // Same reasoning as a wire, and for the same reason: a cable marker's
      // trunk is a line too, with core numbers pinned to real wire crossing
      // points along it — a partial catch would drag one end away from
      // wires that stayed behind. Full containment of both ends only.
      state.rubberBandCableMarkerIds = (sheet.cableMarkers || [])
        .filter(m => m.x1 >= rx1 && m.x1 <= rx2 && m.y1 >= ry1 && m.y1 <= ry2 && m.x2 >= rx1 && m.x2 <= rx2 && m.y2 >= ry1 && m.y2 <= ry2)
        .map(m => m.id);
    }

    mainRubberBandRect.destroy();
    mainRubberBandRect = null;
    mainRubberBandStart = null;
    wirePreviewLayer.batchDraw();
    renderCallback();
  }

  stage.on('mouseup', finishRubberBandSelect);
  // Releasing past the canvas edge never reaches the stage (mirrors the same
  // fallback for shapes above) — without this, dragging a selection box to
  // the very edge and releasing outside it left the box stuck on screen with
  // no way to finish the selection or draw another one.
  window.addEventListener('mouseup', finishRubberBandSelect);

  stage.on('mousedown tap', () => {
    if (state.currentTool !== 'cable' && state.currentTool !== 'connector') return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    // Snapped to the grid from the very first point, so the line — and the
    // crossings worked out from it — land on grid lines like everything else.
    cableDragStart = { x: snapToGrid((pos.x - stage.x()) / scale), y: snapToGrid((pos.y - stage.y()) / scale) };
    cableDragLine = new Konva.Line({
      points: [cableDragStart.x, cableDragStart.y, cableDragStart.x, cableDragStart.y],
      stroke: '#f59e0b', strokeWidth: 2, dash: [6, 3], listening: false
    });
    wirePreviewLayer.add(cableDragLine);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mousemove', () => {
    if (!cableDragStart || !cableDragLine) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    const rawX = (pos.x - stage.x()) / scale, rawY = (pos.y - stage.y()) / scale;

    // Constrained to horizontal or vertical (whichever the drag is closer
    // to) — wires here are always orthogonal, so this keeps the crossing
    // line perpendicular to them instead of an arbitrary slanted line.
    const dx = rawX - cableDragStart.x, dy = rawY - cableDragStart.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const worldX = horizontal ? snapToGrid(rawX) : cableDragStart.x;
    const worldY = horizontal ? cableDragStart.y : snapToGrid(rawY);

    cableDragLine.points([cableDragStart.x, cableDragStart.y, worldX, worldY]);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mouseup', () => {
    if (!cableDragStart || !cableDragLine) return;
    const [x1, y1, x2, y2] = cableDragLine.points();
    cableDragLine.destroy();
    cableDragLine = null;
    cableDragStart = null;
    wirePreviewLayer.batchDraw();

    if (Math.hypot(x2 - x1, y2 - y1) < 10) return; // too short — likely an accidental click

    const sheet = getActiveSheet();
    const crossedWires = findWiresCrossedByLine(sheet, x1, y1, x2, y2);
    if (crossedWires.length === 0) return;

    if (state.currentTool === 'connector') {
      if (typeof window.openConnectorModal === 'function') window.openConnectorModal(crossedWires, x1, y1, x2, y2);
    } else if (typeof window.openCableAssignmentModal === 'function') {
      window.openCableAssignmentModal(crossedWires, x1, y1, x2, y2);
    }
  });

  // Escape: drops a line mid-drag (same cleanup as a completed drag, just
  // with nothing crossed to act on) AND leaves the tool in one press —
  // matching the shape tools' own Escape, not the two-stage terminal-link one.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || (state.currentTool !== 'cable' && state.currentTool !== 'connector')) return;
    if (cableDragLine) { cableDragLine.destroy(); cableDragLine = null; cableDragStart = null; wirePreviewLayer.batchDraw(); }
    state.currentTool = 'select';
    setCanvasCursor('');
    renderCallback();
  });

  // ---- Multi-wire tool: drag across pins to pick them, then across the pins to join them to ----
  const mwPointer = () => {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const scale = stage.scaleX();
    return { x: (pos.x - stage.x()) / scale, y: (pos.y - stage.y()) / scale, scale };
  };

  // The sweep line, always dead horizontal or vertical, running from the pin it started on to the pointer.
  const mwSweepEnd = (raw) => {
    const dx = raw.x - mw.start.x, dy = raw.y - mw.start.y;
    return Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: mw.start.y } : { x: mw.start.x, y: raw.y };
  };

  const mwSweepMoved = (raw) => {
    mw.end = mwSweepEnd(raw);
    mw.line.points([mw.start.x, mw.start.y, mw.end.x, mw.end.y]);
    const sweep = pinsOnSegment(mw.pins, mw.start.x, mw.start.y, mw.end.x, mw.end.y);
    mw.sweep = sweep;
    mw.live.forEach(n => n.destroy()); mw.live = [];
    mw.preview.forEach(n => n.destroy()); mw.preview = [];
    const picking = mw.phase === 'src-drag';
    mwRings(sweep.pins, picking ? '#f59e0b' : '#2563eb', mw.live);
    if (picking) {
      mwText(sweep.pins.length >= 2 ? `${sweep.pins.length} wires` : 'Drag across the pins to wire from', mw.start.x, mw.start.y);
    } else if (sweep.pins.length === mw.src.pins.length) {
      mwText(`${sweep.pins.length} wires`, mw.start.x, mw.start.y);
      mwRoutes(mw.src.pins, mw.src.axis, sweep.pins, sweep.axis).forEach(pts => {
        const l = new Konva.Line({ points: pts, stroke: '#2563eb', strokeWidth: 2, dash: [4, 4], lineJoin: 'miter', listening: false });
        wirePreviewLayer.add(l); mw.preview.push(l);
      });
    } else {
      mwText(`${sweep.pins.length} pin${sweep.pins.length === 1 ? '' : 's'} here, need ${mw.src.pins.length}`, mw.start.x, mw.start.y);
    }
    wirePreviewLayer.batchDraw();
  };

  stage.on('mousedown tap', (e) => {
    if (state.currentTool !== 'multiwire') return;
    if (e.evt && e.evt.button > 0) { if (mw && mw.phase !== 'idle') { mwReset(); } return; }   // right-click backs out
    const raw = mwPointer();
    const sheet = getActiveSheet();
    if (!raw || !sheet) return;
    if (!mw) mwReset();
    if (mw.sheet && mw.sheet !== sheet) mwReset();   // a half-made bundle belongs to the sheet it was started on
    const waitingForDest = mw.phase === 'dest-wait';
    const src = mw.src, hints = mw.hints;
    mw.sheet = sheet;
    mw.pins = mwCollectPins(sheet);
    const near = getNearestPin(raw.x, raw.y, 15 / raw.scale);
    if (!near) { mwText('Start the drag on a pin', raw.x, raw.y); return; }
    mw.start = { x: near.x, y: near.y };
    mw.end = { x: near.x, y: near.y };
    mw.phase = waitingForDest ? 'dest-drag' : 'src-drag';
    mw.src = src; mw.hints = hints;
    if (mw.line) mw.line.destroy();
    mw.line = new Konva.Line({
      points: [near.x, near.y, near.x, near.y], stroke: waitingForDest ? '#2563eb' : '#f59e0b',
      strokeWidth: 2, dash: [6, 3], listening: false
    });
    wirePreviewLayer.add(mw.line);
    mwSweepMoved({ x: near.x, y: near.y });
  });

  stage.on('mousemove touchmove', () => {
    if (state.currentTool !== 'multiwire' || !mw || (mw.phase !== 'src-drag' && mw.phase !== 'dest-drag')) return;
    const raw = mwPointer();
    if (raw) mwSweepMoved(raw);
  });

  const finishMultiWire = () => {
    if (state.currentTool !== 'multiwire' || !mw || (mw.phase !== 'src-drag' && mw.phase !== 'dest-drag')) return;
    const sheet = getActiveSheet();
    const sweep = mw.sweep || { pins: [], axis: 'h' };
    const wasSource = mw.phase === 'src-drag';
    const at = { ...mw.start };
    mw.line.destroy(); mw.line = null;
    mw.live.forEach(n => n.destroy()); mw.live = [];
    mw.preview.forEach(n => n.destroy()); mw.preview = [];

    if (wasSource) {
      if (sweep.pins.length < 2) {   // a click, or a drag over a single pin — nothing to bundle
        mw.phase = 'idle'; mwText(sweep.pins.length === 1 ? 'Drag across two or more pins' : '', at.x, at.y);
        return;
      }
      mw.src = { pins: sweep.pins, axis: sweep.axis };
      mw.phase = 'dest-wait';
      mwRings(sweep.pins, '#f59e0b', mw.hints);
      mwText(`${sweep.pins.length} wires: now drag across the pins to connect them to`, mw.src.pins[0].x, mw.src.pins[0].y);
      return;
    }

    const need = mw.src.pins.length;
    mw.phase = 'dest-wait';
    if (sweep.pins.length !== need) {
      mwText(`${sweep.pins.length} pin${sweep.pins.length === 1 ? '' : 's'} there, need ${need}. Try again`, mw.src.pins[0].x, mw.src.pins[0].y);
      return;
    }
    if (sweep.pins.some(d => mw.src.pins.some(s => Math.abs(s.x - d.x) < 1e-6 && Math.abs(s.y - d.y) < 1e-6))) {
      mwText('Those are the same pins. Drag across different ones', mw.src.pins[0].x, mw.src.pins[0].y);
      return;
    }

    if (sweep.pins.some((d, i) => d.compId === mw.src.pins[i].compId)) {   // a wire from a part back to itself is never what was meant
      mwText('A bundle needs to run between two different parts. Drag across the other end', mw.src.pins[0].x, mw.src.pins[0].y);
      return;
    }

    const routes = mwRoutes(mw.src.pins, mw.src.axis, sweep.pins, sweep.axis).filter(r => r.length >= 4);
    pushHistory();
    if (!sheet.wires) sheet.wires = [];
    const stamp = Date.now();
    addRoutesAsWires(sheet, routes, stamp);
    logWireOp('multiwire-finalized', { count: routes.length, routes: routes.map(r => [...r]) });
    sheet.wires = processWireIntersectionsAndMerges(sheet.wires, getTerminalPinPositions(sheet));
    healSheetConnections(sheet);
    mwReset();   // stays in the tool, ready for the next bundle
    renderWires();
    renderComponents(renderCallback);
  };
  stage.on('mouseup touchend', finishMultiWire);
  window.addEventListener('mouseup', finishMultiWire);   // released past the canvas edge

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.currentTool !== 'multiwire') return;
    if (mw && mw.phase !== 'idle') { mwReset(); return; }   // first Escape drops the half-made bundle...
    state.currentTool = 'select';                            // ...a second leaves the tool
    setCanvasCursor('');
    renderCallback();
  });

  // Shield tool: same drag-a-line-across-wires mechanic as Cable, but instead
  // of opening the cable-assignment modal, it builds a standalone shield
  // symbol scaled to whatever it crossed and drops a real, wired grounding
  // terminal at the drain end — no cable data involved, purely visual plus
  // one real component.
  stage.on('mousedown tap', () => {
    if (state.currentTool !== 'shield') return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    shieldDragStart = { x: snapToGrid((pos.x - stage.x()) / scale), y: snapToGrid((pos.y - stage.y()) / scale) };
    shieldDragLine = new Konva.Line({
      points: [shieldDragStart.x, shieldDragStart.y, shieldDragStart.x, shieldDragStart.y],
      stroke: '#0891b2', strokeWidth: 2, dash: [6, 3], listening: false
    });
    wirePreviewLayer.add(shieldDragLine);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mousemove', () => {
    if (!shieldDragStart || !shieldDragLine) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const scale = stage.scaleX();
    const rawX = (pos.x - stage.x()) / scale, rawY = (pos.y - stage.y()) / scale;
    const dx = rawX - shieldDragStart.x, dy = rawY - shieldDragStart.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const worldX = horizontal ? snapToGrid(rawX) : shieldDragStart.x;
    const worldY = horizontal ? shieldDragStart.y : snapToGrid(rawY);
    shieldDragLine.points([shieldDragStart.x, shieldDragStart.y, worldX, worldY]);
    wirePreviewLayer.batchDraw();
  });

  stage.on('mouseup', () => {
    if (!shieldDragStart || !shieldDragLine) return;
    const [x1, y1, x2, y2] = shieldDragLine.points();
    shieldDragLine.destroy();
    shieldDragLine = null;
    shieldDragStart = null;
    wirePreviewLayer.batchDraw();

    if (Math.hypot(x2 - x1, y2 - y1) < 10) return; // too short — likely an accidental click

    // Extended by a small margin at both ends before detecting crossings —
    // marking a shield boundary doesn't need the pixel-perfect precision
    // that assigning individual cable cores does, so a drag landing just
    // short of the first or last wire in the group shouldn't silently
    // leave it out of the symbol.
    const DRAG_MARGIN = 15;
    const dragLen = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / dragLen, uy = (y2 - y1) / dragLen;
    const ex1 = x1 - ux * DRAG_MARGIN, ey1 = y1 - uy * DRAG_MARGIN;
    const ex2 = x2 + ux * DRAG_MARGIN, ey2 = y2 + uy * DRAG_MARGIN;

    const sheet = getActiveSheet();
    const crossed = findWiresCrossedByLine(sheet, ex1, ey1, ex2, ey2);
    if (crossed.length === 0) return;

    createShieldSymbol(sheet, crossed, x1, y1, x2, y2, renderCallback);
    state.currentTool = 'select';
    setCanvasCursor('');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.currentTool !== 'shield') return;
    if (shieldDragLine) { shieldDragLine.destroy(); shieldDragLine = null; shieldDragStart = null; wirePreviewLayer.batchDraw(); }
    state.currentTool = 'select';
    setCanvasCursor('');
    renderCallback();
  });

  stage.on('mousedown tap', () => {
    if (state.currentTool !== 'text') return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scale = stage.scaleX();
    const rawX = (pos.x - stage.x()) / scale;
    const rawY = (pos.y - stage.y()) / scale;

    if (typeof window.openTextBoxModalForNew === 'function') {
      window.openTextBoxModalForNew(snapToGrid(rawX), snapToGrid(rawY));
    }
  });

  // ---- Link tool: click one terminal, then another, to show they are physically joined ----
  const worldPointer = () => {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const scale = stage.scaleX();
    return { x: (pos.x - stage.x()) / scale, y: (pos.y - stage.y()) / scale };
  };

  stage.on('mousedown tap', (e) => {
    if (state.currentTool !== 'link') return;
    if (e.evt && e.evt.button === 2) { cancelTerminalLinkPick(); renderCallback(); return; } // right-click backs out
    if (e.evt && e.evt.button !== undefined && e.evt.button !== 0) return;
    const p = worldPointer();
    const sheet = getActiveSheet();
    if (!p || !sheet) return;

    const term = findTerminalAt(sheet, p.x, p.y);
    if (!term) { // clicking away from every terminal backs out of a half-made link
      if (linkPickId !== null) { cancelTerminalLinkPick(); renderCallback(); }
      return;
    }
    if (linkPickId === null) { // the first terminal
      linkPickId = term.id;
      state.selectedTerminalLinkId = null;
      renderCallback();
      return;
    }
    if (term.id === linkPickId) { cancelTerminalLinkPick(); renderCallback(); return; } // the same one again: back out

    const existing = findTerminalLink(sheet, linkPickId, term.id);
    if (existing) {
      selectOnlyTerminalLink(existing.id); // already joined — just show which link it is
    } else {
      pushHistory();
      const result = addTerminalLink(sheet, linkPickId, term.id);
      if (result) { selectOnlyTerminalLink(result.link.id); scheduleAutosave(); } // selected, so Delete takes it straight back off
    }
    linkPickId = null;
    renderCallback();
  });

  // The line from the first terminal follows the pointer, snapping onto a terminal it's over.
  stage.on('mousemove touchmove', () => {
    if (state.currentTool !== 'link' || linkPickId === null) return;
    const p = worldPointer();
    const sheet = getActiveSheet();
    const pick = sheet && getTerminals(sheet).find(t => t.id === linkPickId);
    if (!p || !pick) return;
    const over = findTerminalAt(sheet, p.x, p.y);
    const end = over && over.id !== pick.id ? { x: over.x, y: over.y } : p;
    if (!linkPreview) {
      linkPreview = new Konva.Line({ name: 'linkPreview', stroke: '#f59e0b', strokeWidth: 2, dash: [5, 4], lineCap: 'round', listening: false });
      shapeHandleLayer.add(linkPreview);
    }
    linkPreview.points([pick.x, pick.y, end.x, end.y]);
    shapeHandleLayer.batchDraw();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.currentTool !== 'link') return;
    if (linkPickId !== null) { cancelTerminalLinkPick(); renderCallback(); return; } // first Escape drops the half-made link...
    state.currentTool = 'select'; // ...a second leaves the tool
    setCanvasCursor('');
    renderCallback();
  });

  stage.on('mousedown tap', (e) => {
    if (state.currentTool !== 'terminal') return;
    // Place a new terminal on empty canvas OR directly on a wire (the
    // normal way to drop one so it auto-snaps in) — but not on an existing
    // component, text box, or cable marker, which should reach their own
    // click handler (to select them) instead.
    const isPlaceable = e.target === stage || e.target.hasName('paper-bg') || e.target.hasName('schematicWire');
    if (!isPlaceable) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scale = stage.scaleX();
    const x = snapToGrid((pos.x - stage.x()) / scale);
    const y = snapToGrid((pos.y - stage.y()) / scale);

    const sheet = getActiveSheet();
    if (!sheet.components) sheet.components = [];

    // A terminal belongs on a block, at a position: the terminal dialog asks for
    // both, and places it when confirmed (nothing is placed if it is cancelled).
    if (typeof window.openTerminalModal === 'function') {
      window.openTerminalModal({ mode: 'place', sheet, x, y });
      return;
    }

    // No dialog available: place a plain terminal with no block yet, as it
    // always was — it can be assigned afterwards.
    const { prefix, value: val } = getPrefixAndValue('terminal');
    const formattedLabel = nextLabelForType(sheet, 'terminal');

    pushHistory();
    logWireOp('terminal-placed', { at: [x, y] });
    const newComp = {
      id: Date.now(), type: 'terminal', label: formattedLabel, value: val,
      modelNo: '', make: '', description: '', x, y, rotation: 0
    };
    sheet.components.push(newComp);
    snapComponentIntoWires(newComp, sheet, TERMINAL_TOOL_SEARCH_TOLERANCE); // wire it in automatically if placed directly onto one

    renderComponents(renderCallback);
    scheduleAutosave();
  });

  stage.on('mousedown tap', (e) => {
    if (state.currentTool !== 'wire') return;
    // Only a plain left-click (or a tap) places a wire point. Right-click is
    // how a wire gets deleted, and must not also start or extend one.
    if (e.evt && e.evt.button > 0) { logWireOp('wire-click-ignored', { reason: 'non-left button', button: e.evt.button }); return; }
    // Dragging a label or text box around isn't a wire click either.
    if (isDragOnlyTarget(e.target)) { logWireOp('wire-click-ignored', { reason: 'drag-only target (label/text box)' }); return; }

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scale = stage.scaleX();
    const rawX = (pos.x - stage.x()) / scale;
    const rawY = (pos.y - stage.y()) / scale;

    const snapTolerance = 15 / scale;
    const snapTarget = getNearestPin(rawX, rawY, snapTolerance) || getNearestWireSnap(rawX, rawY, snapTolerance);
    logWireOp('wire-click', {
      at: [Math.round(rawX), Math.round(rawY)], scale: +scale.toFixed(3),
      snap: snapTarget ? { x: snapTarget.x, y: snapTarget.y, kind: snapTarget.compId !== undefined ? 'pin' : 'wire' } : null,
      inProgress: [...state.activeWirePoints]
    });
    
    if (state.activeWirePoints.length === 0) {
      const startX = snapTarget ? snapTarget.x : snapToGrid(rawX);
      const startY = snapTarget ? snapTarget.y : snapToGrid(rawY);

      state.activeWirePoints.push(startX, startY);

      state.tempWireLine = new Konva.Line({
        points: [startX, startY, startX, startY],
        stroke: '#2563eb', strokeWidth: 2, dash: [4, 4],
        lineCap: 'round', lineJoin: 'miter'
      });
      wirePreviewLayer.add(state.tempWireLine);
      wirePreviewLayer.batchDraw();
    } else {
      const lastX = state.activeWirePoints[state.activeWirePoints.length - 2];
      const lastY = state.activeWirePoints[state.activeWirePoints.length - 1];

      if (snapTarget) {
        const tail = wireTailToSnap(lastX, lastY, snapTarget);
        // Clicking the exact point the wire is already at adds nothing — and
        // finishing on it would leave a zero-length wire.
        if (tail.length === 2 && tail[0] === lastX && tail[1] === lastY) return;
        state.activeWirePoints.push(...tail);
      } else {
        const ortho = getOrthogonalPoint(lastX, lastY, snapToGrid(rawX), snapToGrid(rawY));
        if (ortho.x === lastX && ortho.y === lastY) return;
        state.activeWirePoints.push(ortho.x, ortho.y);
      }

      if (snapTarget) {
        pushHistory();
        const sheet = getActiveSheet();
        if (!sheet.wires) sheet.wires = [];
        logWireOp('wire-finalized', { points: [...state.activeWirePoints], wireCountBefore: sheet.wires.length });

        addRoutesAsWires(sheet, [[...state.activeWirePoints]], Date.now());   // one wire, or several where it runs through a part between its ends
        sheet.wires = processWireIntersectionsAndMerges(sheet.wires, getTerminalPinPositions(sheet));
        healSheetConnections(sheet); // catch near-misses too small to see, without a second undo step

        clearWireState(false); // stay in wire mode — ready to start the next wire immediately
        renderWires();
        renderComponents(renderCallback); // Redraw canvas/cursor state
      }
    }
  });

  stage.on('mousemove', () => {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scale = stage.scaleX();
    const rawX = (pos.x - stage.x()) / scale;
    const rawY = (pos.y - stage.y()) / scale;

    const moveSnapTolerance = 15 / scale;
    const snapTarget = getNearestPin(rawX, rawY, moveSnapTolerance) || getNearestWireSnap(rawX, rawY, moveSnapTolerance);

    if (state.currentTool === 'wire') {
      if (snapTarget) {
        if (!state.pinHighlightCircle) {
          state.pinHighlightCircle = new Konva.Circle({
            radius: 8, stroke: '#2563eb', strokeWidth: 2,
            fill: 'rgba(37, 99, 235, 0.25)', listening: false
          });
          wirePreviewLayer.add(state.pinHighlightCircle);
        }
        state.pinHighlightCircle.position({ x: snapTarget.x, y: snapTarget.y });
        state.pinHighlightCircle.show();
      } else if (state.pinHighlightCircle) {
        state.pinHighlightCircle.hide();
      }
      wirePreviewLayer.batchDraw();
    }

    if (state.currentTool !== 'wire' || state.activeWirePoints.length === 0 || !state.tempWireLine) return;

    const lastX = state.activeWirePoints[state.activeWirePoints.length - 2];
    const lastY = state.activeWirePoints[state.activeWirePoints.length - 1];

    // Preview exactly what a click here would add, elbow included.
    let tail;
    if (snapTarget) {
      tail = wireTailToSnap(lastX, lastY, snapTarget);
    } else {
      const ortho = getOrthogonalPoint(lastX, lastY, snapToGrid(rawX), snapToGrid(rawY));
      tail = [ortho.x, ortho.y];
    }

    state.tempWireLine.points([...state.activeWirePoints, ...tail]);
    wirePreviewLayer.batchDraw();
  });
}