import { join } from '@std/path'
import type {
  AdditionalTranscriptFormat,
  InputMediaKind,
  LanguageSubtitleProfile,
  SubtitlePolicy,
  SubtitleQualityReport,
  TranscriptionConfig,
  TranscriptionMode,
  TranscriptionWord,
} from './types.ts'
import type { EventBus, PipelineEvents } from './events.ts'
import { inspectMedia } from './steps/inspect.ts'
import { preprocessMedia } from './steps/preprocess.ts'
import { resolveStrategy } from './steps/resolve-strategy.ts'
import { transcribeWhole } from './steps/transcribe-whole.ts'
import { transcribeParts, type TranscribePartsOutput } from './steps/transcribe-parts.ts'
import { buildSubtitles } from './steps/build-subtitles.ts'
import { persistOutput } from './steps/persist-output.ts'
import {
  resolveSttLanguageCode,
  resolveSubtitleKeyterms,
  resolveSubtitleProfile,
} from '@transcriber/subtitle-profiles'
import type { SubtitleChunkInput } from '@transcriber/subtitle-builder'
import { setupEnv } from './env.ts'

const COVERAGE_MIN_RATIO = 0.99
const SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO = 0.05

export type TranscriptionRunOptions = {
  mode?: TranscriptionMode
  chunkDuration?: number
  outputFileName?: string
  mimeTypeHint?: string
  outputDir?: string
  subtitleOptions?: SubtitlePolicy & { keyterms?: string[] }
  jobId?: string
}

export type TranscriptionOutput = {
  success: boolean
  data?: string
  error?: string
  outputPath?: string
  modeRequested?: TranscriptionMode
  modeUsed?: TranscriptionMode
  fallbackApplied?: boolean
  warnings?: string[]
  mediaKind?: InputMediaKind
  audioExtracted?: boolean
  isComplete: boolean
  totalChunks?: number
  successfulChunks?: number
  failedChunks?: number
  sourceDurationSec?: number
  transcribedDurationSec?: number
  coverageRatio?: number
  subtitleGenerated?: boolean
  subtitleFormats?: Array<'srt' | 'vtt'>
  subtitlePaths?: { srt?: string; vtt?: string }
  subtitleCueCount?: number
  subtitleQuality?: SubtitleQualityReport
  subtitleViolationCount?: number
  subtitleQualityReportPath?: string
  subtitleContents?: { srt?: string; vtt?: string }
  subtitleTrackLanguageTag?: string
}

type SubtitleRuntimeConfig = {
  enabled: boolean
  strictQuality: boolean
  maxHardViolationRatio: number
}

function resolveSubtitleRuntimeConfig(
  mediaKind: InputMediaKind,
  subtitleOptions?: TranscriptionRunOptions['subtitleOptions'],
): SubtitleRuntimeConfig {
  if (mediaKind === 'video') {
    const maxHardViolationRatio = typeof subtitleOptions?.maxHardViolationRatio === 'number' &&
        Number.isFinite(subtitleOptions.maxHardViolationRatio) &&
        subtitleOptions.maxHardViolationRatio >= 0
      ? subtitleOptions.maxHardViolationRatio
      : SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO
    return { enabled: true, strictQuality: true, maxHardViolationRatio }
  }

  return {
    enabled: subtitleOptions?.enabled ?? false,
    strictQuality: subtitleOptions?.strictQuality ?? false,
    maxHardViolationRatio: typeof subtitleOptions?.maxHardViolationRatio === 'number' &&
        Number.isFinite(subtitleOptions.maxHardViolationRatio) &&
        subtitleOptions.maxHardViolationRatio >= 0
      ? subtitleOptions.maxHardViolationRatio
      : SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO,
  }
}

function isRecoverableError(message: string): boolean {
  return /413|payload|too\s+large|size|timeout|timed\s*out|resource|limit|process/i.test(
    message,
  )
}

