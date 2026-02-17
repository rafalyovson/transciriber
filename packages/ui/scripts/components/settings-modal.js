import { html } from "htm/preact";
import { apiKey, saveSettings, settingsOpen } from "../signals/state.js";

export function SettingsModal() {
  function close() {
    saveSettings();
    settingsOpen.value = false;
  }

  return html`
    <div class="modal ${settingsOpen.value ? "show" : ""}" onClick=${close}>
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h2>Settings</h2>
          <button class="close-button" onClick=${close}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="control-group">
            <label for="api-key-input">ElevenLabs API Key</label>
            <input
              id="api-key-input"
              class="text-input"
              type="password"
              value=${apiKey.value}
              onInput=${(e) => {
                apiKey.value = e.target.value;
              }}
              placeholder="Enter your API key..."
            />
            <p class="settings-hint">
              Your key is stored locally in the browser and sent only to the
              backend server.
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="button primary" onClick=${close}>Save & Close</button>
        </div>
      </div>
    </div>
  `;
}
