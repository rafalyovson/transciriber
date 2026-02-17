import { html } from "htm/preact";
import {
  chunkIndex,
  chunkTotal,
  errorMessage,
  isTranscribing,
  partialText,
  progress,
  stage,
} from "../signals/state.js";

const STAGE_LABELS = {
  queued: "Queued",
  preparing_input: "Preparing input...",
  extracting_audio: "Extracting audio...",
  transcribing_whole: "Transcribing...",
  splitting: "Splitting audio...",
  transcribing_chunk: "Transcribing chunks...",
  combining_chunks: "Combining results...",
  generating_subtitles: "Generating subtitles...",
  saving_output: "Saving output...",
  completed: "Complete",
  failed: "Failed",
};

export function ProgressPanel() {
  if (
    !isTranscribing.value &&
    !errorMessage.value &&
    stage.value !== "completed"
  ) {
    return null;
  }

  const label = STAGE_LABELS[stage.value] || stage.value;
  const chunkLabel =
    chunkTotal.value > 0
      ? ` — Chunk ${chunkIndex.value}/${chunkTotal.value}`
      : "";

  return html`
    <div class="panel panel-status">
      <div class="panel-title">
        <h2>Progress</h2>
      </div>

      ${errorMessage.value &&
      html` <div class="message error-message">${errorMessage.value}</div> `}
      ${isTranscribing.value &&
      html`
        <div class="progress">
          <div class="spinner"></div>
          <div class="progress-body">
            <div class="progress-stage">${label}${chunkLabel}</div>
            <div class="progress-track">
              <div
                class="progress-bar"
                role="progressbar"
                aria-valuenow=${progress.value}
                aria-valuemin="0"
                aria-valuemax="100"
                style=${{ width: `${progress.value}%` }}
              ></div>
            </div>
            <div class="progress-percent">${progress.value}%</div>
          </div>
        </div>
      `}
      ${partialText.value &&
      isTranscribing.value &&
      html`
        <div class="live-preview">
          <div class="live-preview-label">Live Preview</div>
          <div class="transcription-content">
            <pre>${partialText.value}</pre>
          </div>
        </div>
      `}
    </div>
  `;
}
