import { computed, signal } from '@preact/signals'

function loadSetting(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

// File state
export const currentFile = signal(null)
export const uploadedFilePath = signal(null)
export const originalFileName = signal('')

// Settings
export const apiKey = signal(loadSetting('transcriber_apiKey', ''))
export const language = signal(loadSetting('transcriber_language', 'hy'))
export const mode = signal(loadSetting('transcriber_mode', 'whole'))
export const chunkDuration = signal(
  parseInt(loadSetting('transcriber_chunkDuration', '30'), 10),
)
export const outputFolder = signal('')

// Job state
export const currentJobId = signal(null)
export const stage = signal('')
export const progress = signal(0)
export const chunkIndex = signal(0)
export const chunkTotal = signal(0)
export const partialText = signal('')
export const errorMessage = signal(null)
export const transcriptionResult = signal(null)
export const subtitleArtifacts = signal(null)

// UI state
export const settingsOpen = signal(false)
export const exportMenuOpen = signal(false)
export const languages = signal([])

// Derived
export const isTranscribing = computed(
  () =>
    currentJobId.value !== null &&
    !transcriptionResult.value &&
    !errorMessage.value,
)
export const canStart = computed(
  () => uploadedFilePath.value && apiKey.value && !isTranscribing.value,
)

// Persistence helpers
export function saveSettings() {
  try {
    localStorage.setItem('transcriber_apiKey', apiKey.value)
    localStorage.setItem('transcriber_language', language.value)
    localStorage.setItem('transcriber_mode', mode.value)
    localStorage.setItem(
      'transcriber_chunkDuration',
      String(chunkDuration.value),
    )
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.)
  }
}

export function resetJobState() {
  currentJobId.value = null
  stage.value = ''
  progress.value = 0
  chunkIndex.value = 0
  chunkTotal.value = 0
  partialText.value = ''
  errorMessage.value = null
  transcriptionResult.value = null
  subtitleArtifacts.value = null
}

export function resetFileState() {
  currentFile.value = null
  uploadedFilePath.value = null
  originalFileName.value = ''
  resetJobState()
}
