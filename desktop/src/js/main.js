import { openTitleBlockDesigner, closeTitleBlockDesigner, applyTitleBlockDesign } from './26_title_block_designer.js';
import { openPartsLibrary, openPartsPicker, pickPartForEdit, savePartFromEdit, savePartEntry } from './42_parts_library.js';
import { exportTitleBlockFile, importTitleBlockFile, openTitleBlockTemplates, closeTitleBlockTemplates, saveTitleBlockTemplate } from './27_title_block_library.js';
import { state, setTool, undo, redo, clearHistory, scheduleAutosave, dismissSaveFallbackNotice, handleDialogOk, handleDialogCancel } from './1_config_state.js';
import { setupKeyboardShortcuts, fitView, stage } from './2_main_stage.js';
import { 
  renderComponents, 
  rotateSelectedComponent, flipSelectedComponent,
  deleteSelectedComponent, 
  deleteSelectedWire,
  duplicateSelectedComponent,
  cleanUpConnections,
  clearWireState, 
  logWireOp, 
  getOrthogonalPoint, 
  setupStageWireEvents,
  rotateSelectedSheetText,
  deleteSelectedSheetText,
  deleteSelectedShape,
  deleteSelectedImage,
  insertImageFromFile,
  rotateSelectedImage,
  toggleCrosshair,
  toggleJunctionStyle,
  toggleWireIds,
  toggleWirePlcData,
  toggleJunctionHopDirection,
  syncJunctionControls,
  exitToSelectTool,
  deleteSelectedTerminalLink,
  cancelTerminalLinkPick,
  cancelRubberBandSelect,
  cancelMultiWire,
  setShapeStyle,
  setShapeSnap,
  getShapeSnap,
  cancelShapeDraw,
  setArrowOption,
  editSelectedArrowNote,
  saveArrowNote,
  toggleArrowNoteStyle,
  closeArrowNoteEditor
, applyWirePrefixes} from './3_schematic_engine.js';
import { 
  renderCustomSymbolsList, 
  filterSymbolSidebar,
  editCustomSymbol, 
  deleteCustomSymbol, 
  deleteSelectedStudioElement,
  setStudioTool,
  resetStudioView,
  undoStudio,
  redoStudio,
  copySelectedStudioElements,
  cutSelectedStudioElements,
  pasteStudioClipboard,
  rotateSelectedStudioElements,
  setStudioLineStyle,
  clearStudioCanvas,
  saveCustomSymbol,
  handleSymbolLibraryChange,
  exportSymbolLibrary,
  confirmExportLibrary,
  closeExportLibraryModal,
  importSymbolLibrary,
  openBrowseLibrariesModal,
  closeBrowseLibrariesModal,
  openSymbolCreator,
  closeSymbolCreator,
  openTerminalBlockModal,
  closeTerminalBlockModal,
  toggleTerminalBlockMode,
  generateTerminalBlock
} from './4_symbol_studio.js';



