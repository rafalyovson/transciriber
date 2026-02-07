/**
 * DOM Elements Module
 *
 * Centralizes all DOM element references used throughout the application.
 */

const DOMElements = {
  // File handling
  dropArea: document.getElementById('drop-area'),
  fileInput: document.getElementById('file-input'),
  filePreview: document.getElementById('file-preview'),
  fileNameElement: document.getElementById('file-name'),
  fileSizeElement: document.getElementById('file-size'),
  browseButton: document.getElementById('browse-button'),
  waveformContainer: document.getElementById('waveform'),

  // Controls
  languageSelect: document.getElementById('language-select'),
  modeWholeRadio: document.getElementById('mode-whole'),
  modePartsRadio: document.getElementById('mode-parts'),
  chunkDurationGroup: document.getElementById('chunk-duration-group'),
  chunkDurationInput: document.getElementById('chunk-duration'),
  outputFolderPath: document.getElementById('output-folder-path'),
  selectOutputFolderButton: document.getElementById('select-output-folder'),
  transcribeButton: document.getElementById('transcribe-button'),

  // Status
  progressElement: document.getElementById('progress'),
  progressMessageElement: document.getElementById('progress-message'),
  progressStageElement: document.getElementById('progress-stage'),
  progressBarElement: document.getElementById('progress-bar'),
  progressPercentElement: document.getElementById('progress-percent'),
  errorMessageElement: document.getElementById('error-message'),
  successMessageElement: document.getElementById('success-message'),

  // Output
  outputSection: document.getElementById('output-section'),
  transcriptionContent: document.getElementById('transcription-content'),
  exportButton: document.getElementById('export-button'),
  exportOptions: document.getElementById('export-options'),
  copyButton: document.getElementById('copy-button'),
  clearButton: document.getElementById('clear-button'),

  // Settings modal
  settingsButton: document.getElementById('settings-button'),
  settingsModal: document.getElementById('settings-modal'),
  closeModalButton: document.getElementById('close-modal'),
  saveSettingsButton: document.getElementById('save-settings'),
  apiKeyInput: document.getElementById('api-key'),
}

export default DOMElements
