import DOMElements from "./dom-elements.js";

/**
 * Format file size in human-readable format
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";

  const unit = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(unit));

  return `${parseFloat((bytes / Math.pow(unit, index)).toFixed(2))} ${sizes[index]}`;
}

/**
 * Create waveform visualization placeholder
 * @param {HTMLElement} container
 */
export function createWaveformVisualization(container) {
  container.innerHTML = "";

  const canvas = document.createElement("canvas");
  canvas.width = container.clientWidth;
  canvas.height = 62;
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const computedStyles = getComputedStyle(document.documentElement);
  const accent =
    computedStyles.getPropertyValue("--brand-500").trim() || "#71cead";

  ctx.fillStyle = `${accent}55`;

  const barWidth = 3;
  const barGap = 2;
  const barCount = Math.floor(canvas.width / (barWidth + barGap));

  for (let i = 0; i < barCount; i++) {
    const barHeight = Math.random() * canvas.height * 0.75 + 4;
    const x = i * (barWidth + barGap);
    const y = (canvas.height - barHeight) / 2;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}

/**
 * Show error message
 * @param {string} message
 */
export function showError(message) {
  DOMElements.errorMessageElement.textContent = message;
  DOMElements.errorMessageElement.classList.remove("hidden");
  DOMElements.successMessageElement.classList.add("hidden");
}

/**
 * Show success message
 * @param {string} message
 */
export function showSuccess(message) {
  DOMElements.successMessageElement.textContent = message;
  DOMElements.successMessageElement.classList.remove("hidden");
  DOMElements.errorMessageElement.classList.add("hidden");
}

/**
 * Hide all notifications
 */
export function hideMessages() {
  DOMElements.errorMessageElement.classList.add("hidden");
  DOMElements.successMessageElement.classList.add("hidden");
}

/**
 * Pad number with leading zeros
 * @param {number} num
 * @param {number} size
 * @returns {string}
 */
export function padZero(num, size = 2) {
  let value = num.toString();
  while (value.length < size) value = `0${value}`;
  return value;
}
