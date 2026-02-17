import DOMElements from "./dom-elements.js";
import {
  getChunkDuration,
  getCurrentFile,
  getCurrentFileData,
  getCurrentLanguage,
  getOutputFolder,
  getSettings,
  getTranscriptionMode,
  isTranscriptionInProgress,
  setChunkDuration,
  setChunkProgress,
  setCurrentJobId,
  setCurrentLanguage,
  setCurrentStage,
  setLivePartialText,
  setProgressPercent,
  setSubtitleArtifacts,
  setTranscriptionInProgress,
  setTranscriptionMode,
  setTranscriptionResult,
} from "./state.js";
import { saveModePreferences } from "./settings.js";
import { hideMessages, showError, showSuccess } from "./ui-utils.js";
import Bridge from "./bridge.js";

function getSelectedMode() {
  return DOMElements.modePartsRadio.checked ? "parts" : "whole";
}

function getNormalizedChunkDuration() {
  const parsed = Number.parseInt(DOMElements.chunkDurationInput.value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }
  return parsed;
}

function setProgressView(percent, stageMessage) {
  const normalized = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.floor(percent)))
    : 0;
  DOMElements.progressBarElement.style.width = `${normalized}%`;
  DOMElements.progressBarElement.parentElement?.setAttribute(
    "aria-valuenow",
    String(normalized),
  );
  DOMElements.progressPercentElement.textContent = `${normalized}%`;
  DOMElements.progressStageElement.textContent = stageMessage;
}

function stageLabelFromEvent(event) {
  if (event?.chunkIndex && event?.chunkTotal) {
    return `${event.message} (${event.chunkIndex}/${event.chunkTotal})`;
  }
  return event?.message || "Transcription running...";
}

function renderFinalResult(response, requestedMode) {
  if (!response.success) {
    showError(`Transcription failed: ${response.error}`);
    DOMElements.progressMessageElement.textContent = "Job failed.";
    DOMElements.outputSection.classList.add("hidden");
    return;
  }

  if (response.isComplete !== true) {
    const coverageText =
      typeof response.coverageRatio === "number"
        ? ` Coverage: ${(response.coverageRatio * 100).toFixed(2)}%.`
        : "";
    showError(
      `Transcription is incomplete and was not saved as a successful run.${coverageText}`,
    );
    DOMElements.progressMessageElement.textContent = "Job incomplete.";
    DOMElements.outputSection.classList.add("hidden");
    return;
  }

  const resultText = response.result || "";
  setTranscriptionResult(resultText);
  setSubtitleArtifacts({
    generated: response.subtitleGenerated,
    formats: response.subtitleFormats || [],
    paths: response.subtitlePaths || {},
    cueCount: response.subtitleCueCount || 0,
    violationCount:
      response.subtitleViolationCount ||
      response.subtitleQuality?.violations?.length ||
      0,
    qualityReportPath: response.subtitleQualityReportPath || "",
    contents: response.subtitleContents || {},
    quality: response.subtitleQuality || null,
    trackLanguageTag: response.subtitleTrackLanguageTag || "",
  });
  DOMElements.transcriptionContent.textContent = resultText;
  DOMElements.outputSection.classList.remove("hidden");

  const modeUsed = response.modeUsed || requestedMode;
  const fallbackNotice = response.fallbackApplied
    ? " Whole-file transcription was automatically retried in parts mode."
    : "";
  const warningNotice =
    Array.isArray(response.warnings) && response.warnings.length > 0
      ? ` ${response.warnings.join(" ")}`
      : "";
  const extractionNotice = response.audioExtracted
    ? " Audio was extracted from MP4 before transcription."
    : "";
  const chunkSummary =
    typeof response.totalChunks === "number"
      ? ` Chunks: ${response.successfulChunks || 0}/${response.totalChunks} successful.`
      : "";
  const coverageSummary =
    typeof response.coverageRatio === "number"
      ? ` Coverage: ${(response.coverageRatio * 100).toFixed(2)}%.`
      : "";
  const subtitleSummary = response.subtitleGenerated
    ? ` Subtitles generated (${response.subtitleCueCount || 0} cues).`
    : "";
  const subtitlePathSummary = response.subtitlePaths
    ? `${response.subtitlePaths.srt ? ` SRT: ${response.subtitlePaths.srt}.` : ""}${
        response.subtitlePaths.vtt ? ` VTT: ${response.subtitlePaths.vtt}.` : ""
      }`
    : "";
  const subtitleQualitySummary = response.subtitleQuality
    ? ` Subtitle quality: ${response.subtitleQuality.status}.`
    : "";
  const subtitleViolationCount =
    response.subtitleViolationCount ??
    response.subtitleQuality?.violations?.length ??
    0;
  const subtitleWarnings =
    subtitleViolationCount > 0
      ? ` Subtitle issues: ${subtitleViolationCount}.`
      : "";
  const subtitleQualityReport = response.subtitleQualityReportPath
    ? ` Quality report: ${response.subtitleQualityReportPath}.`
    : "";

  let successMessage = `Transcription completed in ${modeUsed} mode.`;
  if (response.outputPath) {
    successMessage += ` Saved to: ${response.outputPath}`;
  }

  successMessage +=
    extractionNotice +
    fallbackNotice +
    chunkSummary +
    coverageSummary +
    subtitleSummary +
    subtitlePathSummary +
    subtitleQualitySummary +
    subtitleWarnings +
    subtitleQualityReport +
    warningNotice;
  showSuccess(successMessage);
  DOMElements.progressMessageElement.textContent = "Transcription completed.";
}

