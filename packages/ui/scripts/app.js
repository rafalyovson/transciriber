import { render } from "preact";
import { html } from "htm/preact";
import { settingsOpen } from "./signals/state.js";
import { UploadPanel } from "./components/upload-panel.js";
import { ControlsPanel } from "./components/controls-panel.js";
import { ProgressPanel } from "./components/progress-panel.js";
import { OutputPanel } from "./components/output-panel.js";
import { SettingsModal } from "./components/settings-modal.js";

function App() {
  return html`
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-block">
          <div class="brand-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </div>
          <div>
            <h1>Transcriber Studio</h1>
            <p>Audio & video transcription powered by AI</p>
          </div>
        </div>
        <button
          class="button ghost"
          style="padding:10px;line-height:0"
          title="Settings"
          aria-label="Settings"
          onClick=${() => {
            settingsOpen.value = true;
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
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
  `;
}

render(html`<${App} />`, document.getElementById("app"));
