import { html } from 'htm/preact'
import { useRef } from 'preact/hooks'
import { currentFile, errorMessage, originalFileName, uploadedFilePath } from '../signals/state.js'
import * as api from '../api.js'

export function UploadPanel() {
  const fileInputRef = useRef(null)
  const urlInputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    currentFile.value = file
    originalFileName.value = file.name
    errorMessage.value = null

    try {
      const result = await api.uploadFile(file)
      if (result.success) {
        uploadedFilePath.value = result.filePath
      } else {
        errorMessage.value = result.error || 'Upload failed'
      }
    } catch (err) {
      errorMessage.value = err.message || 'Upload failed'
    }
  }

  function onDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  function onDragOver(e) {
    e.preventDefault()
    e.currentTarget.classList.add('drag-over')
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over')
  }

  async function fetchYouTube() {
    const url = urlInputRef.current?.value?.trim()
    if (!url) return
    errorMessage.value = null

    try {
      const result = await api.downloadYouTube(url)
      if (result.success) {
        uploadedFilePath.value = result.filePath
        originalFileName.value = result.originalName || result.youtubeTitle || 'youtube-audio.wav'
        currentFile.value = { name: originalFileName.value }
      } else {
        errorMessage.value = result.error || 'YouTube download failed'
      }
    } catch (err) {
      errorMessage.value = err.message || 'YouTube download failed'
    }
  }

  return html`
    <div class="panel upload-panel">
      <h2>Input</h2>
      <div
        class="drop-area ${uploadedFilePath.value ? 'has-file' : ''}"
        onDrop="${onDrop}"
        onDragOver="${onDragOver}"
        onDragLeave="${onDragLeave}"
        onClick="${() => fileInputRef.current?.click()}"
      >
        ${uploadedFilePath.value
          ? html`
            <p class="file-name">${originalFileName.value}</p>
          `
          : html`
            <p>Drop audio/video file here or click to browse</p>
          `}
        <input
          ref="${fileInputRef}"
          type="file"
          accept="audio/*,video/mp4"
          style="display:none"
          onChange="${(e) => handleFile(e.target.files?.[0])}"
        />
      </div>
      <div class="youtube-input">
        <input
          ref="${urlInputRef}"
          type="text"
          placeholder="Or paste a YouTube URL..."
          onKeyDown="${(e) => e.key === 'Enter' && fetchYouTube()}"
        />
        <button onClick="${fetchYouTube}">Fetch</button>
      </div>
    </div>
  `
}