async function waitForTerminalSnapshot(jobId) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const snapshot = await Bridge.getTranscriptionJob(jobId);
    if (!snapshot.success) {
      throw new Error(
        snapshot.error || "Failed to retrieve transcription job status.",
      );
    }

    if (snapshot.progress) {
      setProgressPercent(snapshot.progress.percent || 0);
      setCurrentStage(snapshot.progress.stage || "queued");
      setChunkProgress(
        snapshot.progress.chunkIndex || 0,
        snapshot.progress.chunkTotal || 0,
      );
      setProgressView(
        snapshot.progress.percent || 0,
        stageLabelFromEvent(snapshot.progress),
      );
      DOMElements.progressMessageElement.textContent = stageLabelFromEvent(
        snapshot.progress,
      );
    }

    if (snapshot.status === "completed" || snapshot.status === "failed") {
      return {
        success: snapshot.status === "completed",
        result: snapshot.result,
        outputPath: snapshot.outputPath,
        error: snapshot.error,
        modeRequested: snapshot.modeRequested,
        modeUsed: snapshot.modeUsed,
        fallbackApplied: snapshot.fallbackApplied,
        warnings: snapshot.warnings || [],
        mediaKind: snapshot.mediaKind,
        audioExtracted: snapshot.audioExtracted,
        isComplete: snapshot.isComplete,
        totalChunks: snapshot.totalChunks,
        successfulChunks: snapshot.successfulChunks,
        failedChunks: snapshot.failedChunks,
        sourceDurationSec: snapshot.sourceDurationSec,
        transcribedDurationSec: snapshot.transcribedDurationSec,
        coverageRatio: snapshot.coverageRatio,
        subtitleGenerated: snapshot.subtitleGenerated,
        subtitleFormats: snapshot.subtitleFormats,
        subtitlePaths: snapshot.subtitlePaths,
        subtitleCueCount: snapshot.subtitleCueCount,
        subtitleViolationCount: snapshot.subtitleViolationCount,
        subtitleQualityReportPath: snapshot.subtitleQualityReportPath,
        subtitleQuality: snapshot.subtitleQuality,
        subtitleContents: snapshot.subtitleContents,
        subtitleTrackLanguageTag: snapshot.subtitleTrackLanguageTag,
      };
    }
  }
}

export function syncModeControls() {
  const mode = getTranscriptionMode();

  DOMElements.modeWholeRadio.checked = mode === "whole";
  DOMElements.modePartsRadio.checked = mode === "parts";
  DOMElements.chunkDurationInput.value = String(getChunkDuration());
  DOMElements.chunkDurationGroup.classList.toggle("hidden", mode !== "parts");
}

export function updateModeSelection() {
  const mode = getSelectedMode();
  const chunkDuration = getNormalizedChunkDuration();

  setTranscriptionMode(mode);
  setChunkDuration(chunkDuration);
  saveModePreferences(mode, chunkDuration);

  DOMElements.chunkDurationGroup.classList.toggle("hidden", mode !== "parts");
}

export function updateChunkDuration() {
  const chunkDuration = getNormalizedChunkDuration();
  DOMElements.chunkDurationInput.value = String(chunkDuration);

  const mode = getSelectedMode();
  setChunkDuration(chunkDuration);
  saveModePreferences(mode, chunkDuration);
}

/**
 * Update the current language based on the select element
 */
export function updateLanguageDisplay() {
  const selectedOption =
    DOMElements.languageSelect.options[
      DOMElements.languageSelect.selectedIndex
    ];
  setCurrentLanguage(selectedOption.value);
}

/**
 * Load available languages from the server
 */
