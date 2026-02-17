import { html } from "htm/preact";
import {
  exportMenuOpen,
  subtitleArtifacts,
  transcriptionResult,
} from "../signals/state.js";

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function OutputPanel() {
  if (!transcriptionResult.value) return null;

  function copyToClipboard() {
    navigator.clipboard.writeText(transcriptionResult.value);
  }

  function exportTxt() {
    downloadFile(transcriptionResult.value, "transcript.txt", "text/plain");
    exportMenuOpen.value = false;
  }

  function exportSrt() {
    const srt = subtitleArtifacts.value?.srt;
    if (srt) {
      downloadFile(srt, "transcript.srt", "application/x-subrip");
      exportMenuOpen.value = false;
    }
  }

  function exportVtt() {
    const vtt = subtitleArtifacts.value?.vtt;
    if (vtt) {
      downloadFile(vtt, "transcript.vtt", "text/vtt");
      exportMenuOpen.value = false;
    }
  }

  return html`
    <div class="panel panel-output">
      <div class="output-header">
        <h2>Output</h2>
        <div class="output-actions">
          <button class="button ghost" onClick=${copyToClipboard}>Copy</button>
          <div class="export-dropdown">
            <button
              class="button secondary"
              aria-haspopup="true"
              aria-expanded=${exportMenuOpen.value}
              onClick=${() => {
                exportMenuOpen.value = !exportMenuOpen.value;
              }}
            >
              Export ▾
            </button>
            <div
              class="export-options ${exportMenuOpen.value ? "show" : ""}"
              role="menu"
            >
              <button
                class="export-option"
                role="menuitem"
                onClick=${exportTxt}
              >
                TXT
              </button>
              <button
                class="export-option"
                role="menuitem"
                onClick=${exportSrt}
                disabled=${!subtitleArtifacts.value?.srt}
              >
                SRT
              </button>
              <button
                class="export-option"
                role="menuitem"
                onClick=${exportVtt}
                disabled=${!subtitleArtifacts.value?.vtt}
              >
                VTT
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="transcription-content">
        <pre>${transcriptionResult.value}</pre>
      </div>
    </div>
  `;
}
