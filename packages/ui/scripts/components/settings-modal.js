import { html } from 'htm/preact'
import { apiKey, saveSettings, settingsOpen } from '../signals/state.js'

export function SettingsModal() {
  if (!settingsOpen.value) return null

  function close() {
    saveSettings()
    settingsOpen.value = false
  }

  return html`
    <div class="modal-overlay" onClick="${close}">
      <div class="modal" role="dialog" aria-modal="true" onClick="${(e) => e.stopPropagation()}">
        <div class="modal-header">
          <h2>Settings</h2>
          <button class="modal-close" onClick="${close}">X</button>
        </div>
        <div class="modal-body">
          <div class="control-group">
            <label for="api-key-input">ElevenLabs API Key</label>
            <input
              id="api-key-input"
              type="password"
              value="${apiKey.value}"
              onInput="${(e) => {
                apiKey.value = e.target.value
              }}"
              placeholder="Enter your API key..."
            />
          </div>
        </div>
        <div class="modal-footer">
          <button onClick="${close}">Save & Close</button>
        </div>
      </div>
    </div>
  `
}
