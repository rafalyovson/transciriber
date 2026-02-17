import * as api from '../api.js'
import {
  apiKey,
  chunkDuration,
  chunkIndex,
  chunkTotal,
  currentJobId,
  errorMessage,
  language,
  mode,
  partialText,
  progress,
  stage,
  subtitleArtifacts,
  transcriptionResult,
  uploadedFilePath,
} from '../signals/state.js'

function safeParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function useTranscription() {
  async function start() {
    errorMessage.value = null
    transcriptionResult.value = null
    subtitleArtifacts.value = null
    stage.value = 'queued'
    progress.value = 0

    try {
      const result = await api.createJob({
        filePath: uploadedFilePath.value,
        language: language.value,
        mode: mode.value,
        chunkDuration: chunkDuration.value,
        apiKey: apiKey.value,
        subtitleOptions: { enabled: true },
      })

      if (!result.success) {
        errorMessage.value = result.error || 'Failed to create job'
        return
      }

      currentJobId.value = result.jobId
      subscribe(result.jobId)
    } catch (err) {
      errorMessage.value = err.message || 'Failed to start transcription'
    }
  }

  function subscribe(jobId) {
    const source = api.subscribeToJob(jobId)

    source.addEventListener('progress', (e) => {
      const event = safeParse(e.data)
      if (!event) return

      stage.value = event.stage
      if (event.percent != null) progress.value = event.percent
      if (event.chunkIndex != null) chunkIndex.value = event.chunkIndex
      if (event.chunkTotal != null) chunkTotal.value = event.chunkTotal
      if (event.partialText) partialText.value = event.partialText

      if (event.stage === 'completed') {
        handleComplete(jobId, source)
      }
      if (event.stage === 'failed') {
        errorMessage.value = event.message || 'Transcription failed'
        currentJobId.value = null
        source.close()
      }
    })

    source.addEventListener('snapshot', (e) => {
      const snapshot = safeParse(e.data)
      if (!snapshot) return

      if (snapshot.status === 'completed') {
        handleComplete(jobId, source)
      }
      if (snapshot.status === 'failed') {
        errorMessage.value = snapshot.error || 'Transcription failed'
        currentJobId.value = null
        source.close()
      }
    })

    source.onerror = () => {
      setTimeout(async () => {
        try {
          const job = await api.getJob(jobId)
          if (job.status === 'completed') {
            transcriptionResult.value = job.result || ''
            if (job.subtitleContents) {
              subtitleArtifacts.value = job.subtitleContents
            }
            currentJobId.value = null
          } else if (job.status === 'failed') {
            errorMessage.value = job.error || 'Transcription failed'
            currentJobId.value = null
          }
        } catch {
          // connection lost
        }
      }, 2000)
    }
  }

  async function handleComplete(jobId, source) {
    try {
      const job = await api.getJob(jobId)
      transcriptionResult.value = job.result || ''
      if (job.subtitleContents) subtitleArtifacts.value = job.subtitleContents
    } catch {
      if (partialText.value) {
        transcriptionResult.value = partialText.value
      }
    }
    currentJobId.value = null
    source.close()
  }

  return { start }
}