function normalizeChunkDuration(
  input: number | undefined,
  fallback: number,
): number {
  if (input === undefined || !Number.isFinite(input)) return fallback
  const rounded = Math.floor(input)
  return rounded > 0 ? rounded : fallback
}

function buildResult(
  base: {
    modeRequested: TranscriptionMode
    modeUsed: TranscriptionMode
    warnings: string[]
    mediaKind: InputMediaKind
    audioExtracted: boolean
    sourceDurationSec: number
  },
  override: Partial<TranscriptionOutput>,
): TranscriptionOutput {
  return {
    success: false,
    isComplete: false,
    modeRequested: base.modeRequested,
    modeUsed: base.modeUsed,
    fallbackApplied: false,
    warnings: base.warnings,
    mediaKind: base.mediaKind,
    audioExtracted: base.audioExtracted,
    sourceDurationSec: base.sourceDurationSec > 0 ? base.sourceDurationSec : undefined,
    ...override,
  }
}

export async function runTranscription(
  inputFilePath: string,
  config: Partial<TranscriptionConfig>,
  options: TranscriptionRunOptions,
  bus: EventBus<PipelineEvents>,
  defaultChunkDuration = 30,
): Promise<TranscriptionOutput> {
  const requestedMode: TranscriptionMode = options.mode || 'whole'
  const chunkDurationProvided = Number.isFinite(options.chunkDuration)
  const resolvedChunkDuration = normalizeChunkDuration(
    options.chunkDuration,
    defaultChunkDuration,
  )
  const outputFileLabel = options.outputFileName || inputFilePath.split('/').pop() ||
    'transcription'
  const jobId = options.jobId

  const ctx = {
    modeRequested: requestedMode,
    modeUsed: requestedMode as TranscriptionMode,
    warnings: [] as string[],
    mediaKind: 'audio' as InputMediaKind,
    audioExtracted: false,
    sourceDurationSec: 0,
  }

  let cleanupPaths: string[] = []
  let preparedInputPath = inputFilePath

  try {
    setupEnv()

    // -- 1. Inspect ────────────────────────────────────────────────
    bus.emit('progress', {
      stage: 'preparing_input',
      message: 'Inspecting input media...',
      percent: 5,
      jobId,
      timestamp: new Date().toISOString(),
    })

    const inspectResult = await inspectMedia(
      { filePath: inputFilePath, mimeTypeHint: options.mimeTypeHint },
      bus,
    )
    if (!inspectResult.ok) {
      return buildResult(ctx, { error: inspectResult.error.message })
    }

    const inspection = inspectResult.data
    ctx.mediaKind = inspection.mediaKind
    ctx.sourceDurationSec = inspection.durationSec

    if (!inspection.hasAudio) {
      return buildResult(ctx, {
        error:
          'Input media has no audio stream. Please provide a media file that contains audible content.',
      })
    }

    // -- 2. Resolve strategy ───────────────────────────────────────
    const strategyResult = resolveStrategy({
      inspection,
      requestedMode,
      chunkDuration: resolvedChunkDuration,
      chunkDurationProvided,
    })
    const effectiveMode = strategyResult.strategy.kind
    ctx.modeUsed = effectiveMode
    ctx.warnings = [...ctx.warnings, ...strategyResult.warnings]

    // -- 3. Preprocess ─────────────────────────────────────────────
    const prepStage = inspection.mediaKind === 'video' ? 'extracting_audio' : 'preparing_input'
    bus.emit('progress', {
      stage: prepStage,
      message: inspection.mediaKind === 'video'
        ? 'Preparing video and extracting audio...'
        : 'Preparing input audio...',
      percent: 12,
      jobId,
      modeRequested: requestedMode,
      modeUsed: effectiveMode,
      timestamp: new Date().toISOString(),
    })

    const prepResult = await preprocessMedia(
      {
        inputPath: inputFilePath,
        tempDir: join(Deno.cwd(), 'temp'),
        mimeTypeHint: options.mimeTypeHint,
      },
      bus,
    )
    if (!prepResult.ok) {
      return buildResult(ctx, { error: prepResult.error.message })
    }

    preparedInputPath = prepResult.data.preparedFilePath
    ctx.mediaKind = prepResult.data.mediaKind
    ctx.audioExtracted = prepResult.data.audioExtracted
    ctx.warnings = [...ctx.warnings, ...prepResult.data.warnings]
    cleanupPaths = prepResult.data.cleanupPaths

    if (preparedInputPath !== inputFilePath) {
      const reinspect = await inspectMedia(
        { filePath: preparedInputPath },
        bus,
      )
      if (reinspect.ok && reinspect.data.durationSec > 0) {
        ctx.sourceDurationSec = reinspect.data.durationSec
      }
    }

    // -- 4. Resolve subtitle profile ───────────────────────────────
    const profileSelection = resolveSubtitleProfile({
      languageCode: config.languageCode || 'en',
      profileId: options.subtitleOptions?.profile,
      trackLanguageTag: options.subtitleOptions?.trackLanguageTag,
    })
    const subtitleProfile = profileSelection.profile
    const subtitleTrackLanguageTag = profileSelection.trackLanguageTag
    ctx.warnings = [...ctx.warnings, ...profileSelection.warnings]

    const normalizedSttLanguageCode = resolveSttLanguageCode(
      config.languageCode,
    )
    const resolvedKeyterms = resolveSubtitleKeyterms(
      subtitleProfile,
      options.subtitleOptions?.keyterms || [],
    )
    const effectiveConfig: Partial<TranscriptionConfig> = {
      ...config,
      languageCode: normalizedSttLanguageCode,
      keyterms: resolvedKeyterms,
    }

    const subtitleRuntimeConfig = resolveSubtitleRuntimeConfig(
      ctx.mediaKind,
      options.subtitleOptions,
    )

    // -- 5. Transcribe ─────────────────────────────────────────────

    if (effectiveMode === 'parts') {
      const partsChunkDuration = strategyResult.strategy.kind === 'parts'
        ? strategyResult.strategy.chunkDuration
        : resolvedChunkDuration

      return await handlePartsMode(
        ctx,
        preparedInputPath,
        outputFileLabel,
        partsChunkDuration,
        effectiveConfig,
        subtitleRuntimeConfig,
        subtitleProfile,
        subtitleTrackLanguageTag,
        false,
        bus,
        jobId,
        options.outputDir,
      )
    }

    // Whole mode
    bus.emit('progress', {
      stage: 'transcribing_whole',
      message: 'Transcribing full media in one request...',
      percent: 30,
      jobId,
      modeRequested: requestedMode,
      modeUsed: effectiveMode,
      timestamp: new Date().toISOString(),
    })

    const wholeResult = await transcribeWhole(
      { filePath: preparedInputPath, config: effectiveConfig },
      bus,
    )

    if (wholeResult.ok) {
      return await handleWholeSuccess(
        ctx,
        wholeResult.data,
        outputFileLabel,
        subtitleRuntimeConfig,
        subtitleProfile,
        subtitleTrackLanguageTag,
        bus,
        jobId,
        options.outputDir,
      )
    }

    // Fallback to parts
    if (!isRecoverableError(wholeResult.error.message)) {
      return buildResult(ctx, { error: wholeResult.error.message })
    }

    const fallbackWarning =
      `Whole-file transcription failed (${wholeResult.error.message}). Automatically retrying in parts.`
    bus.emit('log', { level: 'warn', message: fallbackWarning })
    ctx.warnings = [...ctx.warnings, fallbackWarning]
    ctx.modeUsed = 'parts'

    bus.emit('progress', {
      stage: 'splitting',
      message: fallbackWarning,
      percent: 25,
      jobId,
      modeRequested: requestedMode,
      modeUsed: 'parts',
      timestamp: new Date().toISOString(),
    })

    return await handlePartsMode(
      ctx,
      preparedInputPath,
      outputFileLabel,
      resolvedChunkDuration,
      effectiveConfig,
      subtitleRuntimeConfig,
      subtitleProfile,
      subtitleTrackLanguageTag,
      true,
      bus,
      jobId,
      options.outputDir,
    )
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    bus.emit('log', {
      level: 'error',
      message: `Error processing audio file: ${errorMessage}`,
    })
    bus.emit('progress', {
      stage: 'failed',
      message: errorMessage,
      percent: 100,
      jobId,
      timestamp: new Date().toISOString(),
    })
    return buildResult(ctx, { error: errorMessage })
  } finally {
    for (const path of cleanupPaths) {
      try {
        await Deno.remove(path)
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) {
          bus.emit('log', {
            level: 'warn',
            message: `Failed to clean up "${path}": ${e}`,
          })
        }
      }
    }
  }
}

