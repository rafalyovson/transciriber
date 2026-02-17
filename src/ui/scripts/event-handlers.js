import DOMElements from "./dom-elements.js";
import {
  handleDrop,
  handleFiles,
  highlight,
  preventDefaults,
  processYouTubeUrl,
  unhighlight,
} from "./file-processing.js";
import {
  transcribeAudio,
  updateChunkDuration,
  updateLanguageDisplay,
  updateModeSelection,
} from "./transcription.js";
import { saveSettings } from "./settings.js";
import { copyTranscription, exportTranscription } from "./export.js";
import { resetState, setOutputFolder } from "./state.js";
import { hideMessages, showError } from "./ui-utils.js";
import Bridge from "./bridge.js";

async function chooseOutputFolder() {
  const selection = await Bridge.selectOutputFolder();

  if (!selection.success || !selection.folder) {
    if (selection.error && selection.error !== "No folder selected") {
      showError(`Output folder selection failed: ${selection.error}`);
    }
    return;
  }

  const updateResult = await Bridge.setOutputFolder(selection.folder);
  if (!updateResult.success) {
    showError(
      `Failed to set output folder: ${updateResult.error || "Unknown error"}`,
    );
    return;
  }

  setOutputFolder(selection.folder);
  DOMElements.outputFolderPath.textContent = selection.folder;
}

/**
 * Set up all event listeners
 */
export function setupEventListeners() {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    DOMElements.dropArea.addEventListener(eventName, preventDefaults, false);
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    DOMElements.dropArea.addEventListener(eventName, highlight, false);
  });
  ["dragleave", "drop"].forEach((eventName) => {
    DOMElements.dropArea.addEventListener(eventName, unhighlight, false);
  });

  DOMElements.dropArea.addEventListener("drop", handleDrop, false);
  DOMElements.fileInput.addEventListener("change", handleFiles);

  DOMElements.browseButton.addEventListener("click", () => {
    DOMElements.fileInput.click();
  });

  DOMElements.youtubeFetchButton.addEventListener("click", processYouTubeUrl);
  DOMElements.youtubeUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      processYouTubeUrl();
    }
  });

  DOMElements.languageSelect.addEventListener("change", updateLanguageDisplay);
  DOMElements.modeWholeRadio.addEventListener("change", updateModeSelection);
  DOMElements.modePartsRadio.addEventListener("change", updateModeSelection);
  DOMElements.chunkDurationInput.addEventListener(
    "change",
    updateChunkDuration,
  );

  DOMElements.selectOutputFolderButton.addEventListener("click", async () => {
    await chooseOutputFolder();
  });

  DOMElements.transcribeButton.addEventListener("click", transcribeAudio);

  DOMElements.settingsButton.addEventListener("click", () => {
    DOMElements.settingsModal.classList.add("show");
  });

  DOMElements.closeModalButton.addEventListener("click", () => {
    DOMElements.settingsModal.classList.remove("show");
  });

  DOMElements.settingsModal.addEventListener("click", (event) => {
    if (event.target === DOMElements.settingsModal) {
      DOMElements.settingsModal.classList.remove("show");
    }
  });

  DOMElements.saveSettingsButton.addEventListener("click", saveSettings);

  DOMElements.exportButton.addEventListener("click", () => {
    const isOpen = DOMElements.exportOptions.classList.toggle("show");
    DOMElements.exportButton.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (
      !DOMElements.exportButton.contains(target) &&
      !DOMElements.exportOptions.contains(target)
    ) {
      DOMElements.exportOptions.classList.remove("show");
      DOMElements.exportButton.setAttribute("aria-expanded", "false");
    }
  });

  document
    .getElementById("export-txt")
    .addEventListener("click", () => exportTranscription("txt"));
  document
    .getElementById("export-srt")
    .addEventListener("click", () => exportTranscription("srt"));
  document
    .getElementById("export-vtt")
    .addEventListener("click", () => exportTranscription("vtt"));

  DOMElements.copyButton.addEventListener("click", copyTranscription);
  DOMElements.clearButton.addEventListener("click", clearTranscription);
}

/**
 * Clear transcription and reset UI
 */
export function clearTranscription() {
  resetState();

  DOMElements.fileInput.value = "";
  DOMElements.filePreview.classList.add("hidden");
  DOMElements.outputSection.classList.add("hidden");
  DOMElements.transcriptionContent.textContent = "";
  DOMElements.progressMessageElement.textContent = "Waiting for a media file.";
  DOMElements.progressStageElement.textContent = "Queued...";
  DOMElements.progressBarElement.style.width = "0%";
  DOMElements.progressBarElement.parentElement?.setAttribute(
    "aria-valuenow",
    "0",
  );
  DOMElements.progressPercentElement.textContent = "0%";

  DOMElements.youtubeUrlInput.value = "";
  DOMElements.youtubePreview.classList.add("hidden");

  hideMessages();

  DOMElements.transcribeButton.disabled = true;
}
