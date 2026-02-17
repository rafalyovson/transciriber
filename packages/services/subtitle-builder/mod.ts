import type {
  AdditionalTranscriptFormat,
  LanguageSubtitleProfile,
  SubtitleArtifacts,
  SubtitleCue,
  SubtitleFormat,
  TranscriptionWord,
} from '@transcriber/core'
import { normalizeSubtitleText } from '@transcriber/subtitle-profiles'

const SENTENCE_BREAK_REGEX = /[.!?։…]$/u
const MIN_CUE_DURATION_SEC = 0.05
const DEFAULT_MIN_GAP_SEC = 0.02
const ROUND_MS = 1000

export type SubtitleChunkInput = {
  startSec: number
  durationSec: number
  text: string
  words: TranscriptionWord[]
  additionalFormats: AdditionalTranscriptFormat[]
}

export type SubtitleBuildInput = {
  text: string
  words: TranscriptionWord[]
  additionalFormats: AdditionalTranscriptFormat[]
  profile: LanguageSubtitleProfile
  trackLanguageTag: string
  sourceDurationSec?: number
  chunks?: SubtitleChunkInput[]
}

export type SubtitleBuildResult = {
  cues: SubtitleCue[]
  artifacts: SubtitleArtifacts
  warnings: string[]
}

function roundToMs(value: number): number {
  return Math.round(value * ROUND_MS) / ROUND_MS
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!match) return null

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const seconds = Number.parseInt(match[3], 10)
  const millis = Number.parseInt(match[4], 10)

  if (![hours, minutes, seconds, millis].every(Number.isFinite)) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

