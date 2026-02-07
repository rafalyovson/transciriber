import DOMElements from './dom-elements.js'
import { getSubtitleArtifacts, getTranscriptionResult } from './state.js'
import { showError, padZero } from './ui-utils.js'

/**
 * Export transcription in the specified format
 * @param {string} format - The format to export (txt, srt, vtt)
 */
export function exportTranscription(format) {
  const transcriptionResult = getTranscriptionResult()

  if (!transcriptionResult) {
    showError('No transcription to export.')
    return
  }

  const subtitleArtifacts = getSubtitleArtifacts()

  let content = transcriptionResult
  let mimeType = 'text/plain'
  let extension = 'txt'

  if (format === 'srt') {
    extension = 'srt'

    if (subtitleArtifacts?.generated && subtitleArtifacts?.contents?.srt) {
      content = subtitleArtifacts.contents.srt
    } else {
      content = convertToApproximateSRT(transcriptionResult)
      showError('Backend subtitles are unavailable. Exporting approximate SRT timing.')
    }
  } else if (format === 'vtt') {
    extension = 'vtt'
    mimeType = 'text/vtt'

    if (subtitleArtifacts?.generated && subtitleArtifacts?.contents?.vtt) {
      content = subtitleArtifacts.contents.vtt
    } else {
      content = convertToApproximateVTT(transcriptionResult)
      showError('Backend subtitles are unavailable. Exporting approximate VTT timing.')
    }
  }

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `transcription.${extension}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  DOMElements.exportOptions.classList.remove('show')
}

/**
 * Convert plain text to approximate SRT format.
 */
function convertToApproximateSRT(text) {
  const lines = text.split('\n\n')
  let srt = ''

  lines.forEach((line, index) => {
    if (line.trim()) {
      const startTime = formatSRTTime(index * 5)
      const endTime = formatSRTTime(index * 5 + 4.9)

      srt += `${index + 1}\n${startTime} --> ${endTime}\n${line}\n\n`
    }
  })

  return srt
}

/**
 * Format time for SRT format
 */
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)

  return `${padZero(hours)}:${padZero(minutes)}:${padZero(secs)},${padZero(ms, 3)}`
}

/**
 * Convert plain text to approximate VTT format.
 */
function convertToApproximateVTT(text) {
  const lines = text.split('\n\n')
  let vtt = 'WEBVTT\n\n'

  lines.forEach((line, index) => {
    if (line.trim()) {
      const startTime = formatVTTTime(index * 5)
      const endTime = formatVTTTime(index * 5 + 4.9)

      vtt += `${startTime} --> ${endTime}\n${line}\n\n`
    }
  })

  return vtt
}

/**
 * Format time for VTT format
 */
function formatVTTTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)

  return `${padZero(hours)}:${padZero(minutes)}:${padZero(secs)}.${padZero(ms, 3)}`
}

/**
 * Copy transcription to clipboard
 */
export function copyTranscription() {
  const transcriptionResult = getTranscriptionResult()

  if (!transcriptionResult) {
    showError('No transcription to copy.')
    return
  }

  navigator.clipboard.writeText(transcriptionResult)
    .then(() => {
      const originalText = DOMElements.copyButton.innerHTML
      DOMElements.copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> Copied!'

      setTimeout(() => {
        DOMElements.copyButton.innerHTML = originalText
      }, 2000)
    })
    .catch((err) => {
      console.error('Failed to copy: ', err)
      showError('Failed to copy to clipboard.')
    })
}
