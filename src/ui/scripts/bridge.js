/**
 * Bridge Module
 *
 * Handles communication between the UI and the backend server through HTTP requests.
 */

const API_BASE_URL = `${window.location.origin}/api`

/**
 * Upload a file to the server
 * @param {File} file
 * @returns {Promise<object>}
 */
async function uploadFile(file) {
  try {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE_URL}/uploadFile`, {
      method: 'POST',
      body: formData,
    })

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Select an output folder using native dialog
 * @returns {Promise<object>}
 */
async function selectOutputFolder() {
  try {
    const response = await fetch(`${API_BASE_URL}/selectOutputFolder`)
    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Set the output folder
 * @param {string} folder
 * @returns {Promise<object>}
 */
async function setOutputFolder(folder) {
  try {
    const response = await fetch(`${API_BASE_URL}/setOutputFolder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folder }),
    })

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get default output folder
 * @returns {Promise<object>}
 */
async function getDefaultFolder() {
  try {
    const response = await fetch(`${API_BASE_URL}/getDefaultFolder`)
    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Transcribe audio file
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise<object>}
 */
async function transcribeAudio(filePath, options) {
  try {
    const response = await fetch(`${API_BASE_URL}/transcribeAudio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath, options }),
    })

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred during transcription',
      modeRequested: 'whole',
      modeUsed: 'whole',
      fallbackApplied: false,
      warnings: [],
      mediaKind: 'audio',
      audioExtracted: false,
      isComplete: false,
    }
  }
}

/**
 * Start a transcription job (async + SSE).
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise<object>}
 */
async function startTranscriptionJob(filePath, options) {
  try {
    const response = await fetch(`${API_BASE_URL}/transcriptionJobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath, options }),
    })
    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start transcription job',
    }
  }
}

/**
 * Subscribe to live transcription events.
 * @param {string} jobId
 * @returns {EventSource}
 */
function subscribeToTranscriptionJob(jobId) {
  return new EventSource(`${API_BASE_URL}/transcriptionJobs/${encodeURIComponent(jobId)}/events`)
}

/**
 * Fetch latest job snapshot.
 * @param {string} jobId
 * @returns {Promise<object>}
 */
async function getTranscriptionJob(jobId) {
  try {
    const response = await fetch(`${API_BASE_URL}/transcriptionJobs/${encodeURIComponent(jobId)}`)
    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch transcription job',
    }
  }
}

/**
 * Download audio from a YouTube URL
 * @param {string} url
 * @returns {Promise<object>}
 */
async function downloadYouTube(url) {
  try {
    const response = await fetch(`${API_BASE_URL}/downloadYouTube`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    })

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get available languages
 * @returns {Promise<string[]>}
 */
async function getAvailableLanguages() {
  try {
    const response = await fetch(`${API_BASE_URL}/getAvailableLanguages`)
    return await response.json()
  } catch (_error) {
    return ['en']
  }
}

/**
 * Get language name
 * @param {string} code
 * @returns {Promise<string>}
 */
async function getLanguageName(code) {
  try {
    const response = await fetch(`${API_BASE_URL}/getLanguageName?code=${code}`)
    const data = await response.json()
    return data.name || code
  } catch (_error) {
    return code
  }
}

const Bridge = {
  uploadFile,
  downloadYouTube,
  selectOutputFolder,
  setOutputFolder,
  getDefaultFolder,
  transcribeAudio,
  startTranscriptionJob,
  subscribeToTranscriptionJob,
  getTranscriptionJob,
  getAvailableLanguages,
  getLanguageName,
}

window.Bridge = Bridge

export default Bridge