async function handlePartsMode(
  ctx: {
    modeRequested: TranscriptionMode
    modeUsed: TranscriptionMode
    warnings: string[]
    mediaKind: InputMediaKind
    audioExtracted: boolean
    sourceDurationSec: number
  },
  preparedInputPath: string,
  outputFileLabel: string,
  chunkDuration: number,
  config: Partial<TranscriptionConfig>,
  subtitleRuntimeConfig: SubtitleRuntimeConfig,
  subtitleProfile: LanguageSubtitleProfile,
  subtitleTrackLanguageTag: string,
  fallbackApplied: boolean,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
  outputDir?: string,
): Promise<TranscriptionOutput> {
  const partsResult = await transcribeParts(
    { filePath: preparedInputPath, chunkDuration, config, jobId },
    bus,
  )
  if (!partsResult.ok) {
    const prefix = fallbackApplied ? 'Fallback failed: ' : ''
    return buildResult(ctx, {
      error: `${prefix}${partsResult.error.message}`,
      fallbackApplied,
    })
  }

  const data = partsResult.data
  const expectedDuration = ctx.sourceDurationSec > 0
    ? ctx.sourceDurationSec
    : data.totalPlannedDurationSec
  const coverageRatio = expectedDuration > 0 ? data.transcribedDurationSec / expectedDuration : 1

  if (coverageRatio < COVERAGE_MIN_RATIO) {
    return buildResult(ctx, {
      error: `Transcription coverage below threshold (${(coverageRatio * 100).toFixed(2)}% < ${
        COVERAGE_MIN_RATIO * 100
      }%).`,
      fallbackApplied,
      totalChunks: data.totalChunks,
      successfulChunks: data.successfulChunks,
      failedChunks: data.failedChunks,
      sourceDurationSec: expectedDuration,
      transcribedDurationSec: data.transcribedDurationSec,
      coverageRatio,
    })
  }

  let subtitleFields: Partial<TranscriptionOutput> = {}
  if (subtitleRuntimeConfig.enabled) {
    const subResult = handleSubtitles(
      ctx,
      data,
      subtitleProfile,
      subtitleTrackLanguageTag,
      subtitleRuntimeConfig,
      bus,
      jobId,
    )
    if (subResult.error) {
      return buildResult(ctx, {
        ...subResult,
        fallbackApplied,
        totalChunks: data.totalChunks,
        successfulChunks: data.successfulChunks,
        failedChunks: data.failedChunks,
        sourceDurationSec: expectedDuration,
        transcribedDurationSec: data.transcribedDurationSec,
        coverageRatio,
      })
    }
    ctx.warnings = [...ctx.warnings, ...(subResult.warnings || [])]
    subtitleFields = subResult
  }

  bus.emit('progress', {
    stage: 'combining_chunks',
    message: 'Combining chunk transcripts...',
    percent: 85,
    jobId,
    modeRequested: ctx.modeRequested,
    modeUsed: ctx.modeUsed,
    timestamp: new Date().toISOString(),
  })

  const saveResult = await persistOutput({
    text: data.text,
    outputFileName: outputFileLabel,
    outputDir,
    artifacts: subtitleFields.subtitleContents
      ? {
        generated: true,
        formats: ['srt', 'vtt'],
        cueCount: subtitleFields.subtitleCueCount || 0,
        contents: subtitleFields.subtitleContents,
      }
      : undefined,
    modeRequested: ctx.modeRequested,
    modeUsed: ctx.modeUsed,
    mediaKind: ctx.mediaKind,
  })

  const outputPath = saveResult.ok ? saveResult.data.outputPath : undefined

  bus.emit('progress', {
    stage: 'completed',
    message: fallbackApplied
      ? 'Transcription completed with fallback to parts mode.'
      : 'Transcription completed.',
    percent: 100,
    jobId,
    modeRequested: ctx.modeRequested,
    modeUsed: ctx.modeUsed,
    timestamp: new Date().toISOString(),
  })

  return buildResult(ctx, {
    success: true,
    data: data.text,
    outputPath,
    fallbackApplied,
    isComplete: true,
    totalChunks: data.totalChunks,
    successfulChunks: data.successfulChunks,
    failedChunks: data.failedChunks,
    sourceDurationSec: expectedDuration,
    transcribedDurationSec: data.transcribedDurationSec,
    coverageRatio,
    ...subtitleFields,
  })
}

