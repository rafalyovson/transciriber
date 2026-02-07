import Bridge from './bridge.js'
import DOMElements from './dom-elements.js'
import { setupEventListeners } from './event-handlers.js'
import { loadDefaultOutputFolder, loadSettings } from './settings.js'
import { setOutputFolder } from './state.js'
import { loadLanguages, syncModeControls, updateModeSelection } from './transcription.js'

/**
 * Initialize the application
 */
async function init() {
  console.log('Initializing Transcriber Studio...')

  try {
    console.log('Bridge methods:', Object.keys(Bridge))

    loadSettings()
    setupEventListeners()

    syncModeControls()
    updateModeSelection()

    await loadLanguages()

    const defaultFolder = await loadDefaultOutputFolder()
    setOutputFolder(defaultFolder)
    DOMElements.outputFolderPath.textContent = defaultFolder || 'Current working directory'

    console.log('Initialization complete')
  } catch (error) {
    console.error('Error during initialization:', error)
  }
}

document.addEventListener('DOMContentLoaded', init)