import { 
  loadActiveSheet, 
  openEditModal, 
  closeEditModal, resetPlcFunctionRows, 
  saveComponentDetails, 
  closeWireEditModal,
  saveWireDetails, 
  closeTextBoxModal,
  saveTextBoxModal,
  toggleTextBoxStyle,
  toggleParentOptions, 
  refreshEditModalDerivedFields,
  addAuxItemRow,
  addOwnContactRow,
  refreshSelfContact,
  onContactRefChange,
  handleDragStart, 
  handleDrop, 
  savePortfolio, 
  printPortfolio,
  setCompanyLogo,
  openSheetPropsModal,
  closeSheetPropsModal,
  openProjectInfoModal,
  closeProjectInfoModal,
  updateProjectInfo,
  loadPortfolio, 
  addSheet, 
  addTitlePage,
  addContentsPage,
  addLocationsPage,
  addBOMPage,
  addPlcIoPage,
  removeSheet, renumberProject, 
  updateCurrentSheet, 
  switchSheet,
  populateLocationDropdown,
  handleLocationSelectChange,
  openCreateLocationModal,
  closeCreateLocationModal,
  confirmCreateLocation,
  promptAndAssignLocationBoundary,
  cancelAssignLocation,
  confirmAssignLocation,
  openManageLocationsModal,
  closeManageLocationsModal,
  openEditLocationModal,
  deleteLocation,
  collectPartExtras,
  applyPartExtras
} from './5_portfolio_sheets.js';
import { openWireMarkerModal, closeWireMarkerModal, openTerminalMarkerModal, closeTerminalMarkerModal } from './28_wire_markers.js';
import { openBOMModal, closeBOMModal, exportBOMCsv, openWireReferenceModal, closeWireReferenceModal, buildBOM, goToBomModalRow } from './6_bom.js';
import { openCableAssignmentModal, closeCableAssignmentModal, toggleCableNewFields, confirmCableAssignment, deleteSelectedCableMarker, openCableManagerModal, closeCableManagerModal, updateCableField, deleteCable, clearCableCore, moveCableCore, onCableLibraryPick, updateCableCoreColour, applyStandardCableColours, saveCableToLibrary, exportCableSchedule } from './7_cables.js';
import { openConnectorModal, openConnectorEditor, closeConnectorModal, swapConnectorSides, setConnectorPin, applyConnectorPinNames, onConnectorPinPreset, moveConnectorRow, confirmConnectorModal, deleteConnectorFromModal } from './30_connectors.js';
import { openRevisionsModal, closeRevisionsModal } from './24_revisions_ui.js';
import { addCableDiagramPage } from './34_cable_diagram.js';
import { addPanelSheet, renderPanelSheet, syncPanelDock, panelRotateSelected, panelDeleteSelected, confirmPanelImport, cancelPanelImport, onPanelImportUnits, onPanelImportRail, centrePanelImportRail } from './22_panel_layout.js';
import { openCableLibraryModal, closeCableLibraryModal, newCableLibraryForm, onCableLibraryListPick, saveCableLibraryForm, deleteCableLibraryEntry, exportCableLibrary, chooseCableLibraryFile, importCableLibraryFile, addStandardCablesFromForm, onCableLibraryCoresChange, onCableLibraryColourChange, fillStandardCableLibraryColours } from './19_cable_library_ui.js';
import { openFindModal, closeFindModal, onFindInput, onFindKey, goToFindResult, goToBomRow } from './31_find.js';
import { duplicateSheet, setSheetReview } from './32_sheet_tools.js';
import { setProjectView, selectProjectFolder, newProjectFolder, renameProjectFolder, dropProjectOnFolder, openProjectDetails, closeProjectDetails, saveProjectDetails, duplicateProject, saveCurrentAsTemplate, useProjectTemplate, deleteProjectTemplate } from './8_projects.js';
import { openMyProjectsModal, closeMyProjectsModal, openProjectFromServer, deleteProjectFromServer, saveProjectToServer, saveProjectAsToServer, pickSaveAsName, confirmSaveAs, startNewProject, autosaveToServer, resumeMostRecentProject } from './8_projects.js';
import { renderBuiltinSymbolThumbnails, initSymbolPreview, initSymbolDragImages } from './9_symbol_thumbnails.js';
import { openTerminalModal, closeTerminalModal, confirmTerminalModal, onTerminalBlockChange, onTerminalNewBlockInput, onTerminalPositionInput, onTerminalLocationChange, onTerminalSideChange, onTerminalLocationLabelChange, onTerminalModelChange, onTerminalLevelsChange, onTerminalLevelChange, openTerminalDetails } from './12_terminal_modal.js';