async function handleWholeSuccess(
  ctx: {
    modeRequested: TranscriptionMode
    modeUsed: TranscriptionMode
    warnings: string[]
    mediaKind: InputMediaKind
    audioExtracted: boolean
    sourceDurationSec: number
  },
  transcription: {
    text: string
    words: TranscriptionWord[]
    additionalFormats: AdditionalTranscriptFormat[]
    languageCode?: string
  },
  outputFileLabel: string,
  subtitleRuntimeConfig: SubtitleRuntimeConfig,
  subtitleProfile: LanguageSubtitleProfile,
  subtitleTrackLanguageTag: string,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
  outputDir?: string,
): Promise<TranscriptionOutput> {
  let subtitleFields: Partial<TranscriptionOutput> = {}

  if (subtitleRuntimeConfig.enabled) {
    bus.emit('progress', {
      stage: 'generating_subtitles',
      message: 'Generating subtitle sidecars...',
      percent: 90,
      jobId,
      timestamp: new Date().toISOString(),
    })

    const subBuildResult = buildSubtitles({
      text: transcription.text,
      words: transcription.words,
      additionalFormats: transcription.additionalFormats,
      sourceDurationSec: ctx.sourceDurationSec,
      profile: subtitleProfile,
      trackLanguageTag: subtitleTrackLanguageTag,
      strictQuality: subtitleRuntimeConfig.strictQuality,
      maxHardViolationRatio: subtitleRuntimeConfig.maxHardViolationRatio,
    })

    if (!subBuildResult.ok) {
      return buildResult(ctx, { error: subBuildResult.error.message })
    }

    const subData = subBuildResult.data
    ctx.warnings = [...ctx.warnings, ...subData.warnings]
    subtitleFields = {
      subtitleGenerated: subData.artifacts.generated,
      subtitleFormats: subData.artifacts.formats as Array<'srt' | 'vtt'>,
      subtitleCueCount: subData.artifacts.cueCount,
      subtitleQuality: subData.quality,
      subtitleViolationCount: subData.quality.violations.length,
      subtitleContents: subData.artifacts.contents,
      subtitleTrackLanguageTag: subData.artifacts.trackLanguageTag || subtitleTrackLanguageTag,
    }

    if (subData.shouldFail) {
      return buildResult(ctx, {
        error: subData.failureMessage!,
        ...subtitleFields,
      })
    }
  }

  bus.emit('progress', {
    stage: 'saving_output',
    message: 'Saving transcript output...',
    percent: 95,
    jobId,
    timestamp: new Date().toISOString(),
  })

  const saveResult = await persistOutput({
    text: transcription.text,
    outputFileName: outputFileLabel,
    outputDir,
    artifacts: subtitleFields.subtitleContents
      ? {
        generated: true,
        formats: ['srt', 'vtt'],
        cueCount: subtitleFields.subtitleCueCount || 0,
        contents: subtitleFields.subtitleContents,
      }
      : undefined,
    quality: subtitleFields.subtitleQuality,
    qualityWarnings: ctx.warnings,
    modeRequested: ctx.modeRequested,
    modeUsed: ctx.modeUsed,
    mediaKind: ctx.mediaKind,
  })

  const outputPath = saveResult.ok ? saveResult.data.outputPath : undefined
  const subtitlePaths = saveResult.ok ? saveResult.data.subtitlePaths : undefined
  const qualityReportPath = saveResult.ok ? saveResult.data.qualityReportPath : undefined

  bus.emit('progress', {
    stage: 'completed',
    message: 'Transcription completed.',
    percent: 100,
    jobId,
    timestamp: new Date().toISOString(),
  })

  return buildResult(ctx, {
    success: true,
    data: transcription.text,
    outputPath,
    isComplete: true,
    ...subtitleFields,
    subtitlePaths,
    subtitleQualityReportPath: qualityReportPath,
  })
}

