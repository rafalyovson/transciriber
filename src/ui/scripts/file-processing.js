import DOMElements from './dom-elements.js'
import { setCurrentFile, setCurrentFileData, setTranscriptionMode } from './state.js'
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

function isYouTubeUrl(input) {
  try {
    const url = new URL(input)
    const hostname = url.hostname.replace(/^www\./, '')
    return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be'
  } catch {
    return false
  }
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Process a YouTube URL: validate, download, and prepare for transcription
 */
export async function processYouTubeUrl() {
  const url = DOMElements.youtubeUrlInput.value.trim()

  if (!url) {
    showError('Please enter a YouTube URL.')
    return
  }

  if (!isYouTubeUrl(url)) {
    showError('Invalid YouTube URL. Please enter a valid youtube.com or youtu.be link.')
    return
  }

  DOMElements.youtubeFetchButton.disabled = true
  DOMElements.youtubeFetchButton.textContent = 'Fetching...'
  DOMElements.youtubePreview.classList.add('hidden')

  try {
    const result = await Bridge.downloadYouTube(url)

    if (!result.success) {
      showError(`Failed to fetch YouTube video: ${result.error}`)
      return
    }

    setCurrentFile(result.filePath)
    setCurrentFileData({
      originalName: result.originalName || `${result.youtubeTitle || 'youtube'}.wav`,
      mimeType: result.mimeType || 'audio/wav',
    })

    DOMElements.youtubeTitleElement.textContent = result.youtubeTitle || 'Unknown title'
    DOMElements.youtubeDurationElement.textContent = result.durationSec
      ? formatDuration(result.durationSec)
      : ''
    DOMElements.youtubePreview.classList.remove('hidden')
    DOMElements.filePreview.classList.add('hidden')

    // Auto-switch to parts mode for full coverage of YouTube audio
    setTranscriptionMode('parts')
    DOMElements.modePartsRadio.checked = true
    DOMElements.modeWholeRadio.checked = false
    DOMElements.chunkDurationGroup.classList.remove('hidden')

    DOMElements.transcribeButton.disabled = false
    DOMElements.progressMessageElement.textContent = 'Ready to transcribe (parts mode for full coverage).'
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    showError(`Error fetching YouTube video: ${errorMessage}`)
  } finally {
    DOMElements.youtubeFetchButton.disabled = false
    DOMElements.youtubeFetchButton.textContent = 'Fetch'
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