import { openPlcModuleCreator, closePlcModuleCreator, savePlcModule, onPlcCountChange, addPlcCustomChannel, addPlcItem, autoAddressPlcChannels, addPlcSupply, groupPlcSelected, ungroupPlcSelected } from './17_plc_module_creator.js';
import { startWalkthrough, maybeStartWalkthrough } from './38_walkthrough.js';
import { showComponentMenu, openSwapDialog } from './40_component_menu.js';
import { openPlcScheduleModal, closePlcScheduleModal, buildPlcSchedule } from './41_plc_io_schedule.js';
import { openDriveCreator, closeDriveCreator, saveDrive, addDrivePower, addDriveControl, groupDriveSelected, ungroupDriveSelected } from './36_drive_creator.js';
import { openTerminalBlockManager, closeTerminalBlockManager, onTerminalBlockManagerPick, saveTerminalBlockChanges, autoPositionSelectedBlock, packSelectedBlock, packEveryBlock, resetBlockSides, arrangeSelectedBlock } from './15_terminal_block_manager.js';
import './43_terminal_sides.js';
import { openPortfolioView, closePortfolioView, portfolioShowAll, portfolioOnlyCurrent, portfolioShowMatching } from './14_portfolio_view.js';
import { openTerminalModelsModal, closeTerminalModelsModal, newTerminalModelForm, onTerminalModelListPick, saveTerminalModelForm, deleteTerminalModelFromForm, exportTerminalModels, chooseTerminalModelsFile, importTerminalModelsFile, addStandardTerminalModelsFromForm } from './13_terminal_models.js';

// Pictures beside the built-in symbols in the sidebar (Ground, the supplies).
renderBuiltinSymbolThumbnails();
initSymbolPreview();
initSymbolDragImages(() => stage.scaleX() || 1);

// Re-renders everything after an undo/redo jump: the restored sheet, its border/tabs,
// and the custom symbols sidebar (a symbol create/delete may itself be part of the
// jump).
const refreshAfterHistory = () => {
  loadActiveSheet();
  renderCustomSymbolsList(handleDragStart);
};

// Setup Event Listeners & Global Helpers
setupKeyboardShortcuts({
  rotateSelectedComponent: () => rotateSelectedComponent(() => renderComponents(openEditModal)),
  deleteSelectedComponent: () => deleteSelectedComponent(() => renderComponents(openEditModal)),
  deleteSelectedWire: () => deleteSelectedWire(() => renderComponents(openEditModal)),
  deleteSelectedStudioElement,
  clearWireState,
  getOrthogonalPoint,
  duplicateSelectedComponent: () => duplicateSelectedComponent(() => renderComponents(openEditModal)),
  undoAction: () => undo(refreshAfterHistory),
  redoAction: () => redo(refreshAfterHistory),
  rotateSelectedSheetText: () => rotateSelectedSheetText(() => renderComponents(openEditModal)),
  deleteSelectedSheetText: () => deleteSelectedSheetText(() => renderComponents(openEditModal)),
  deleteSelectedShape: () => deleteSelectedShape(() => renderComponents(openEditModal)),
  deleteSelectedImage: () => deleteSelectedImage(() => renderComponents(openEditModal)),
  deleteSelectedTerminalLink: () => deleteSelectedTerminalLink(() => renderComponents(openEditModal)),
  deleteSelectedCableMarker,
  exitToSelectTool: () => exitToSelectTool(() => renderComponents(openEditModal))
});

setupStageWireEvents(() => renderComponents(openEditModal));

// Expose DOM Event Handler Callbacks to global `window` for HTML `onclick` / `ondrag` bindings
window.setTool = (tool) => {
  // A half-drawn wire belongs to the Wire tool. Leaving it behind when you
  // switch away meant coming back later would silently continue from that
  // old point, so your next click joined up to it with a stray wire.
  if (state.currentTool === 'wire' && tool !== 'wire') clearWireState(false);
  logWireOp('tool-changed', { from: state.currentTool, to: tool });
  cancelShapeDraw(); // a half-drawn shape belongs to the tool that started it
  cancelTerminalLinkPick(); // and so does a half-made terminal link
  cancelRubberBandSelect(); // and an elastic-band selection drag
  cancelMultiWire(); // and a half-picked multi-wire bundle
  stage.container().style.cursor = tool.startsWith('shape-') ? 'crosshair' : (tool === 'link' ? 'pointer' : ((tool === 'multiwire' || tool === 'connector') ? 'crosshair' : '')); // no other cue that a shape / link tool is armed
  setTool(tool, () => renderComponents(openEditModal));
};