export async function loadLanguages() {
  try {
    const languages = await Bridge.getAvailableLanguages();

    DOMElements.languageSelect.innerHTML = "";

    for (const lang of languages) {
      const languageName = await Bridge.getLanguageName(lang);
      const option = document.createElement("option");
      option.value = lang;
      option.textContent = languageName;
      DOMElements.languageSelect.appendChild(option);
    }

    DOMElements.languageSelect.value = "hy";
    setCurrentLanguage(DOMElements.languageSelect.value);
  } catch (error) {
    console.error("Error loading languages:", error);

    DOMElements.languageSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "hy";
    option.textContent = "Armenian";
    DOMElements.languageSelect.appendChild(option);

    setCurrentLanguage("hy");
    showError("Failed to load languages. Using Armenian as default.");
  }
}

/**
 * Transcribe the current audio file
 */
export async function transcribeAudio() {
  const currentFile = getCurrentFile();

  if (!currentFile) {
    showError("Please select an audio file or MP4 video first.");
    return;
  }

  if (isTranscriptionInProgress()) {
    return;
  }

  hideMessages();
  setTranscriptionInProgress(true);

  const originalButtonText = DOMElements.transcribeButton.textContent;
  DOMElements.transcribeButton.textContent = "Transcribing...";
  DOMElements.transcribeButton.disabled = true;

  DOMElements.progressElement.classList.remove("hidden");
  DOMElements.progressMessageElement.textContent =
    "Starting transcription job...";
  setProgressPercent(0);
  setCurrentStage("queued");
  setChunkProgress(0, 0);
  setLivePartialText("");
  setSubtitleArtifacts({});
  setProgressView(0, "Queued...");

  const mode = getSelectedMode();
  const chunkDuration = getNormalizedChunkDuration();
  const currentFileData = getCurrentFileData();

  try {
    const settings = getSettings();

    const options = {
      languageCode: getCurrentLanguage(),
      outputFolder: getOutputFolder(),
      apiKey: settings.apiKey,
      transcriptionMode: mode,
      originalName: currentFileData?.originalName,
      mimeTypeHint: currentFileData?.mimeType,
      ...(mode === "parts" ? { chunkDuration } : {}),
    };

    const startResponse = await Bridge.startTranscriptionJob(
      currentFile,
      options,
    );
    if (!startResponse.success || !startResponse.jobId) {
      showError(
        `Failed to start job: ${startResponse.error || "Unknown error"}`,
      );
      DOMElements.progressMessageElement.textContent = "Job failed.";
      DOMElements.outputSection.classList.add("hidden");
      return;
    }

    const jobId = startResponse.jobId;
    setCurrentJobId(jobId);

    let terminalResult = null;
    let sseFailed = false;

    await new Promise((resolve) => {
      const source = Bridge.subscribeToTranscriptionJob(jobId);

      source.onmessage = (messageEvent) => {
        try {
          const event = JSON.parse(messageEvent.data);
          const percent = Number.isFinite(event.percent) ? event.percent : 0;
          const label = stageLabelFromEvent(event);

          setCurrentStage(event.stage || "queued");
          setProgressPercent(percent);
          setChunkProgress(event.chunkIndex || 0, event.chunkTotal || 0);
          setProgressView(percent, label);
          DOMElements.progressMessageElement.textContent = label;

          if (
            event.partialText &&
            (event.modeUsed === "parts" || mode === "parts")
          ) {
            const snippet = event.partialText.trim();
            if (snippet.length > 0) {
              DOMElements.outputSection.classList.remove("hidden");
              if (DOMElements.transcriptionContent.textContent.length > 0) {
                DOMElements.transcriptionContent.textContent += `\n\n${snippet}`;
              } else {
                DOMElements.transcriptionContent.textContent = snippet;
              }
              setLivePartialText(DOMElements.transcriptionContent.textContent);
            }
          }

          if (event.stage === "completed" || event.stage === "failed") {
            source.close();
            resolve();
          }
        } catch (_error) {
          // Ignore malformed event payloads and keep listening.
        }
      };

      source.onerror = () => {
        sseFailed = true;
        source.close();
        resolve();
      };
    });

    if (sseFailed) {
      DOMElements.progressMessageElement.textContent =
        "Connection interrupted. Recovering job status...";
    }

    terminalResult = await waitForTerminalSnapshot(jobId);
    renderFinalResult(terminalResult, mode);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Error during transcription: ${errorMessage}`);
    DOMElements.progressMessageElement.textContent = "Job failed.";
  } finally {
    DOMElements.transcribeButton.textContent = originalButtonText;
    DOMElements.transcribeButton.disabled = false;
    DOMElements.progressElement.classList.add("hidden");
    setTranscriptionInProgress(false);
  }
}
