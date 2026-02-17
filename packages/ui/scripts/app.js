import { render } from 'preact'
import { html } from 'htm/preact'
import { settingsOpen } from './signals/state.js'
import { UploadPanel } from './components/upload-panel.js'
import { ControlsPanel } from './components/controls-panel.js'
import { ProgressPanel } from './components/progress-panel.js'
import { OutputPanel } from './components/output-panel.js'
import { SettingsModal } from './components/settings-modal.js'

function App() {
  return html`
    <div class="app-container">
      <header class="app-header">
        <h1>Transcriber Studio</h1>
        <button class="settings-button" onClick="${() => {
          settingsOpen.value = true
        }}">
          Settings
        </button>
      </header>
      <main class="dashboard-grid">
        <${UploadPanel} />
        <${ControlsPanel} />
        <${ProgressPanel} />
        <${OutputPanel} />
      </main>
      <${SettingsModal} />
    </div>
  `
}

render(
  html`
    <${App} />
  `,
  document.getElementById('app'),
)