function formatTimestamp(value: number, msSeparator: string): string {
  const clamped = Math.max(0, value)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const seconds = Math.floor(clamped % 60)
  const millis = Math.floor((clamped - Math.floor(clamped)) * 1000)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${
    seconds
      .toString()
      .padStart(2, '0')
  }${msSeparator}${millis.toString().padStart(3, '0')}`
}

function formatSrtTimestamp(value: number): string {
  return formatTimestamp(value, ',')
}

function formatVttTimestamp(value: number): string {
  return formatTimestamp(value, '.')
}

function splitSrtBlocks(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

export function parseSrt(content: string, offsetSec = 0): SubtitleCue[] {
  const cues: SubtitleCue[] = []

  for (const block of splitSrtBlocks(content)) {
    const lines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
    if (lines.length < 2) continue

    const timeLineIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeLineIndex === -1) continue

    const timeParts = lines[timeLineIndex].split('-->')
    if (timeParts.length !== 2) continue

    const start = parseTimestamp(timeParts[0].trim())
    const end = parseTimestamp(timeParts[1].trim())
    if (start === null || end === null || end <= start) {
      continue
    }

    const textLines = lines.slice(timeLineIndex + 1)
    const text = normalizeSubtitleText(textLines.join('\n').trim())
    if (!text) {
      continue
    }

    cues.push({
      index: cues.length + 1,
      startSec: start + offsetSec,
      endSec: end + offsetSec,
      text,
      lines: text.split('\n'),
    })
  }

  return cues
}

function getProviderSrt(formats: AdditionalTranscriptFormat[]): string | null {
  const direct = formats.find(
    (format) => format.format.toLowerCase() === 'srt',
  )
  return direct?.content?.trim() || null
}

function normalizeCueText(value: string): string {
  return normalizeSubtitleText(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function wrapLineWords(line: string, maxCharsPerLine: number): string[] {
  if (line.length <= maxCharsPerLine) {
    return [line]
  }

  const words = line.split(/\s+/).filter((word) => word.length > 0)
  const wrapped: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharsPerLine || current.length === 0) {
      current = candidate
    } else {
      wrapped.push(current)
      current = word
    }
  }

  if (current) {
    wrapped.push(current)
  }

  return wrapped
}

function wrapTextToLines(text: string, maxCharsPerLine: number): string[] {
  const normalized = normalizeCueText(text)
  if (!normalized) return []

  const inputLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const wrapped: string[] = []

  for (const line of inputLines) {
    wrapped.push(...wrapLineWords(line, maxCharsPerLine))
  }

  return wrapped
}

function groupLinesIntoCueTexts(
  lines: string[],
  maxLinesPerCue: number,
): string[] {
  if (lines.length === 0) {
    return []
  }

  const grouped: string[] = []
  for (let i = 0; i < lines.length; i += maxLinesPerCue) {
    grouped.push(lines.slice(i, i + maxLinesPerCue).join('\n'))
  }

  return grouped
}

function splitTextByWords(text: string, targetParts: number): string[] {
  const words = text
    .replace(/\n/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return []

  const parts = Math.max(1, Math.min(targetParts, words.length))
  const result: string[] = []

  for (let index = 0; index < parts; index++) {
    const start = Math.floor((index * words.length) / parts)
    const end = Math.floor(((index + 1) * words.length) / parts)
    const segment = words.slice(start, end).join(' ').trim()
    if (segment.length > 0) {
      result.push(segment)
    }
  }

  return result.length > 0 ? result : [text]
}

function expandCueTextsForDuration(
  cueTexts: string[],
  totalDurationSec: number,
  maxCueDurationSec: number,
): string[] {
  if (cueTexts.length === 0 || maxCueDurationSec <= 0) {
    return cueTexts
  }

  const requiredCount = Math.max(
    1,
    Math.ceil(totalDurationSec / maxCueDurationSec),
  )
  if (requiredCount <= cueTexts.length) {
    return cueTexts
  }

  const expanded = [...cueTexts]
  while (expanded.length < requiredCount) {
    let longestIndex = 0
    let longestLength = 0

    for (let index = 0; index < expanded.length; index++) {
      const length = expanded[index].replace(/\n/g, ' ').length
      if (length > longestLength) {
        longestLength = length
        longestIndex = index
      }
    }

    const longest = expanded[longestIndex]
    const splitParts = splitTextByWords(longest, 2)
    if (splitParts.length < 2) {
      break
    }

    expanded.splice(longestIndex, 1, splitParts[0], splitParts[1])
  }

  return expanded
}

function allocateDurations(
  totalDurationSec: number,
  weights: number[],
): number[] {
  if (weights.length === 0) return []

  const totalDuration = Math.max(
    MIN_CUE_DURATION_SEC * weights.length,
    totalDurationSec,
  )
  const safeWeights = weights.map((weight) => Math.max(1, weight))
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0)

  let durations = safeWeights.map(
    (weight) => (weight / totalWeight) * totalDuration,
  )

  let shortfall = 0
  for (let index = 0; index < durations.length; index++) {
    if (durations[index] < MIN_CUE_DURATION_SEC) {
      shortfall += MIN_CUE_DURATION_SEC - durations[index]
      durations[index] = MIN_CUE_DURATION_SEC
    }
  }

  if (shortfall > 0) {
    const adjustableIndices = durations
      .map((duration, index) => ({ duration, index }))
      .filter(({ duration }) => duration > MIN_CUE_DURATION_SEC)
      .map(({ index }) => index)

    while (shortfall > 0 && adjustableIndices.length > 0) {
      const decrement = shortfall / adjustableIndices.length
      let applied = 0

      for (const index of adjustableIndices) {
        const headroom = durations[index] - MIN_CUE_DURATION_SEC
        const delta = Math.min(headroom, decrement)
        durations[index] -= delta
        applied += delta
      }

      shortfall = Math.max(0, shortfall - applied)
      if (applied === 0) {
        break
      }
    }
  }

  const finalTotal = durations.reduce((sum, duration) => sum + duration, 0)
  if (finalTotal > 0) {
    const scale = totalDurationSec / finalTotal
    durations = durations.map((duration) => Math.max(MIN_CUE_DURATION_SEC, duration * scale))
  }

  return durations
}

function repairCue(
  cue: SubtitleCue,
  profile: LanguageSubtitleProfile,
): SubtitleCue[] {
  const totalDurationSec = Math.max(
    MIN_CUE_DURATION_SEC,
    cue.endSec - cue.startSec,
  )
  const wrappedLines = wrapTextToLines(cue.text, profile.maxCharsPerLine)
  let cueTexts = groupLinesIntoCueTexts(wrappedLines, profile.maxLinesPerCue)

  if (cueTexts.length === 0) {
    cueTexts = [cue.text]
  }

  cueTexts = expandCueTextsForDuration(
    cueTexts,
    totalDurationSec,
    profile.maxCueDurationSec,
  )

  const weights = cueTexts.map(
    (text) => text.replace(/\s+/g, ' ').trim().length,
  )
  const durations = allocateDurations(totalDurationSec, weights)

  const repaired: SubtitleCue[] = []
  let cursor = cue.startSec

  for (let index = 0; index < cueTexts.length; index++) {
    const text = normalizeCueText(cueTexts[index])
    if (!text) continue

    const duration = durations[index] || MIN_CUE_DURATION_SEC
    const startSec = cursor
    const endSec = cursor + duration

    repaired.push({
      index: 0,
      startSec,
      endSec,
      text,
      lines: text.split('\n'),
    })

    cursor = endSec
  }

  if (repaired.length === 0) {
    return [cue]
  }

  // Keep the original cue end to preserve timeline coverage.
  const delta = cue.endSec - repaired[repaired.length - 1].endSec
  if (Math.abs(delta) > 1e-6) {
    repaired[repaired.length - 1].endSec += delta
  }

  return repaired
}

function repairCues(
  cues: SubtitleCue[],
  profile: LanguageSubtitleProfile,
): SubtitleCue[] {
  const repaired: SubtitleCue[] = []

  for (const cue of cues) {
    repaired.push(...repairCue(cue, profile))
  }

  return repaired
}

function sortWords(words: TranscriptionWord[]): TranscriptionWord[] {
  return [...words]
    .filter(
      (word) =>
        Number.isFinite(word.startSec) &&
        Number.isFinite(word.endSec) &&
        word.endSec > word.startSec,
    )
    .sort((a, b) => a.startSec - b.startSec)
}

function buildCuesFromWords(
  words: TranscriptionWord[],
  profile: LanguageSubtitleProfile,
  offsetSec: number,
): SubtitleCue[] {
  const sortedWords = sortWords(words)
  if (sortedWords.length === 0) return []

  const cues: SubtitleCue[] = []
  let current: TranscriptionWord[] = []

  const pushCurrentCue = () => {
    if (current.length === 0) {
      return
    }

    const startSec = Math.max(0, current[0].startSec + offsetSec)
    const endSec = Math.max(
      startSec + MIN_CUE_DURATION_SEC,
      current[current.length - 1].endSec + offsetSec,
    )
    const text = normalizeCueText(current.map((word) => word.text).join(' '))

    if (text.length > 0) {
      cues.push({
        index: 0,
        startSec,
        endSec,
        text,
        lines: text.split('\n'),
      })
    }

    current = []
  }

  for (const word of sortedWords) {
    current.push(word)

    const start = current[0].startSec
    const end = current[current.length - 1].endSec
    const durationSec = end - start
    const previewText = current
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const shouldBreak = durationSec >= profile.maxCueDurationSec ||
      previewText.length >= profile.maxCharsPerLine * profile.maxLinesPerCue ||
      SENTENCE_BREAK_REGEX.test(word.text.trim())

    if (shouldBreak) {
      pushCurrentCue()
    }
  }

  pushCurrentCue()
  return cues
}

function splitSentences(text: string): string[] {
  const normalized = normalizeCueText(text)
  if (!normalized) return []

  return normalized
    .split(/(?<=[.!?։…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function buildCuesFromPlainText(
  text: string,
  profile: LanguageSubtitleProfile,
  sourceDurationSec: number,
  offsetSec: number,
): SubtitleCue[] {
  const sentences = splitSentences(text)
  if (sentences.length === 0) {
    return []
  }

  const totalDuration = sourceDurationSec > 0 ? sourceDurationSec : sentences.length * 3
  const durations = allocateDurations(
    totalDuration,
    sentences.map((sentence) => sentence.length),
  )

  const cues: SubtitleCue[] = []
  let cursor = offsetSec

  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index]
    const duration = durations[index] || MIN_CUE_DURATION_SEC
    const textLines = groupLinesIntoCueTexts(
      wrapTextToLines(sentence, profile.maxCharsPerLine),
      profile.maxLinesPerCue,
    )

    for (const textChunk of textLines) {
      const chunkDuration = duration / textLines.length
      cues.push({
        index: 0,
        startSec: cursor,
        endSec: cursor + chunkDuration,
        text: textChunk,
        lines: textChunk.split('\n'),
      })
      cursor += chunkDuration
    }
  }

  return cues
}

function normalizeCueSequence(
  cues: SubtitleCue[],
  minGapSec = DEFAULT_MIN_GAP_SEC,
): SubtitleCue[] {
  if (cues.length === 0) return []

  const sorted = [...cues].sort((a, b) => a.startSec - b.startSec)
  const normalized: SubtitleCue[] = []
  let previousEnd = 0

  for (const cue of sorted) {
    let startSec = roundToMs(Math.max(0, cue.startSec))
    let endSec = roundToMs(
      Math.max(startSec + MIN_CUE_DURATION_SEC, cue.endSec),
    )

    const minAllowedStart = roundToMs(previousEnd + minGapSec)
    if (startSec < minAllowedStart) {
      startSec = minAllowedStart
      if (endSec <= startSec) {
        endSec = roundToMs(startSec + MIN_CUE_DURATION_SEC)
      }
    }

    const text = normalizeCueText(cue.text)
    if (!text) {
      continue
    }

    normalized.push({
      index: normalized.length + 1,
      startSec,
      endSec,
      text,
      lines: text.split('\n'),
    })

    previousEnd = endSec
  }

  return normalized
}

export function serializeSrt(cues: SubtitleCue[]): string {
  return (
    cues
      .map((cue, idx) => {
        const index = idx + 1
        return `${index}\n${formatSrtTimestamp(cue.startSec)} --> ${
          formatSrtTimestamp(
            cue.endSec,
          )
        }\n${cue.text}`
      })
      .join('\n\n') + '\n'
  )
}

export function serializeVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(cue.endSec)}\n${cue.text}`,
    )
    .join('\n\n')

  return `WEBVTT\n\n${body}\n`
}

