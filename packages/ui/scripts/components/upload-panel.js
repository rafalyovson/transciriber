import { html } from "htm/preact";
import { useRef, useState } from "preact/hooks";
import {
  currentFile,
  errorMessage,
  extractionMessage,
  originalFileName,
  uploadedFilePath,
  youtubeUrlInput,
} from "../signals/state.js";
import * as api from "../api.js";

export function UploadPanel() {
  const fileInputRef = useRef(null);
  const urlInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [fetching, setFetching] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    currentFile.value = file;
    originalFileName.value = file.name;
    errorMessage.value = null;
    extractionMessage.value = null;

    try {
      const result = await api.uploadFile(file);
      if (result.success) {
        uploadedFilePath.value = result.filePath;
      } else {
        errorMessage.value = result.error || "Upload failed";
      }
    } catch (err) {
      errorMessage.value = err.message || "Upload failed";
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragActive(true);
  }

  function onDragLeave() {
    setDragActive(false);
  }

  function clearFile() {
    currentFile.value = null;
    originalFileName.value = null;
    uploadedFilePath.value = null;
    youtubeUrlInput.value = "";
    extractionMessage.value = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function fetchYouTube() {
    const url = urlInputRef.current?.value?.trim();
    if (!url || fetching) return;
    errorMessage.value = null;
    setFetching(true);

    try {
      const result = await api.downloadYouTube(url);
      if (result.success) {
        uploadedFilePath.value = result.filePath;
        originalFileName.value =
          result.originalName || result.youtubeTitle || "youtube-audio.wav";
        currentFile.value = { name: originalFileName.value };
      } else {
        errorMessage.value = result.error || "YouTube download failed";
      }
    } catch (err) {
      errorMessage.value = err.message || "YouTube download failed";
    } finally {
      setFetching(false);
    }
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  return html`
    <div class="panel panel-upload">
      <div class="panel-title">
        <h2>Input</h2>
        <p>Upload a file or paste a YouTube URL</p>
      </div>

      <div
        class="drop-area ${dragActive ? "active" : ""}"
        onDrop=${onDrop}
        onDragOver=${onDragOver}
        onDragLeave=${onDragLeave}
        onClick=${() => fileInputRef.current?.click()}
      >
        <div class="drop-area-content">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p>Drop audio or video file here</p>
          <span>or click to browse</span>
        </div>
        <input
          ref=${fileInputRef}
          type="file"
          accept="audio/*,video/mp4"
          style="display:none"
          onChange=${(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      ${currentFile.value &&
      html`
        <div class="file-preview">
          <div class="file-info">
            <span class="file-name">${originalFileName.value}</span>
            ${currentFile.value.size &&
            html`
              <span class="file-size"
                >${formatSize(currentFile.value.size)}</span
              >
            `}
          </div>
          <button
            class="button danger"
            style="width:100%;padding:8px"
            onClick=${(e) => {
              e.stopPropagation();
              clearFile();
            }}
          >
            Remove file
          </button>
        </div>
      `}

      <div class="url-separator">or</div>

      <div class="url-input-row">
        <input
          ref=${urlInputRef}
          class="text-input"
          type="text"
          placeholder="Paste a YouTube URL..."
          value=${youtubeUrlInput.value}
          disabled=${fetching}
          onInput=${(e) => {
            youtubeUrlInput.value = e.target.value;
            extractionMessage.value = null;
          }}
          onKeyDown=${(e) => e.key === "Enter" && fetchYouTube()}
        />
        <button
          class="button ghost"
          disabled=${fetching}
          onClick=${fetchYouTube}
        >
          ${fetching ? "Fetching..." : "Fetch"}
        </button>
      </div>

      ${errorMessage.value &&
      html`<div class="message error-message">${errorMessage.value}</div>`}
    </div>
  `;
}
