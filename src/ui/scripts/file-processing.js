import DOMElements from './dom-elements.js'
import { setCurrentFile, setCurrentFileData } from './state.js'
import { createWaveformVisualization, formatFileSize, showError } from './ui-utils.js'
import Bridge from './bridge.js'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.webm'])
const VIDEO_EXTENSIONS = new Set(['.mp4'])

function getFileExtension(fileName) {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return ''
  }

  return fileName.slice(lastDotIndex).toLowerCase()
}

export function isSupportedInputFile(file) {
  const mimeType = (file.type || '').toLowerCase()
  const extension = getFileExtension(file.name || '')

  if (mimeType.startsWith('audio/')) {
    return true
  }
  if (mimeType === 'video/mp4') {
    return true
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return true
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return true
  }

  return false
}

/**
 * Process a file after it's been selected or dropped
 * @param {File} file - The file to process
 */
export async function processFile(file) {
  if (!isSupportedInputFile(file)) {
    showError('Please select an audio file or an MP4 video file.')
    return
  }

  try {
    const result = await Bridge.uploadFile(file)

    if (!result.success) {
      showError(`Failed to upload file: ${result.error}`)
      return
    }

    setCurrentFile(result.filePath)
    setCurrentFileData({
      originalName: result.originalName || file.name,
      mimeType: result.mimeType || file.type || '',
    })

    DOMElements.fileNameElement.textContent = file.name
    DOMElements.fileSizeElement.textContent = formatFileSize(file.size)
    DOMElements.filePreview.classList.remove('hidden')

    createWaveformVisualization(DOMElements.waveformContainer)

    DOMElements.transcribeButton.disabled = false
    DOMElements.progressMessageElement.textContent = 'Ready to transcribe.'
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    showError(`Error processing file: ${errorMessage}`)
  }
}

/**
 * Handle file selection from input
 * @param {Event} event - The change event
 */
export async function handleFiles(event) {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const files = input.files
  if (files && files.length > 0) {
    await processFile(files[0])
  }
}

/**
 * Handle file drop
 * @param {DragEvent} event - The drop event
 */
export async function handleDrop(event) {
  const dt = event.dataTransfer
  if (!dt || dt.files.length === 0) return

  await processFile(dt.files[0])
}

/**
 * Prevent default behavior for drag and drop events
 * @param {Event} event - The event
 */
export function preventDefaults(event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Highlight drop area when dragging over
 */
export function highlight() {
  DOMElements.dropArea.classList.add('active')
}

/**
 * Remove highlight from drop area
 */
export function unhighlight() {
  DOMElements.dropArea.classList.remove('active')
}
