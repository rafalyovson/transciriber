import { html } from 'htm/preact'
import { useEffect } from 'preact/hooks'
import {
  canStart,
  chunkDuration,
  language,
  languages,
  mode,
  outputFolder,
  saveSettings,
} from '../signals/state.js'
import { useTranscription } from '../hooks/use-transcription.js'
import * as api from '../api.js'

export function ControlsPanel() {
  const { start } = useTranscription()

  useEffect(() => {
    api.getLanguages().then((langs) => {
      languages.value = langs
    })
    api.getDefaultFolder().then((res) => {
      if (res.success) outputFolder.value = res.folder
    })
  }, [])

  async function selectFolder() {
    const result = await api.selectOutputFolder()
    if (result.success && result.folder) {
      outputFolder.value = result.folder
    }
  }

  function handleStart() {
    saveSettings()
    start()
  }

  return html`
    <div class="panel controls-panel">
      <h2>Settings</h2>
      <div class="control-group">
        <label for="language-select">Language</label>
        <select
          id="language-select"
          value="${language.value}"
          onChange="${(e) => {
            language.value = e.target.value
          }}"
        >
          ${languages.value.map((code) =>
            html`
              <option value="${code}">${code}</option>
            `
          )}
        </select>
      </div>
      <div class="control-group">
        <label>Mode</label>
        <div class="mode-toggle">
          <label>
            <input
              type="radio"
              name="mode"
              value="whole"
              checked="${mode.value === 'whole'}"
              onChange="${() => {
                mode.value = 'whole'
              }}"
            /> Whole
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="parts"
              checked="${mode.value === 'parts'}"
              onChange="${() => {
                mode.value = 'parts'
              }}"
            /> Parts
          </label>
        </div>
      </div>
      ${mode.value === 'parts' && html`
        <div class="control-group">
          <label for="chunk-duration">Chunk Duration (sec)</label>
          <input
            id="chunk-duration"
            type="number"
            min="10"
            value="${chunkDuration.value}"
            onChange="${(e) => {
              chunkDuration.value = parseInt(e.target.value, 10) || 30
            }}"
          />
        </div>
      `}
      <div class="control-group">
        <label>Output Folder</label>
        <div class="folder-row">
          <span class="folder-path">${outputFolder.value || 'Default'}</span>
          <button onClick="${selectFolder}">Browse</button>
        </div>
      </div>
      <button
        class="transcribe-button"
        disabled="${!canStart.value}"
        onClick="${handleStart}"
      >
        Transcribe
      </button>
    </div>
  `
}
