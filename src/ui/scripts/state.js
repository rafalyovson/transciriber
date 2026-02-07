const DEFAULT_SETTINGS = {
  apiKey: '',
  transcriptionMode: 'whole',
  chunkDuration: 30,
}

// Application State
const state = {
  currentFile: null,
  currentFileData: null,
  currentLanguage: 'hy',
  outputFolder: '',
  transcriptionInProgress: false,
  transcriptionResult: '',
  currentJobId: null,
  currentStage: 'queued',
  progressPercent: 0,
  chunkIndex: 0,
  chunkTotal: 0,
  livePartialText: '',
  subtitleArtifacts: {
    generated: false,
    formats: [],
    paths: {},
    cueCount: 0,
    violationCount: 0,
    qualityReportPath: '',
    contents: {},
    quality: null,
    trackLanguageTag: '',
  },
  settings: { ...DEFAULT_SETTINGS },
}

// State getters
export const getCurrentFile = () => state.currentFile
export const getCurrentFileData = () => state.currentFileData
export const getCurrentLanguage = () => state.currentLanguage
export const getOutputFolder = () => state.outputFolder
export const isTranscriptionInProgress = () => state.transcriptionInProgress
export const getTranscriptionResult = () => state.transcriptionResult
export const getCurrentJobId = () => state.currentJobId
export const getCurrentStage = () => state.currentStage
export const getProgressPercent = () => state.progressPercent
export const getChunkProgress = () => ({
  chunkIndex: state.chunkIndex,
  chunkTotal: state.chunkTotal,
})
export const getLivePartialText = () => state.livePartialText
export const getSubtitleArtifacts = () => state.subtitleArtifacts
export const getSettings = () => state.settings
export const getTranscriptionMode = () => state.settings.transcriptionMode
export const getChunkDuration = () => state.settings.chunkDuration

// State setters
export const setCurrentFile = (file) => {
  state.currentFile = file
}

export const setCurrentFileData = (data) => {
  state.currentFileData = data
}

export const setCurrentLanguage = (language) => {
  state.currentLanguage = language
}

export const setOutputFolder = (folder) => {
  state.outputFolder = folder
}

export const setTranscriptionInProgress = (inProgress) => {
  state.transcriptionInProgress = inProgress
}

export const setTranscriptionResult = (result) => {
  state.transcriptionResult = result
}

export const setCurrentJobId = (jobId) => {
  state.currentJobId = jobId
}

export const setCurrentStage = (stage) => {
  state.currentStage = stage || 'queued'
}

export const setProgressPercent = (percent) => {
  const parsed = Number(percent)
  state.progressPercent = Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, Math.floor(parsed)))
    : 0
}

export const setChunkProgress = (chunkIndex, chunkTotal) => {
  state.chunkIndex = Number.isFinite(chunkIndex) ? Number(chunkIndex) : 0
  state.chunkTotal = Number.isFinite(chunkTotal) ? Number(chunkTotal) : 0
}

export const setLivePartialText = (text) => {
  state.livePartialText = text || ''
}

export const setSubtitleArtifacts = (artifacts) => {
  state.subtitleArtifacts = {
    generated: Boolean(artifacts?.generated),
    formats: Array.isArray(artifacts?.formats) ? artifacts.formats : [],
    paths: artifacts?.paths || {},
    cueCount: Number.isFinite(artifacts?.cueCount) ? Number(artifacts.cueCount) : 0,
    violationCount: Number.isFinite(artifacts?.violationCount)
      ? Number(artifacts.violationCount)
      : 0,
    qualityReportPath: artifacts?.qualityReportPath || '',
    contents: artifacts?.contents || {},
    quality: artifacts?.quality || null,
    trackLanguageTag: artifacts?.trackLanguageTag || '',
  }
}

export const setTranscriptionMode = (mode) => {
  state.settings.transcriptionMode = mode === 'parts' ? 'parts' : 'whole'
}

export const setChunkDuration = (duration) => {
  const parsed = Number.parseInt(String(duration), 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    state.settings.chunkDuration = parsed
  }
}

export const updateSettings = (newSettings) => {
  state.settings = {
    ...state.settings,
    ...newSettings,
  }

  if (state.settings.transcriptionMode !== 'parts') {
    state.settings.transcriptionMode = 'whole'
  }

  const parsedChunk = Number.parseInt(String(state.settings.chunkDuration), 10)
  state.settings.chunkDuration = Number.isFinite(parsedChunk) && parsedChunk > 0 ? parsedChunk : 30
}

// Reset current job state
export const resetState = () => {
  state.currentFile = null
  state.currentFileData = null
  state.transcriptionResult = ''
  state.transcriptionInProgress = false
  state.currentJobId = null
  state.currentStage = 'queued'
  state.progressPercent = 0
  state.chunkIndex = 0
  state.chunkTotal = 0
  state.livePartialText = ''
  state.subtitleArtifacts = {
    generated: false,
    formats: [],
    paths: {},
    cueCount: 0,
    violationCount: 0,
    qualityReportPath: '',
    contents: {},
    quality: null,
    trackLanguageTag: '',
  }
}

export const getDefaultSettings = () => ({ ...DEFAULT_SETTINGS })
