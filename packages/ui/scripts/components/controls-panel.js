import { html } from "htm/preact";
import { useEffect } from "preact/hooks";
import {
  apiKey,
  canExtractAudio,
  canStart,
  chunkDuration,
  extractionMessage,
  isExtracting,
  language,
  languages,
  mode,
  originalFileName,
  outputFolder,
  youtubeUrlInput,
  saveSettings,
  serverHasApiKey,
  uploadedFilePath,
} from "../signals/state.js";
import { useTranscription } from "../hooks/use-transcription.js";
import * as api from "../api.js";

export function ControlsPanel() {
  const { start } = useTranscription();

  useEffect(() => {
    api.getLanguages().then((langs) => {
      languages.value = langs;
    });
    api.getDefaultFolder().then((res) => {
      if (res.success) outputFolder.value = res.folder;
    });
    api.getApiKeyStatus().then((res) => {
      serverHasApiKey.value = !!res.hasEnvKey;
    });
  }, []);

  async function selectFolder() {
    const result = await api.selectOutputFolder();
    if (result.success && result.folder) {
      outputFolder.value = result.folder;
    }
  }

  function handleStart() {
    saveSettings();
    start();
  }

  async function handleExtractAudio() {
    isExtracting.value = true;
    extractionMessage.value = null;

    try {
      const ytUrl = youtubeUrlInput.value.trim() || undefined;
      const result = await api.extractAudio({
        filePath: uploadedFilePath.value || "",
        originalFileName: originalFileName.value || undefined,
        outputFolder: outputFolder.value || undefined,
        youtubeUrl: ytUrl,
      });

      if (result.success) {
        extractionMessage.value = {
          type: "success",
          text: `Audio saved: ${result.fileName}`,
        };
      } else {
        extractionMessage.value = {
          type: "error",
          text: result.error || "Audio extraction failed",
        };
      }
    } catch (err) {
      extractionMessage.value = {
        type: "error",
        text: err.message || "Audio extraction failed",
      };
    } finally {
      isExtracting.value = false;
    }
  }

  return html`
    <div class="panel panel-controls">
      <div class="panel-title">
        <h2>Settings</h2>
        <p>Configure transcription options</p>
      </div>

      <div class="control-group">
        <label for="language-select">Language</label>
        <select
          id="language-select"
          class="select-input"
          value=${language.value}
          onChange=${(e) => {
            language.value = e.target.value;
          }}
        >
          ${languages.value.map(
            (code) => html` <option value=${code}>${code}</option> `,
          )}
        </select>
      </div>

      <div class="control-group">
        <span class="group-label">Mode</span>
        <div class="segmented-control">
          <label class="segment-option">
            <input
              type="radio"
              name="mode"
              value="whole"
              checked=${mode.value === "whole"}
              onChange=${() => {
                mode.value = "whole";
              }}
            />
            <span>Whole</span>
          </label>
          <label class="segment-option">
            <input
              type="radio"
              name="mode"
              value="parts"
              checked=${mode.value === "parts"}
              onChange=${() => {
                mode.value = "parts";
              }}
            />
            <span>Parts</span>
          </label>
        </div>
      </div>

      ${mode.value === "parts" &&
      html`
        <div class="control-group">
          <label for="chunk-duration">Chunk Duration (sec)</label>
          <input
            id="chunk-duration"
            class="text-input"
            type="number"
            min="10"
            value=${chunkDuration.value}
            onChange=${(e) => {
              chunkDuration.value = parseInt(e.target.value, 10) || 30;
            }}
          />
        </div>
      `}

      <div class="control-group">
        <label>Output Folder</label>
        <div class="output-folder-row">
          <span class="output-path">${outputFolder.value || "Default"}</span>
          <button class="button secondary" onClick=${selectFolder}>
            Browse
          </button>
        </div>
      </div>

      <button
        id="transcribe-button"
        class="button primary"
        disabled=${!canStart.value}
        onClick=${handleStart}
      >
        Transcribe
      </button>

      <button
        id="extract-audio-button"
        class="button secondary"
        disabled=${!canExtractAudio.value}
        onClick=${handleExtractAudio}
      >
        ${isExtracting.value ? "Extracting..." : "Extract Audio"}
      </button>

      ${extractionMessage.value &&
      html`<div
        class="message ${extractionMessage.value.type === "success"
          ? "success-message"
          : "error-message"}"
      >
        ${extractionMessage.value.text}
      </div>`}
      ${!apiKey.value &&
      !serverHasApiKey.value &&
      html`<p class="settings-hint" style="margin-top:8px">
        Set your ElevenLabs API key in
        <strong style="color:var(--brand-500);cursor:pointer"> Settings</strong>
        to enable transcription.
      </p>`}
      ${(apiKey.value || serverHasApiKey.value) &&
      !uploadedFilePath.value &&
      !youtubeUrlInput.value.trim() &&
      html`<p class="settings-hint" style="margin-top:8px">
        Upload a file or paste a YouTube URL to get started.
      </p>`}
    </div>
  `;
}
