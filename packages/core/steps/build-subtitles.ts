import type {
  AdditionalTranscriptFormat,
  LanguageSubtitleProfile,
  SubtitleArtifacts,
  SubtitleQualityReport,
  TranscriptionWord,
} from '../types.ts'
import type { Result } from '../result.ts'
import { SubtitleBuilderService } from '@transcriber/subtitle-builder'
import type { SubtitleChunkInput } from '@transcriber/subtitle-builder'
import { SubtitleQualityService } from '@transcriber/subtitle-quality'
import { detectMixedScriptWarnings } from '@transcriber/subtitle-profiles'

export type BuildSubtitlesInput = {
  text: string
  words: TranscriptionWord[]
  additionalFormats: AdditionalTranscriptFormat[]
  sourceDurationSec: number
  profile: LanguageSubtitleProfile
  trackLanguageTag: string
  chunks?: SubtitleChunkInput[]
  strictQuality: boolean
  maxHardViolationRatio: number
}

export type BuildSubtitlesOutput = {
  artifacts: SubtitleArtifacts
  quality: SubtitleQualityReport
  warnings: string[]
  shouldFail: boolean
  failureMessage?: string
}

function summarizeViolations(violations: string[], maxItems = 8): string {
  if (violations.length === 0) return 'No detailed violations were provided.'
  const head = violations.slice(0, maxItems).join(' ')
  const remaining = violations.length - Math.min(maxItems, violations.length)
  return remaining > 0
    ? `${head} (+${remaining} more; see subtitle quality report for full details).`
    : head
}

export function buildSubtitles(
  input: BuildSubtitlesInput,
): Result<BuildSubtitlesOutput, Error> {
  try {
    const builder = new SubtitleBuilderService()
    const qualityService = new SubtitleQualityService()

    const built = builder.buildSubtitles({
      text: input.text,
      words: input.words,
      additionalFormats: input.additionalFormats,
      profile: input.profile,
      trackLanguageTag: input.trackLanguageTag,
      sourceDurationSec: input.sourceDurationSec,
      chunks: input.chunks,
    })

    const quality = qualityService.evaluate({
      cues: built.cues,
      profile: input.profile,
      sourceDurationSec: input.sourceDurationSec,
      strict: input.strictQuality,
      maxHardViolationRatio: input.maxHardViolationRatio,
    })

    const mixedScriptWarnings = detectMixedScriptWarnings(
      built.cues.map((cue) => cue.text).join('\n'),
      input.profile,
    )
    const warnings = [...built.warnings, ...mixedScriptWarnings]
    const shouldFail = quality.status === 'fail'
    const failureMessage = shouldFail
      ? `Subtitle quality checks failed in strict mode: ${summarizeViolations(quality.violations)}`
      : undefined

    return {
      ok: true,
      data: {
        artifacts: built.artifacts,
        quality,
        warnings,
        shouldFail,
        failureMessage,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new Error(message) }
  }
}
