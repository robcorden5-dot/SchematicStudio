// ==========================================
// 2. MAIN STAGE INITIALIZATION & SHORTCUTS
// ==========================================
import { state, SHEET_CONFIGS, snapToGrid, getActiveSheet } from './1_config_state.js';

const container = document.getElementById('canvas-container');

export const stage = new Konva.Stage({
  container: 'canvas-container',
  width: container ? container.clientWidth : 800,
  height: container ? container.clientHeight : 600,
  draggable: false // pan requires holding Space (see isSpaceHeld below) — plain drag on
                    // empty canvas is reserved for rubber-band select instead
});

export const borderLayer = new Konva.Layer();
export const imageLayer = new Konva.Layer(); // inserted images — bottom-most of all, so a reference photo or scanned drawing never sits over wires/components you'd want to trace or read
export const shapeLayer = new Konva.Layer(); // annotation shapes — deliberately BELOW wires and components, so a boundary box never covers or blocks the schematic inside it
export const wireLayer = new Konva.Layer({ listening: true });
export const contentLayer = new Konva.Layer();
export const wireLabelLayer = new Konva.Layer(); // wire IDs — above the wires AND the components, so a label can never end up hidden behind something and out of reach of the pointer: dragging it clear of whatever it overlaps is how it gets repositioned
export const wirePreviewLayer = new Konva.Layer();
export const shapeHandleLayer = new Konva.Layer(); // resize handles for the selected shape — on top of everything so they can always be grabbed


stage.add(borderLayer);
stage.add(imageLayer);
stage.add(shapeLayer);
stage.add(wireLayer);
stage.add(contentLayer);
stage.add(wireLabelLayer);
stage.add(wirePreviewLayer);
stage.add(shapeHandleLayer);

// Pan (drag the whole stage) only while Space is held — plain drag on empty
// canvas is reserved for rubber-band select (see 3_schematic_engine.js).
let isSpaceHeld = false;
export function isMainCanvasSpaceHeld() { return isSpaceHeld; }

function isSymbolModalOpen() {
  const modal = document.getElementById('symbolModal');
  return !!modal && modal.style.display === 'flex';
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || isSpaceHeld || isSymbolModalOpen()) return; // Studio handles its own Space
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (['input', 'textarea', 'select'].includes(activeTag)) return;
  isSpaceHeld = true;
  stage.draggable(true);
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  isSpaceHeld = false;
  stage.draggable(false);
});

