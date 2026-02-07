import { LanguageSubtitleProfile, SubtitleCue, SubtitleQualityReport } from 'types'

export type SubtitleQualityInput = {
  cues: SubtitleCue[]
  profile: LanguageSubtitleProfile
  sourceDurationSec?: number
  strict?: boolean
  frameRate?: number
  maxHardViolationRatio?: number
}

const TIMING_EPSILON_SEC = 0.001

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  )
  return sorted[index]
}

function computeCps(text: string, durationSec: number): number {
  if (durationSec <= 0) return 0
  return text.length / durationSec
}

export class SubtitleQualityService {
  evaluate(input: SubtitleQualityInput): SubtitleQualityReport {
    const {
      cues,
      profile,
      sourceDurationSec = 0,
      frameRate,
    } = input

    const violations: string[] = []
    const cpsValues: number[] = []
    const durationValues: number[] = []

    let structuralViolationCount = 0
    let readabilityHardViolationCount = 0
    let readabilityWarningCount = 0
    let previousEnd = -1
    let previousStart = -1

    if (cues.length === 0) {
      return {
        status: 'fail',
        violations: ['No subtitle cues were generated.'],
        metrics: {
          cueCount: 0,
          structuralViolationCount: 1,
          readabilityHardViolationCount: 0,
          readabilityWarningCount: 0,
          hardViolationCount: 1,
          hardViolationRatio: 1,
          readabilityHardViolationRatio: 0,
          coverageRatio: 0,
        },
      }
    }

    // Only enforce frame-aware minimum gap when frame rate is known.
    // Without frame rate metadata, tiny sub-frame gaps create noisy false positives.
    const minimumGapSec = frameRate && frameRate > 0 ? 1 / frameRate : 0

    for (const cue of cues) {
      if (
        !Number.isFinite(cue.startSec) || !Number.isFinite(cue.endSec) || cue.endSec <= cue.startSec
      ) {
        violations.push(`Invalid cue timing at index ${cue.index}.`)
        structuralViolationCount += 1
        continue
      }

      if (previousStart >= 0 && cue.startSec < previousStart - TIMING_EPSILON_SEC) {
        violations.push(`Non-monotonic cue order around index ${cue.index}.`)
        structuralViolationCount += 1
      }

      if (previousEnd >= 0 && cue.startSec < previousEnd - TIMING_EPSILON_SEC) {
        violations.push(`Overlapping cues detected around index ${cue.index}.`)
        structuralViolationCount += 1
      }

      if (previousEnd >= 0 && minimumGapSec > TIMING_EPSILON_SEC) {
        const gapSec = cue.startSec - previousEnd
        if (gapSec >= -TIMING_EPSILON_SEC && gapSec < minimumGapSec - TIMING_EPSILON_SEC) {
          violations.push(`Cue gap below minimum around index ${cue.index}.`)
          readabilityHardViolationCount += 1
        }
      }

      previousStart = cue.startSec
      previousEnd = cue.endSec

      const lines = cue.text.split('\n')
      if (lines.length > profile.maxLinesPerCue) {
        violations.push(
          `Cue ${cue.index} exceeds line count limit (${lines.length}/${profile.maxLinesPerCue}).`,
        )
        readabilityHardViolationCount += 1
      }

      const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0)
      if (maxLineLength > profile.maxCharsPerLine) {
        violations.push(
          `Cue ${cue.index} exceeds max chars per line (${maxLineLength}/${profile.maxCharsPerLine}).`,
        )
        readabilityHardViolationCount += 1
      }

      const durationSec = cue.endSec - cue.startSec
      durationValues.push(durationSec)

      if (durationSec < profile.minCueDurationSec || durationSec > profile.maxCueDurationSec) {
        violations.push(
          `Cue ${cue.index} has out-of-range duration (${durationSec.toFixed(2)}s).`,
        )
        readabilityHardViolationCount += 1
      }

      const cps = computeCps(cue.text.replace(/\s+/g, ' ').trim(), durationSec)
      cpsValues.push(cps)

      if (cps > profile.cpsHardLimit) {
        violations.push(
          `Cue ${cue.index} exceeds hard CPS (${cps.toFixed(2)}/${profile.cpsHardLimit}).`,
        )
        readabilityHardViolationCount += 1
      } else if (cps > profile.cpsTarget) {
        readabilityWarningCount += 1
      }
    }

    const coverageRatio = sourceDurationSec > 0
      ? (cues[cues.length - 1].endSec / sourceDurationSec)
      : 1
    if (sourceDurationSec > 0 && coverageRatio < 0.99 - TIMING_EPSILON_SEC) {
      violations.push(
        `Subtitle timing coverage below threshold (${(coverageRatio * 100).toFixed(2)}% < 99%).`,
      )
      structuralViolationCount += 1
    }

    const hardViolationCount = structuralViolationCount + readabilityHardViolationCount
    const hardViolationRatio = cues.length > 0 ? hardViolationCount / cues.length : 1
    const readabilityHardViolationRatio = cues.length > 0
      ? readabilityHardViolationCount / cues.length
      : 1

    const metrics: Record<string, number> = {
      cueCount: cues.length,
      hardViolationCount,
      hardViolationRatio,
      structuralViolationCount,
      readabilityHardViolationCount,
      readabilityHardViolationRatio,
      readabilityWarningCount,
      avgCps: cpsValues.length > 0
        ? cpsValues.reduce((sum, value) => sum + value, 0) / cpsValues.length
        : 0,
      p95Cps: percentile(cpsValues, 95),
      maxCps: cpsValues.length > 0 ? Math.max(...cpsValues) : 0,
      minCueDurationSec: durationValues.length > 0 ? Math.min(...durationValues) : 0,
      maxCueDurationSec: durationValues.length > 0 ? Math.max(...durationValues) : 0,
      coverageRatio,
    }

    if (structuralViolationCount > 0) {
      return {
        status: 'fail',
        violations,
        metrics,
      }
    }

    if (readabilityHardViolationCount > 0 || readabilityWarningCount > 0) {
      return {
        status: 'review_required',
        violations,
        metrics,
      }
    }

    return {
      status: 'pass',
      violations,
      metrics,
    }
  }
}
