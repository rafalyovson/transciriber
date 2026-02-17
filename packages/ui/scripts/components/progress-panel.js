import { html } from 'htm/preact'
import {
  chunkIndex,
  chunkTotal,
  errorMessage,
  isTranscribing,
  partialText,
  progress,
  stage,
} from '../signals/state.js'

const STAGE_LABELS = {
  queued: 'Queued',
  preparing_input: 'Preparing input...',
  extracting_audio: 'Extracting audio...',
  transcribing_whole: 'Transcribing...',
  splitting: 'Splitting audio...',
  transcribing_chunk: 'Transcribing chunks...',
  combining_chunks: 'Combining results...',
  generating_subtitles: 'Generating subtitles...',
  saving_output: 'Saving output...',
  completed: 'Complete',
  failed: 'Failed',
}

export function ProgressPanel() {
  if (!isTranscribing.value && !errorMessage.value && stage.value !== 'completed') {
    return null
  }

  const label = STAGE_LABELS[stage.value] || stage.value

  return html`
    <div class="panel progress-panel">
      <h2>Progress</h2>
      ${errorMessage.value && html`
        <div class="error-message">${errorMessage.value}</div>
      `} ${isTranscribing.value && html`
        <div class="progress-container">
          <div class="stage-text">${label}</div>
          ${chunkTotal.value > 0 && html`
            <div class="chunk-counter">Chunk ${chunkIndex.value}/${chunkTotal.value}</div>
          `}
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuenow="${progress.value}"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="progress-fill" style="${{ width: `${progress.value}%` }}"></div>
          </div>
          <div class="progress-percent">${progress.value}%</div>
        </div>
      `} ${partialText.value && isTranscribing.value && html`
        <div class="partial-text">
          <h3>Live Preview</h3>
          <p>${partialText.value}</p>
        </div>
      `}
    </div>
  `
}