// The ribbon's line-style dropdown: restyles the selected shape and sets the
// style for the next one drawn.
window.setShapeSnap = (v) => setShapeSnap(v);
(() => { const sel = document.getElementById('shapeSnapSelect'); if (sel) sel.value = String(getShapeSnap()); })();
window.setShapeStyle = (style) => setShapeStyle(style, () => renderComponents(openEditModal));
window.setArrowOption = (key, value) => setArrowOption(key, value, () => renderComponents(openEditModal));
window.editSelectedArrowNote = () => editSelectedArrowNote(() => renderComponents(openEditModal));
window.saveArrowNote = saveArrowNote;
window.toggleArrowNoteStyle = toggleArrowNoteStyle;
window.closeArrowNoteEditor = closeArrowNoteEditor;

// Lets us confirm which version of the code is really running (browsers cache
// scripts aggressively) — visible in the console on every page load.
window.__buildTag = 'snag2-wire-audit-1';
console.info('[Schematic Editor] build ' + window.__buildTag);
window.refreshCanvas = () => renderComponents(openEditModal);
window.handleDragStart = handleDragStart;
window.handleDrop = handleDrop;
window.savePortfolio = savePortfolio;
window.printPortfolio = printPortfolio;
window.setCompanyLogo = setCompanyLogo;
window.openSheetPropsModal = openSheetPropsModal;
window.closeSheetPropsModal = closeSheetPropsModal;
window.openProjectInfoModal = openProjectInfoModal;
window.closeProjectInfoModal = closeProjectInfoModal;
window.updateProjectInfo = updateProjectInfo;
window.openTitleBlockDesigner = openTitleBlockDesigner;
window.closeTitleBlockDesigner = closeTitleBlockDesigner;
window.applyTitleBlockDesign = applyTitleBlockDesign;
window.exportTitleBlockFile = exportTitleBlockFile;
window.importTitleBlockFile = importTitleBlockFile;
window.openTitleBlockTemplates = openTitleBlockTemplates;
window.closeTitleBlockTemplates = closeTitleBlockTemplates;
window.saveTitleBlockTemplate = saveTitleBlockTemplate;
window.loadPortfolio = loadPortfolio;
window.addSheet = addSheet;
window.addTitlePage = addTitlePage;
window.addContentsPage = addContentsPage;
window.addLocationsPage = addLocationsPage;
window.addCableDiagramPage = addCableDiagramPage;
window.addBOMPage = addBOMPage;
window.addPlcIoPage = addPlcIoPage;
window.buildPlcSchedule = buildPlcSchedule;   // read by renderPlcIoPageContent in 3_schematic_engine.js (a window call, as for the BOM, to avoid a circular import)
window.buildBOM = buildBOM; // read by renderBOMPageContent in 3_schematic_engine.js — kept as a window call there to avoid a circular import (6_bom.js already imports from that file)
window.removeSheet = removeSheet;
window.renumberProject = renumberProject;
window.switchSheet = switchSheet;
window.updateCurrentSheet = updateCurrentSheet;
window.populateLocationDropdown = populateLocationDropdown;
window.handleLocationSelectChange = handleLocationSelectChange;
window.openCreateLocationModal = openCreateLocationModal;
window.closeCreateLocationModal = closeCreateLocationModal;
window.confirmCreateLocation = confirmCreateLocation;
window.promptAndAssignLocationBoundary = promptAndAssignLocationBoundary;
window.cancelAssignLocation = cancelAssignLocation;
window.confirmAssignLocation = confirmAssignLocation;
window.openManageLocationsModal = openManageLocationsModal;
window.closeManageLocationsModal = closeManageLocationsModal;
window.openEditLocationModal = openEditLocationModal;
window.deleteLocation = deleteLocation;
window.closeEditModal = closeEditModal;
window.resetPlcFunctionRows = resetPlcFunctionRows;
window.saveComponentDetails = saveComponentDetails;
window.closeWireEditModal = closeWireEditModal;
window.saveWireDetails = saveWireDetails;
window.closeTextBoxModal = closeTextBoxModal;
window.saveTextBoxModal = saveTextBoxModal;
window.toggleTextBoxStyle = toggleTextBoxStyle;
window.toggleParentOptions = toggleParentOptions;
window.refreshEditModalDerivedFields = refreshEditModalDerivedFields;
window.addAuxItemRow = addAuxItemRow;
window.addOwnContactRow = addOwnContactRow;
window.collectPartExtras = collectPartExtras;
window.applyPartExtras = applyPartExtras;
window.refreshSelfContact = refreshSelfContact;
window.openPartsLibrary = openPartsLibrary;
window.openPartsPicker = openPartsPicker;
window.pickPartForEdit = pickPartForEdit;
window.savePartFromEdit = savePartFromEdit;
window.savePartEntry = savePartEntry;
window.onContactRefChange = onContactRefChange;