function validateSerializedSubtitles(
  content: string,
  format: SubtitleFormat,
): boolean {
  if (format === 'srt') {
    return parseSrt(content).length > 0
  }

  return content.startsWith('WEBVTT') && /-->/.test(content)
}

export class SubtitleBuilderService {
  buildSubtitles(input: SubtitleBuildInput): SubtitleBuildResult {
    const warnings: string[] = []
    let cues: SubtitleCue[] = []
    let source: 'provider' | 'local' | 'mixed' = 'local'

    const buildFromProvider = (): SubtitleCue[] => {
      if (Array.isArray(input.chunks) && input.chunks.length > 0) {
        const merged: SubtitleCue[] = []

        for (const chunk of input.chunks) {
          const srt = getProviderSrt(chunk.additionalFormats)
          if (!srt) {
            return []
          }

          const parsed = parseSrt(srt, chunk.startSec)
          if (parsed.length === 0) {
            return []
          }

          merged.push(...parsed)
        }

        return merged
      }

      const srt = getProviderSrt(input.additionalFormats)
      if (!srt) return []
      return parseSrt(srt)
    }

    const providerCues = buildFromProvider()
    if (providerCues.length > 0) {
      cues = providerCues
      source = 'provider'
    } else {
      if (Array.isArray(input.chunks) && input.chunks.length > 0) {
        const merged: SubtitleCue[] = []

        for (const chunk of input.chunks) {
          const wordCues = buildCuesFromWords(
            chunk.words,
            input.profile,
            chunk.startSec,
          )
          if (wordCues.length > 0) {
            merged.push(...wordCues)
            continue
          }

          const plainTextCues = buildCuesFromPlainText(
            chunk.text,
            input.profile,
            chunk.durationSec,
            chunk.startSec,
          )
          merged.push(...plainTextCues)
        }

        cues = merged
      } else {
        const wordCues = buildCuesFromWords(input.words, input.profile, 0)
        if (wordCues.length > 0) {
          cues = wordCues
        } else {
          cues = buildCuesFromPlainText(
            input.text,
            input.profile,
            input.sourceDurationSec || 0,
            0,
          )
        }
      }

      warnings.push(
        'Provider subtitle export unavailable; generated subtitles from transcription timing.',
      )
      source = 'local'
    }

    const repairedCues = repairCues(cues, input.profile)
    const normalizedCues = normalizeCueSequence(repairedCues)
    const srt = serializeSrt(normalizedCues)
    const vtt = serializeVtt(normalizedCues)

    if (
      !validateSerializedSubtitles(srt, 'srt') ||
      !validateSerializedSubtitles(vtt, 'vtt')
    ) {
      throw new Error('Generated subtitle output failed format validation.')
    }

    return {
      cues: normalizedCues,
      artifacts: {
        generated: normalizedCues.length > 0,
        formats: ['srt', 'vtt'],
        cueCount: normalizedCues.length,
        contents: {
          srt,
          vtt,
        },
        source,
        trackLanguageTag: input.trackLanguageTag,
      },
      warnings,
    }
  }
}