function handleSubtitles(
  ctx: {
    modeRequested: TranscriptionMode
    modeUsed: TranscriptionMode
    warnings: string[]
    mediaKind: InputMediaKind
    audioExtracted: boolean
    sourceDurationSec: number
  },
  partsData: TranscribePartsOutput,
  subtitleProfile: LanguageSubtitleProfile,
  subtitleTrackLanguageTag: string,
  subtitleRuntimeConfig: SubtitleRuntimeConfig,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Partial<TranscriptionOutput> {
  bus.emit('progress', {
    stage: 'generating_subtitles',
    message: 'Generating subtitle sidecars...',
    percent: 90,
    jobId,
    timestamp: new Date().toISOString(),
  })

  const chunkInputs: SubtitleChunkInput[] = partsData.chunks.map((chunk) => ({
    startSec: chunk.segment.startSec,
    durationSec: chunk.segment.durationSec,
    text: chunk.transcription.text,
    words: chunk.transcription.words,
    additionalFormats: chunk.transcription.additionalFormats,
  }))

  const expectedDuration = ctx.sourceDurationSec > 0
    ? ctx.sourceDurationSec
    : partsData.totalPlannedDurationSec

  const subBuildResult = buildSubtitles({
    text: partsData.text,
    words: [],
    additionalFormats: [],
    sourceDurationSec: expectedDuration,
    profile: subtitleProfile,
    trackLanguageTag: subtitleTrackLanguageTag,
    chunks: chunkInputs,
    strictQuality: subtitleRuntimeConfig.strictQuality,
    maxHardViolationRatio: subtitleRuntimeConfig.maxHardViolationRatio,
  })

  if (!subBuildResult.ok) {
    return { error: subBuildResult.error.message }
  }

  const subData = subBuildResult.data
  const fields: Partial<TranscriptionOutput> = {
    subtitleGenerated: subData.artifacts.generated,
    subtitleFormats: subData.artifacts.formats as Array<'srt' | 'vtt'>,
    subtitleCueCount: subData.artifacts.cueCount,
    subtitleQuality: subData.quality,
    subtitleViolationCount: subData.quality.violations.length,
    subtitleContents: subData.artifacts.contents,
    subtitleTrackLanguageTag: subData.artifacts.trackLanguageTag || subtitleTrackLanguageTag,
    warnings: subData.warnings,
  }

  if (subData.shouldFail) {
    return { ...fields, error: subData.failureMessage }
  }

  return fields
}