// BUGFIX: these were referenced directly by toolbar onclick="" handlers but were
// never actually attached to window, so the Rotate/Delete buttons threw a
// ReferenceError and silently did nothing (only the R / Delete keys worked).
window.rotateSelectedComponent = () => rotateSelectedComponent(() => renderComponents(openEditModal));
window.flipSelected = (axis) => flipSelectedComponent(axis, () => renderComponents(openEditModal));
// The one visible "Rotate" ribbon button covers whichever of the two is
// actually selected — a text box or a component — the same way the R key
// already does (see setupKeyboardShortcuts below). Without this, rotating a
// text box was only ever reachable via the R key, with no on-screen sign
// that it was even possible.
window.rotateSelected = () => {
  if (state.selectedTextId !== null) rotateSelectedSheetText(() => renderComponents(openEditModal));
  else if (state.selectedImageId !== null) rotateSelectedImage(() => renderComponents(openEditModal));
  else rotateSelectedComponent(() => renderComponents(openEditModal));
};

// Reads the file the Insert Image picker was given and adds it to the sheet
// (see insertImageFromFile in 3_schematic_engine.js for the actual work);
// resets the input's value afterward so choosing the SAME file again still
// fires a change event.
window.insertImageFromFile = (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) insertImageFromFile(file, () => renderComponents(openEditModal));
  event.target.value = '';
};

// The View ribbon's Crosshair button — visually reflects whether the guide is currently on.
window.toggleCrosshair = () => {
  const on = toggleCrosshair();
  const btn = document.getElementById('crosshairToggleBtn');
  if (btn) btn.classList.toggle('ribbon-btn-toggled-on', on);
};

window.toggleWirePlcData = () => {
  toggleWirePlcData();
  syncJunctionControls();
  renderComponents(openEditModal);
  scheduleAutosave();
};
window.toggleWireIds = () => {
  toggleWireIds();
  syncJunctionControls();
  renderComponents(openEditModal);
  scheduleAutosave();
};
window.toggleJunctionStyle = () => {
  toggleJunctionStyle();
  syncJunctionControls();
  renderComponents(openEditModal); // the wires themselves need to redraw, not just the buttons
};
window.toggleJunctionHopDirection = () => {
  toggleJunctionHopDirection();
  syncJunctionControls();
  renderComponents(openEditModal);
};
window.showComponentMenu = showComponentMenu;
window.openSwapDialog = openSwapDialog;
window.deleteSelectedComponent = () => deleteSelectedComponent(() => renderComponents(openEditModal));
window.deleteSelectedWire = () => deleteSelectedWire(() => renderComponents(openEditModal));