// Keydown listeners needing access to Studio & Engine methods
export function setupKeyboardShortcuts({
  rotateSelectedComponent,
  deleteSelectedComponent,
  deleteSelectedWire,
  deleteSelectedStudioElement,
  clearWireState,
  getOrthogonalPoint,
  duplicateSelectedComponent,
  undoAction,
  redoAction,
  rotateSelectedSheetText,
  deleteSelectedSheetText,
  deleteSelectedShape,
  deleteSelectedTerminalLink,
  deleteSelectedImage,
  deleteSelectedCableMarker,
  exitToSelectTool
}) {
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (['input', 'textarea', 'select'].includes(activeTag)) return;

    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (typeof undoAction === 'function') undoAction();
      return;
    }
    if (ctrlOrCmd && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (typeof redoAction === 'function') redoAction();
      return;
    }
    if (ctrlOrCmd && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (typeof duplicateSelectedComponent === 'function') duplicateSelectedComponent();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (state.selectedTextId !== null && typeof rotateSelectedSheetText === 'function') {
        rotateSelectedSheetText();
      } else {
        rotateSelectedComponent();
      }
    } 
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const symbolModal = document.getElementById('symbolModal');
      
      // 1. Symbol Creator Modal takes priority if open
      if (symbolModal && symbolModal.style.display === 'flex') {
        deleteSelectedStudioElement();
      } 
      // 2. Wire Tool Node Removal (Actively Drawing)
      else if (state.currentTool === 'wire' && state.activeWirePoints.length > 0) {
        e.preventDefault();

        if (state.activeWirePoints.length > 2) {
          state.activeWirePoints.pop();
          state.activeWirePoints.pop();

          const pos = stage.getPointerPosition();
          if (pos && state.tempWireLine) {
            const scale = stage.scaleX();
            const rawX = (pos.x - stage.x()) / scale;
            const rawY = (pos.y - stage.y()) / scale;
            
            const lastX = state.activeWirePoints[state.activeWirePoints.length - 2];
            const lastY = state.activeWirePoints[state.activeWirePoints.length - 1];
            const ortho = getOrthogonalPoint(lastX, lastY, snapToGrid(rawX), snapToGrid(rawY));

            state.tempWireLine.points([...state.activeWirePoints, ortho.x, ortho.y]);
            wirePreviewLayer.batchDraw();
          }
        } else {
          clearWireState();
        }
      } 
      // 3. Delete Selected Wire
      else if (state.selectedWireIndex !== null) {
        e.preventDefault();
        deleteSelectedWire();
      }
      // 4. Delete Selected Sheet Text
      else if (state.selectedTextId !== null && typeof deleteSelectedSheetText === 'function') {
        e.preventDefault();
        deleteSelectedSheetText();
      }
      // 4a. Delete Selected Annotation Shape
      else if (state.selectedShapeId !== null && typeof deleteSelectedShape === 'function') {
        e.preventDefault();
        deleteSelectedShape();
      }
      // 4a-i. Delete Selected Image
      else if (state.selectedImageId !== null && typeof deleteSelectedImage === 'function') {
        e.preventDefault();
        deleteSelectedImage();
      }
      // 4a-ii. Delete Selected Terminal Link
      else if (state.selectedTerminalLinkId !== null && typeof deleteSelectedTerminalLink === 'function') {
        e.preventDefault();
        deleteSelectedTerminalLink();
      }
      // 4b. Delete Selected Cable Marker
      else if (state.selectedCableMarkerId !== null && typeof deleteSelectedCableMarker === 'function') {
        e.preventDefault();
        deleteSelectedCableMarker();
      }
      // 5. Delete Selected Component (or rubber-band group)
      else if (state.currentTool !== 'wire' && (state.selectedComponentId !== null || state.rubberBandComponentIds.length > 0 || state.rubberBandTextIds.length > 0 || state.rubberBandWireIndices.length > 0 || state.rubberBandCableMarkerIds.length > 0)) {
        e.preventDefault();
        deleteSelectedComponent();
      }
    } 
    else if (e.key === 'Escape' && state.currentTool === 'wire') {
      clearWireState();
    }
    // Unlike wire/shape/link/cable, none of these has a half-drawn gesture
    // to back out of first — each acts on a single click, and stays armed
    // for the next one — so Escape here just leaves the tool outright.
    else if (e.key === 'Escape' && (state.currentTool === 'terminal' || state.currentTool === 'delete' || state.currentTool === 'text')) {
      if (typeof exitToSelectTool === 'function') exitToSelectTool();
    }
  });
}

// Stage Zoom Listener
stage.on('wheel', (e) => {
  e.evt.preventDefault();
  const oldScale = stage.scaleX();
  const pointer = stage.getPointerPosition();

  if (!pointer) return;

  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };

  let newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
  stage.scale({ x: newScale, y: newScale });

  const newPos = {
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  };
  stage.position(newPos);
});

// Fit the current sheet's page neatly inside the visible canvas area, resetting
// any zoom/pan drift from scrolling or dragging.
export function fitView() {
  const sheet = getActiveSheet();
  if (!sheet) return;

  const config = SHEET_CONFIGS[sheet.size] || SHEET_CONFIGS.A3;
  const isLandscape = sheet.orientation === 'landscape';
  const pageWidth = isLandscape ? config.width : config.height;
  const pageHeight = isLandscape ? config.height : config.width;

  const cw = stage.width();
  const ch = stage.height();
  const padding = 40;

  const scale = Math.max(0.05, Math.min((cw - padding * 2) / pageWidth, (ch - padding * 2) / pageHeight));

  stage.scale({ x: scale, y: scale });
  stage.position({
    x: (cw - pageWidth * scale) / 2,
    y: (ch - pageHeight * scale) / 2
  });
  stage.batchDraw();
}

// Window Resize Handler
window.addEventListener('resize', () => {
  if (container) {
    stage.width(container.clientWidth);
    stage.height(container.clientHeight);
    stage.draw();
  }
});