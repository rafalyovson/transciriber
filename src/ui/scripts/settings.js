import DOMElements from './dom-elements.js'
import {
  getDefaultSettings,
  getSettings,
  setChunkDuration,
  setTranscriptionMode,
  updateSettings,
} from './state.js'
import Bridge from './bridge.js'

const STORAGE_KEY = 'transcriber_settings'

function persistSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSettings()))
}

function applySettingsToForm() {
  const settings = getSettings()

  DOMElements.apiKeyInput.value = settings.apiKey || ''

  DOMElements.modeWholeRadio.checked = settings.transcriptionMode === 'whole'
  DOMElements.modePartsRadio.checked = settings.transcriptionMode === 'parts'

  DOMElements.chunkDurationInput.value = String(settings.chunkDuration || 30)
  DOMElements.chunkDurationGroup.classList.toggle(
    'hidden',
    settings.transcriptionMode !== 'parts',
  )
}

/**
 * Save API settings from modal
 */
export function saveSettings() {
  updateSettings({
    apiKey: DOMElements.apiKeyInput.value.trim(),
  })

  persistSettings()
  DOMElements.settingsModal.classList.remove('show')
}

/**
 * Persist mode/chunk preferences from main controls
 */
export function saveModePreferences(mode, chunkDuration) {
  setTranscriptionMode(mode)
  setChunkDuration(chunkDuration)
  persistSettings()
}

/**
 * Load settings from localStorage
 */
export function loadSettings() {
  const savedSettings = localStorage.getItem(STORAGE_KEY)

  if (!savedSettings) {
    updateSettings(getDefaultSettings())
    applySettingsToForm()
    return
  }

  try {
    const parsedSettings = JSON.parse(savedSettings)
    updateSettings(parsedSettings)
  } catch (error) {
    console.error('Error parsing saved settings:', error)
    updateSettings(getDefaultSettings())
  }

  applySettingsToForm()
}

/**
 * Load default output folder
 */
export async function loadDefaultOutputFolder() {
  try {
    const response = await Bridge.getDefaultFolder()
    if (!response.success) {
      console.error('Failed to get default folder')
      return ''
    }

    return response.folder || ''
  } catch (error) {
    console.error('Error loading default output folder:', error)
    return ''
  }
}