// New feature bindings
window.duplicateSelectedComponent = () => duplicateSelectedComponent(() => renderComponents(openEditModal));
window.undoAction = () => { logWireOp('undo'); undo(refreshAfterHistory); };
window.redoAction = () => { logWireOp('redo'); redo(refreshAfterHistory); };
window.fitView = fitView;
window.cleanUpConnections = () => cleanUpConnections(() => renderComponents(openEditModal));
window.dismissSaveFallbackNotice = dismissSaveFallbackNotice;
window.openBOMModal = openBOMModal;
window.closeBOMModal = closeBOMModal;
window.openWireReferenceModal = openWireReferenceModal;
window.openWireMarkerModal = openWireMarkerModal;
window.openPlcScheduleModal = openPlcScheduleModal;
window.closePlcScheduleModal = closePlcScheduleModal;
window.closeWireMarkerModal = closeWireMarkerModal;
window.openTerminalMarkerModal = openTerminalMarkerModal;
window.closeTerminalMarkerModal = closeTerminalMarkerModal;
window.closeWireReferenceModal = closeWireReferenceModal;
window.openCableAssignmentModal = openCableAssignmentModal;
Object.assign(window, { openConnectorModal, openConnectorEditor, closeConnectorModal, swapConnectorSides, setConnectorPin, applyConnectorPinNames, onConnectorPinPreset, moveConnectorRow, confirmConnectorModal, deleteConnectorFromModal });
window.closeCableAssignmentModal = closeCableAssignmentModal;
window.toggleCableNewFields = toggleCableNewFields;
window.confirmCableAssignment = confirmCableAssignment;
window.openCableManagerModal = openCableManagerModal;
window.exportCableSchedule = exportCableSchedule;
window.closeCableManagerModal = closeCableManagerModal;
window.updateCableField = updateCableField;
window.deleteCable = deleteCable;
window.clearCableCore = clearCableCore;
window.moveCableCore = moveCableCore;
window.openMyProjectsModal = openMyProjectsModal;
Object.assign(window, { openFindModal, closeFindModal, onFindInput, onFindKey, goToFindResult, goToBomRow, goToBomModalRow });
Object.assign(window, { setProjectView, selectProjectFolder, newProjectFolder, renameProjectFolder, dropProjectOnFolder, openProjectDetails, closeProjectDetails, saveProjectDetails, duplicateProject, saveCurrentAsTemplate, useProjectTemplate, deleteProjectTemplate });
window.closeMyProjectsModal = closeMyProjectsModal;
window.openProjectFromServer = openProjectFromServer;
window.deleteProjectFromServer = deleteProjectFromServer;
window.saveProjectToServer = saveProjectToServer;
window.saveProjectAsToServer = saveProjectAsToServer;
window.pickSaveAsName = pickSaveAsName;
window.confirmSaveAs = confirmSaveAs;
window.handleDialogOk = handleDialogOk;
window.handleDialogCancel = handleDialogCancel;
window.startNewProject = startNewProject;
window.exportBOMCsv = exportBOMCsv;

// Symbol Studio Handlers
window.openSymbolCreator = openSymbolCreator;
window.closeSymbolCreator = closeSymbolCreator;
window.setStudioTool = setStudioTool;
window.resetStudioView = resetStudioView;
window.undoStudio = undoStudio;
window.redoStudio = redoStudio;
window.copySelectedStudioElements = copySelectedStudioElements;
window.cutSelectedStudioElements = cutSelectedStudioElements;
window.pasteStudioClipboard = pasteStudioClipboard;
window.rotateSelectedStudioElements = rotateSelectedStudioElements;
window.setStudioLineStyle = setStudioLineStyle;
window.clearStudioCanvas = clearStudioCanvas;
window.saveCustomSymbol = () => saveCustomSymbol(
  () => renderCustomSymbolsList(handleDragStart), 
  () => renderComponents(openEditModal)
);
window.openTerminalModal = openTerminalModal;
window.closeTerminalModal = closeTerminalModal;
window.confirmTerminalModal = confirmTerminalModal;
window.onTerminalBlockChange = onTerminalBlockChange;
window.onTerminalNewBlockInput = onTerminalNewBlockInput;
window.onTerminalPositionInput = onTerminalPositionInput;
window.onTerminalLocationChange = onTerminalLocationChange;
window.onTerminalLocationLabelChange = onTerminalLocationLabelChange;
window.onTerminalSideChange = onTerminalSideChange;
window.onTerminalModelChange = onTerminalModelChange;
window.openPlcModuleCreator = openPlcModuleCreator;
window.closePlcModuleCreator = closePlcModuleCreator;
window.savePlcModule = () => savePlcModule(
  () => renderCustomSymbolsList(handleDragStart),
  () => renderComponents(openEditModal)
);
window.onPlcCountChange = onPlcCountChange;
window.addPlcCustomChannel = addPlcCustomChannel;
window.addPlcSupply = addPlcSupply;
window.addPlcItem = addPlcItem;
window.autoAddressPlcChannels = autoAddressPlcChannels;
window.groupPlcSelected = groupPlcSelected;
window.ungroupPlcSelected = ungroupPlcSelected;
window.openDriveCreator = openDriveCreator;
window.closeDriveCreator = closeDriveCreator;
window.saveDrive = () => saveDrive(
  () => renderCustomSymbolsList(handleDragStart),
  () => renderComponents(openEditModal)
);
window.addDrivePower = addDrivePower;
window.addDriveControl = addDriveControl;
window.groupDriveSelected = groupDriveSelected;
window.ungroupDriveSelected = ungroupDriveSelected;
window.openTerminalBlockManager = openTerminalBlockManager;
window.closeTerminalBlockManager = closeTerminalBlockManager;
window.onTerminalBlockManagerPick = onTerminalBlockManagerPick;
window.saveTerminalBlockChanges = saveTerminalBlockChanges;
window.autoPositionSelectedBlock = autoPositionSelectedBlock;
window.packSelectedBlock = packSelectedBlock;
window.packEveryBlock = packEveryBlock;
window.resetBlockSides = resetBlockSides;
window.arrangeSelectedBlock = arrangeSelectedBlock;
window.openPortfolioView = openPortfolioView;
window.closePortfolioView = closePortfolioView;
window.portfolioShowAll = portfolioShowAll;
window.portfolioOnlyCurrent = portfolioOnlyCurrent;
window.portfolioShowMatching = portfolioShowMatching;
window.openTerminalModelsModal = openTerminalModelsModal;
window.closeTerminalModelsModal = closeTerminalModelsModal;
window.newTerminalModelForm = newTerminalModelForm;
window.onTerminalModelListPick = onTerminalModelListPick;
window.saveTerminalModelForm = saveTerminalModelForm;
window.deleteTerminalModelFromForm = deleteTerminalModelFromForm;
window.exportTerminalModels = exportTerminalModels;
window.chooseTerminalModelsFile = chooseTerminalModelsFile;
window.importTerminalModelsFile = importTerminalModelsFile;
window.addStandardTerminalModelsFromForm = addStandardTerminalModelsFromForm;
Object.assign(window, { openRevisionsModal, closeRevisionsModal, addPanelSheet, renderPanelSheet, syncPanelDock, panelRotateSelected, panelDeleteSelected, confirmPanelImport, cancelPanelImport, onPanelImportUnits, onPanelImportRail, centrePanelImportRail });
Object.assign(window, { onCableLibraryPick, updateCableCoreColour, applyStandardCableColours, saveCableToLibrary,
  openCableLibraryModal, closeCableLibraryModal, newCableLibraryForm, onCableLibraryListPick, saveCableLibraryForm, deleteCableLibraryEntry,
  exportCableLibrary, chooseCableLibraryFile, importCableLibraryFile, addStandardCablesFromForm, onCableLibraryCoresChange,
  onCableLibraryColourChange, fillStandardCableLibraryColours });
window.onTerminalLevelsChange = onTerminalLevelsChange;
window.onTerminalLevelChange = onTerminalLevelChange;
window.openTerminalDetails = openTerminalDetails;
window.openTerminalBlockModal = openTerminalBlockModal;
window.closeTerminalBlockModal = closeTerminalBlockModal;
window.toggleTerminalBlockMode = toggleTerminalBlockMode;
window.generateTerminalBlock = () => generateTerminalBlock(
  () => renderCustomSymbolsList(handleDragStart),
  () => renderComponents(openEditModal)
);
window.handleSymbolLibraryChange = handleSymbolLibraryChange;
window.editCustomSymbol = editCustomSymbol;
window.deleteCustomSymbol = (e, symKey) => deleteCustomSymbol(
  e, symKey, 
  () => renderCustomSymbolsList(handleDragStart), 
  () => renderComponents(openEditModal)
);
window.exportSymbolLibrary = exportSymbolLibrary;
window.confirmExportLibrary = confirmExportLibrary;
window.closeExportLibraryModal = closeExportLibraryModal;
window.importSymbolLibrary = (e) => importSymbolLibrary(e, () => renderCustomSymbolsList(handleDragStart), () => renderComponents(openEditModal));
window.openBrowseLibrariesModal = () => openBrowseLibrariesModal(() => renderCustomSymbolsList(handleDragStart), () => renderComponents(openEditModal));
window.closeBrowseLibrariesModal = closeBrowseLibrariesModal;
window.filterSymbolSidebar = filterSymbolSidebar;

// Initial App Startup
// resumeMostRecentProject() loads whichever of THIS account's own saved
// projects was most recently touched (rendering the sheet and symbol list
// itself) — nothing to confirm, since a server-side project is already
// unambiguously this user's own. A brand-new account with nothing saved
// yet, or a tab that just started a new project, falls back to the default
// blank sheet already in `state`.
window.duplicateSheet = duplicateSheet;
window.applyWirePrefixes = applyWirePrefixes;
window.startWalkthrough = startWalkthrough;
window.setSheetReview = setSheetReview;
window.autosaveToServer = autosaveToServer; // called from scheduleAutosave() in 1_config_state.js, which can't import this module directly (8_projects.js already imports FROM it)
const restored = await resumeMostRecentProject();
if (!restored) {
  loadActiveSheet();
  renderCustomSymbolsList(handleDragStart);
}
clearHistory(); // undo should never reach back before the app finished loading
scheduleAutosave(0); // establish a baseline autosave immediately for this session
maybeStartWalkthrough(); // a new account is shown the welcome tour, once

// Let the Save button's tooltip say up front whether it'll offer a destination
// picker here, rather than the person only finding out — or not — after clicking.
const saveBtn = document.getElementById('saveBtn');
if (saveBtn) {
  saveBtn.title = window.showSaveFilePicker
    ? 'Save — lets you choose the destination folder'
    : 'Save — downloads to your default folder (choosing a destination needs HTTPS or localhost)';
}
// No assist on text entry: the browser's autofill and remembered-entry dropdowns, spell-check underlines, auto-correct and
// auto-capitalise are all turned off for every field in the editor (including fields created later, such as the on-sheet
// text editor). Part numbers, wire IDs and designators are not words, and the suggestions got in the way.
function turnOffTextAssist(root) {
  const fields = (root.matches && root.matches('input, textarea') ? [root] : []).concat(Array.from(root.querySelectorAll ? root.querySelectorAll('input, textarea') : []));
  fields.forEach(el => {
    if (el.type === 'password') return;   // the browser's password manager is a different thing, and welcome
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
  });
}
turnOffTextAssist(document.body);
new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) turnOffTextAssist(n); })))
  .observe(document.body, { childList: true, subtree: true });
