import { FileService } from '../services/file-service/index.ts'
import { TranscriptionService } from '../services/transcription/index.ts'
import { AudioSplitterService } from '../services/audio-splitter/index.ts'
import { MediaPreprocessorService } from '../services/media-preprocessor/index.ts'
import { SubtitleBuilderService, SubtitleChunkInput } from '../services/subtitle-builder/index.ts'
import { SubtitleQualityService } from '../services/subtitle-quality/index.ts'
import {
  detectMixedScriptWarnings,
  resolveSttLanguageCode,
  resolveSubtitleKeyterms,
  resolveSubtitleProfile,
} from '../services/subtitle-profiles/index.ts'
import {
  exceedsElevenLabsHardLimits,
  MediaInspectorService,
} from '../services/media-inspector/index.ts'
import {
  AudioChunkSegment,
  InputMediaKind,
  LanguageSubtitleProfile,
  MediaInspection,
  Result,
  SubtitleArtifacts,
  SubtitlePolicy,
  SubtitleQualityReport,
  TranscriptionConfig,
  TranscriptionMode,
  TranscriptionProgressEvent,
  TranscriptionResult as StructuredTranscriptionResult,
} from '../types/index.ts'
import { setupEnv } from '../utils/env.ts'

const FORCED_VIDEO_CHUNK_DURATION_SEC = 120
const COVERAGE_MIN_RATIO = 0.99
const CHUNK_RETRY_MAX_ATTEMPTS = 3
const CHUNK_RETRY_BASE_DELAY_MS = 500
const ASYNC_WEBHOOK_RUNTIME_THRESHOLD_SEC = 60 * 60
const SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO = 0.05

export type TranscriptionRunOptions = {
  mode?: TranscriptionMode
  chunkDuration?: number
  outputFileName?: string
  mimeTypeHint?: string
  subtitleOptions?: SubtitlePolicy & { keyterms?: string[] }
  onProgress?: (event: TranscriptionProgressEvent) => void
  jobId?: string
}

type PartTranscriptionSummary = {
  text: string
  chunks: Array<{
    segment: AudioChunkSegment
    transcription: StructuredTranscriptionResult
  }>
  totalChunks: number
  successfulChunks: number
  failedChunks: number
  transcribedDurationSec: number
  totalPlannedDurationSec: number
}

type ModeRoutingResult = {
  modeUsed: TranscriptionMode
  chunkDuration: number
  warnings: string[]
}

type SubtitleRuntimeConfig = {
  enabled: boolean
  strictQuality: boolean
  maxHardViolationRatio: number
}

type SubtitleGenerationOutput = {
  artifacts: SubtitleArtifacts
  quality: SubtitleQualityReport
  warnings: string[]
  shouldFail: boolean
  failureMessage?: string
}

type SubtitlePersistenceResult = {
  generated: boolean
  formats?: Array<'srt' | 'vtt'>
  paths?: { srt?: string; vtt?: string }
  cueCount?: number
  quality?: SubtitleQualityReport
  violationCount?: number
  qualityReportPath?: string
  contents?: { srt?: string; vtt?: string }
  trackLanguageTag?: string
  warnings: string[]
  shouldFail?: boolean
  failureMessage?: string
}

/**
 * Shared context for building TranscriptionResult objects within a single run().
 */
type RunContext = {
  modeRequested: TranscriptionMode
  modeUsed: TranscriptionMode
  warnings: string[]
  mediaKind: InputMediaKind
  audioExtracted: boolean
  sourceDurationSec: number
  onProgress?: (event: TranscriptionProgressEvent) => void
  progressContext: {
    modeRequested: TranscriptionMode
    modeUsed: TranscriptionMode
    jobId?: string
  }
}

/**
 * Result type for the transcription process
 */
export type TranscriptionResult = {
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

/**
 * Main application class for audio transcription
 */
export class TranscriptionApp {
  private readonly fileService: FileService
  private transcriptionService: TranscriptionService | null = null
  private readonly audioSplitterService: AudioSplitterService
  private readonly mediaPreprocessorService: MediaPreprocessorService
  private readonly mediaInspectorService: MediaInspectorService
  private readonly subtitleBuilderService: SubtitleBuilderService
  private readonly subtitleQualityService: SubtitleQualityService
  private readonly chunkDuration: number
  private readonly config: Partial<TranscriptionConfig>

  constructor(config: Partial<TranscriptionConfig> = {}, chunkDuration = 30) {
    this.fileService = new FileService()
    this.audioSplitterService = new AudioSplitterService()
    this.mediaPreprocessorService = new MediaPreprocessorService()
    this.mediaInspectorService = new MediaInspectorService()
    this.subtitleBuilderService = new SubtitleBuilderService()
    this.subtitleQualityService = new SubtitleQualityService()
    this.chunkDuration = chunkDuration
    this.config = config
  }

  async initialize(): Promise<boolean> {
    const envSetup = setupEnv()
    if (!envSetup) return false

    this.transcriptionService = new TranscriptionService(this.config)
    await this.fileService.ensureDirectories()
    return true
  }

  private normalizeChunkDuration(input: number): number {
    const fallback = this.chunkDuration
    if (!Number.isFinite(input)) return fallback
    const rounded = Math.floor(input)
    return rounded > 0 ? rounded : fallback
  }

  private isRecoverableWholeModeError(message: string): boolean {
    return /413|payload|too\s+large|size|timeout|timed\s*out|resource|limit|process/i.test(
      message,
    )
  }

  private async waitForRetry(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private isAsyncWebhookEnabled(): boolean {
    const raw = (Deno.env.get('ENABLE_ELEVENLABS_ASYNC_WEBHOOK') || '')
      .trim()
      .toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  }

  private resolveModeRouting(
    requestedMode: TranscriptionMode,
    inspection: MediaInspection,
    normalizedChunkDuration: number,
    chunkDurationProvided: boolean,
  ): ModeRoutingResult {
    const warnings: string[] = []
    let modeUsed: TranscriptionMode = requestedMode
    let chunkDuration = normalizedChunkDuration

    if (inspection.mediaKind === 'video' && modeUsed !== 'parts') {
      modeUsed = 'parts'
      warnings.push(
        'Video inputs are always transcribed in parts mode to guarantee full coverage.',
      )
    }

    if (exceedsElevenLabsHardLimits(inspection) && modeUsed !== 'parts') {
      modeUsed = 'parts'
      warnings.push(
        'Input exceeds single-request hard limits (3GB or 10h). Automatically switching to parts mode.',
      )
    }

    if (
      this.isAsyncWebhookEnabled() &&
      inspection.durationSec >= ASYNC_WEBHOOK_RUNTIME_THRESHOLD_SEC
    ) {
      warnings.push(
        'Async webhook mode flag is enabled for long media. This local build keeps deterministic chunked processing enabled.',
      )
    }

    if (
      modeUsed === 'parts' &&
      inspection.mediaKind === 'video' &&
      !chunkDurationProvided
    ) {
      chunkDuration = FORCED_VIDEO_CHUNK_DURATION_SEC
    }

    return { modeUsed, chunkDuration, warnings }
  }

  private async transcribeWholeFile(
    inputFilePath: string,
  ): Promise<Result<StructuredTranscriptionResult, Error>> {
    if (!this.transcriptionService) {
      return {
        ok: false,
        error: new Error('Transcription service not initialized.'),
      }
    }

    const audioResult = await this.fileService.readAudioFileFromPath(inputFilePath)
    if (!audioResult.ok) {
      return {
        ok: false,
        error: new Error(
          `Failed to read input audio file: ${audioResult.error.message}`,
        ),
      }
    }

    return await this.transcriptionService.transcribe(audioResult.data)
  }

  private async transcribeChunkWithRetry(
    segment: AudioChunkSegment,
    totalChunks: number,
    onProgress?: (event: TranscriptionProgressEvent) => void,
    progressContext: {
      jobId?: string
      modeRequested: TranscriptionMode
      modeUsed: TranscriptionMode
    } = { modeRequested: 'whole', modeUsed: 'whole' },
  ): Promise<Result<StructuredTranscriptionResult, Error>> {
    if (!this.transcriptionService) {
      return {
        ok: false,
        error: new Error('Transcription service not initialized.'),
      }
    }

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= CHUNK_RETRY_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        this.emitProgress(
          onProgress,
          {
            stage: 'transcribing_chunk',
            message: `Retrying chunk ${
              segment.index + 1
            }/${totalChunks} (attempt ${attempt}/${CHUNK_RETRY_MAX_ATTEMPTS})...`,
            chunkIndex: segment.index + 1,
            chunkTotal: totalChunks,
          },
          progressContext,
        )
      }
      const audioResult = await this.fileService.readAudioFileFromPath(
        segment.path,
      )
      if (!audioResult.ok) {
        lastError = new Error(
          `Failed to read chunk ${segment.index + 1}/${totalChunks}: ${audioResult.error.message}`,
        )
      } else {
        const transcriptionResult = await this.transcriptionService.transcribe(
          audioResult.data,
        )
        if (transcriptionResult.ok) {
          return transcriptionResult
        }

        lastError = new Error(
          `Chunk ${
            segment.index + 1
          }/${totalChunks} transcription failed on attempt ${attempt}: ${transcriptionResult.error.message}`,
        )
      }

      if (attempt < CHUNK_RETRY_MAX_ATTEMPTS) {
        const delay = CHUNK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        await this.waitForRetry(delay)
      }
    }

    return {
      ok: false,
      error: lastError ||
        new Error(`Chunk ${segment.index + 1}/${totalChunks} failed`),
    }
  }

  private async transcribeInParts(
    inputFilePath: string,
    chunkDuration: number,
    onProgress?: (event: TranscriptionProgressEvent) => void,
    progressContext: {
      jobId?: string
      modeRequested: TranscriptionMode
      modeUsed: TranscriptionMode
    } = { modeRequested: 'whole', modeUsed: 'parts' },
  ): Promise<Result<PartTranscriptionSummary, Error>> {
    if (!this.transcriptionService) {
      return {
        ok: false,
        error: new Error('Transcription service not initialized.'),
      }
    }

    const tempDir = this.fileService.getTempDir()
    try {
      this.emitProgress(
        onProgress,
        {
          stage: 'splitting',
          message: `Splitting media into ${chunkDuration}-second chunks...`,
          percent: 20,
        },
        progressContext,
      )
      console.log(
        `Splitting audio file into ${chunkDuration}-second chunks...`,
      )
      const splitResult = await this.audioSplitterService.splitAudio({
        inputFile: inputFilePath,
        outputDir: tempDir,
        segmentDuration: chunkDuration,
        filePrefix: `chunk_${inputFilePath.split('/').pop()?.split('.')[0]}`,
      })

      if (!splitResult.ok) {
        return {
          ok: false,
          error: new Error(
            `Failed to split audio file: ${splitResult.error.message}`,
          ),
        }
      }

      const segments = splitResult.data
      const totalChunks = segments.length
      console.log(`Split audio into ${totalChunks} chunks.`)
      this.emitProgress(
        onProgress,
        {
          stage: 'splitting',
          message: `Created ${totalChunks} chunk${totalChunks === 1 ? '' : 's'}.`,
          percent: 30,
        },
        progressContext,
      )

      const chunkTranscriptions: StructuredTranscriptionResult[] = []
      const chunkDetails: Array<{
        segment: AudioChunkSegment
        transcription: StructuredTranscriptionResult
      }> = []
      let transcribedDurationSec = 0

      for (const segment of segments) {
        const startPercent = 30 + Math.floor((segment.index / totalChunks) * 50)
        this.emitProgress(
          onProgress,
          {
            stage: 'transcribing_chunk',
            message: `Transcribing chunk ${segment.index + 1}/${totalChunks}...`,
            percent: startPercent,
            chunkIndex: segment.index + 1,
            chunkTotal: totalChunks,
          },
          progressContext,
        )
        console.log(
          `Transcribing chunk ${segment.index + 1}/${totalChunks}...`,
        )

        const chunkResult = await this.transcribeChunkWithRetry(
          segment,
          totalChunks,
          onProgress,
          progressContext,
        )
        if (!chunkResult.ok) {
          return {
            ok: false,
            error: new Error(
              `Failed after retries at chunk ${
                segment.index + 1
              }/${totalChunks}: ${chunkResult.error.message}`,
            ),
          }
        }

        chunkTranscriptions.push(chunkResult.data)
        chunkDetails.push({ segment, transcription: chunkResult.data })
        transcribedDurationSec += segment.durationSec
        const endPercent = 30 + Math.floor(((segment.index + 1) / totalChunks) * 50)
        this.emitProgress(
          onProgress,
          {
            stage: 'transcribing_chunk',
            message: `Completed chunk ${segment.index + 1}/${totalChunks}.`,
            percent: endPercent,
            chunkIndex: segment.index + 1,
            chunkTotal: totalChunks,
            partialText: chunkResult.data.text,
          },
          progressContext,
        )
      }

      const totalPlannedDurationSec = segments.reduce(
        (sum, segment) => sum + segment.durationSec,
        0,
      )
      return {
        ok: true,
        data: {
          text: this.fileService.combineChunkTranscriptions(
            chunkTranscriptions.map((t) => t.text),
          ),
          chunks: chunkDetails,
          totalChunks,
          successfulChunks: totalChunks,
          failedChunks: 0,
          transcribedDurationSec,
          totalPlannedDurationSec,
        },
      }
    } finally {
      await this.fileService.cleanupTempFiles()
    }
  }

  private emitProgress(
    onProgress: ((event: TranscriptionProgressEvent) => void) | undefined,
    event: Omit<TranscriptionProgressEvent, 'timestamp'>,
    context: {
      modeRequested: TranscriptionMode
      modeUsed: TranscriptionMode
      jobId?: string
    },
  ): void {
    if (!onProgress) return

    onProgress({
      ...event,
      jobId: event.jobId || context.jobId,
      modeRequested: event.modeRequested || context.modeRequested,
      modeUsed: event.modeUsed || context.modeUsed,
      timestamp: new Date().toISOString(),
    })
  }

  private async saveTranscript(
    inputFilePath: string,
    text: string,
    outputFileName?: string,
  ): Promise<string> {
    const fileName = outputFileName || inputFilePath.split('/').pop() || 'transcription'
    return await this.fileService.saveTranscription(text, fileName, 'md')
  }

  private async cleanupPreparedFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await Deno.remove(path)
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          console.error(`Failed to clean up prepared file "${path}":`, error)
        }
      }
    }
  }

  private resolveSubtitleRuntimeConfig(
    mediaKind: InputMediaKind,
    subtitleOptions?: TranscriptionRunOptions['subtitleOptions'],
  ): SubtitleRuntimeConfig {
    if (mediaKind === 'video') {
      const maxHardViolationRatio = typeof subtitleOptions?.maxHardViolationRatio === 'number' &&
          Number.isFinite(subtitleOptions.maxHardViolationRatio) &&
          subtitleOptions.maxHardViolationRatio >= 0
        ? subtitleOptions.maxHardViolationRatio
        : SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO

      return {
        enabled: true,
        strictQuality: true,
        maxHardViolationRatio,
      }
    }

    const enabled = typeof subtitleOptions?.enabled === 'boolean' ? subtitleOptions.enabled : false
    const strictQuality = typeof subtitleOptions?.strictQuality === 'boolean'
      ? subtitleOptions.strictQuality
      : false
    const maxHardViolationRatio = typeof subtitleOptions?.maxHardViolationRatio === 'number' &&
        Number.isFinite(subtitleOptions.maxHardViolationRatio) &&
        subtitleOptions.maxHardViolationRatio >= 0
      ? subtitleOptions.maxHardViolationRatio
      : SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO

    return { enabled, strictQuality, maxHardViolationRatio }
  }

  private hasRequiredSubtitleArtifacts(
    artifacts: SubtitleArtifacts,
    strictMode: boolean,
  ): boolean {
    if (!strictMode) return artifacts.generated

    return (
      artifacts.generated &&
      artifacts.formats.includes('srt') &&
      artifacts.formats.includes('vtt') &&
      Boolean(artifacts.paths?.srt) &&
      Boolean(artifacts.paths?.vtt)
    )
  }

  private async saveSubtitles(
    fileName: string,
    artifacts: SubtitleArtifacts,
  ): Promise<SubtitleArtifacts> {
    if (!artifacts.contents) return artifacts

    const paths: { srt?: string; vtt?: string } = { ...artifacts.paths }
    if (artifacts.contents.srt) {
      paths.srt = await this.fileService.saveSubtitle(
        artifacts.contents.srt,
        fileName,
        'srt',
      )
    }
    if (artifacts.contents.vtt) {
      paths.vtt = await this.fileService.saveSubtitle(
        artifacts.contents.vtt,
        fileName,
        'vtt',
      )
    }

    return { ...artifacts, paths }
  }

  private summarizeViolations(violations: string[], maxItems = 8): string {
    if (violations.length === 0) return 'No detailed violations were provided.'

    const head = violations.slice(0, maxItems).join(' ')
    const remaining = violations.length - Math.min(maxItems, violations.length)
    return remaining > 0
      ? `${head} (+${remaining} more; see subtitle quality report for full details).`
      : head
  }

  private async saveSubtitleQualityDiagnostics(
    fileName: string,
    data: {
      quality: SubtitleQualityReport
      warnings: string[]
      artifacts: SubtitleArtifacts
      modeRequested: TranscriptionMode
      modeUsed: TranscriptionMode
      mediaKind: InputMediaKind
    },
  ): Promise<string> {
    return await this.fileService.saveSubtitleQualityReport(
      {
        createdAt: new Date().toISOString(),
        quality: data.quality,
        warnings: data.warnings,
        artifacts: {
          generated: data.artifacts.generated,
          formats: data.artifacts.formats,
          cueCount: data.artifacts.cueCount,
          source: data.artifacts.source,
          trackLanguageTag: data.artifacts.trackLanguageTag,
          paths: data.artifacts.paths,
        },
        modeRequested: data.modeRequested,
        modeUsed: data.modeUsed,
        mediaKind: data.mediaKind,
      },
      fileName,
    )
  }

  private buildSubtitles(options: {
    text: string
    words: StructuredTranscriptionResult['words']
    additionalFormats: StructuredTranscriptionResult['additionalFormats']
    sourceDurationSec: number
    profile: LanguageSubtitleProfile
    trackLanguageTag: string
    chunks?: SubtitleChunkInput[]
    strictQuality: boolean
    maxHardViolationRatio: number
  }): Result<SubtitleGenerationOutput, Error> {
    try {
      const built = this.subtitleBuilderService.buildSubtitles({
        text: options.text,
        words: options.words,
        additionalFormats: options.additionalFormats,
        profile: options.profile,
        trackLanguageTag: options.trackLanguageTag,
        sourceDurationSec: options.sourceDurationSec,
        chunks: options.chunks,
      })

      const quality = this.subtitleQualityService.evaluate({
        cues: built.cues,
        profile: options.profile,
        sourceDurationSec: options.sourceDurationSec,
        strict: options.strictQuality,
        maxHardViolationRatio: options.maxHardViolationRatio,
      })

      const mixedScriptWarnings = detectMixedScriptWarnings(
        built.cues.map((cue) => cue.text).join('\n'),
        options.profile,
      )
      const warnings = [...built.warnings, ...mixedScriptWarnings]
      const shouldFail = quality.status === 'fail'
      const failureMessage = shouldFail
        ? `Subtitle quality checks failed in strict mode: ${
          this.summarizeViolations(
            quality.violations,
          )
        }`
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

  private verifyCoverage(
    sourceDurationSec: number,
    transcribedDurationSec: number,
  ): Result<number, Error> {
    if (!(sourceDurationSec > 0)) return { ok: true, data: 1 }

    if (!(transcribedDurationSec > 0)) {
      return {
        ok: false,
        error: new Error(
          'No transcribed duration was recorded for chunked transcription.',
        ),
      }
    }

    const coverageRatio = transcribedDurationSec / sourceDurationSec
    if (coverageRatio < COVERAGE_MIN_RATIO) {
      return {
        ok: false,
        error: new Error(
          `Transcription coverage below threshold (${(coverageRatio * 100).toFixed(2)}% < ${
            COVERAGE_MIN_RATIO * 100
          }%).`,
        ),
      }
    }

    return { ok: true, data: coverageRatio }
  }

  /**
   * Builds a TranscriptionResult with shared context defaults.
   * Emits a 'failed' progress event when the result contains an error.
   */
  private buildResult(
    ctx: RunContext,
    override: Partial<TranscriptionResult>,
  ): TranscriptionResult {
    if (override.error) {
      this.emitProgress(
        ctx.onProgress,
        { stage: 'failed', message: override.error, percent: 100 },
        ctx.progressContext,
      )
    }

    return {
      success: false,
      isComplete: false,
      modeRequested: ctx.modeRequested,
      modeUsed: ctx.modeUsed,
      fallbackApplied: false,
      warnings: ctx.warnings,
      mediaKind: ctx.mediaKind,
      audioExtracted: ctx.audioExtracted,
      sourceDurationSec: ctx.sourceDurationSec > 0 ? ctx.sourceDurationSec : undefined,
      ...override,
    }
  }

  private toSubtitleFields(
    data: SubtitlePersistenceResult,
  ): Partial<TranscriptionResult> {
    return {
      subtitleGenerated: data.generated,
      subtitleFormats: data.formats,
      subtitlePaths: data.paths,
      subtitleCueCount: data.cueCount,
      subtitleQuality: data.quality,
      subtitleViolationCount: data.violationCount,
      subtitleQualityReportPath: data.qualityReportPath,
      subtitleContents: data.contents,
      subtitleTrackLanguageTag: data.trackLanguageTag,
    }
  }

  /**
   * Unified subtitle generation, quality evaluation, persistence, and strict-mode gating.
   * Replaces the three near-identical subtitle blocks that previously existed in run().
   */
  private async generateAndPersistSubtitles(params: {
    text: string
    words: StructuredTranscriptionResult['words']
    additionalFormats: StructuredTranscriptionResult['additionalFormats']
    sourceDurationSec: number
    chunks?: SubtitleChunkInput[]
    outputFileLabel: string
    profile: LanguageSubtitleProfile
    trackLanguageTag: string
    runtimeConfig: SubtitleRuntimeConfig
    modeUsed: TranscriptionMode
    modeRequested: TranscriptionMode
    mediaKind: InputMediaKind
    onProgress?: (event: TranscriptionProgressEvent) => void
    progressContext: RunContext['progressContext']
  }): Promise<Result<SubtitlePersistenceResult, Error>> {
    this.emitProgress(
      params.onProgress,
      {
        stage: 'generating_subtitles',
        message: 'Generating subtitle sidecars...',
        percent: 90,
      },
      params.progressContext,
    )

    const buildResult = this.buildSubtitles({
      text: params.text,
      words: params.words,
      additionalFormats: params.additionalFormats,
      sourceDurationSec: params.sourceDurationSec,
      profile: params.profile,
      trackLanguageTag: params.trackLanguageTag,
      chunks: params.chunks,
      strictQuality: params.runtimeConfig.strictQuality,
      maxHardViolationRatio: params.runtimeConfig.maxHardViolationRatio,
    })

    if (!buildResult.ok) {
      return { ok: false, error: buildResult.error }
    }

    const persistedArtifacts = await this.saveSubtitles(
      params.outputFileLabel,
      buildResult.data.artifacts,
    )

    const qualityReportPath = await this.saveSubtitleQualityDiagnostics(
      params.outputFileLabel,
      {
        quality: buildResult.data.quality,
        warnings: buildResult.data.warnings,
        artifacts: persistedArtifacts,
        modeRequested: params.modeRequested,
        modeUsed: params.modeUsed,
        mediaKind: params.mediaKind,
      },
    )

    const shouldFail = buildResult.data.shouldFail ||
      (params.runtimeConfig.strictQuality &&
        !this.hasRequiredSubtitleArtifacts(
          persistedArtifacts,
          params.runtimeConfig.strictQuality,
        ))

    const failureMessage = buildResult.data.shouldFail
      ? buildResult.data.failureMessage ||
        'Subtitle quality checks failed in strict mode.'
      : shouldFail
      ? 'Strict subtitle mode requires generated SRT and VTT sidecars.'
      : undefined

    const result: SubtitlePersistenceResult = {
      generated: persistedArtifacts.generated,
      formats: persistedArtifacts.formats as Array<'srt' | 'vtt'>,
      paths: persistedArtifacts.paths,
      cueCount: persistedArtifacts.cueCount,
      quality: buildResult.data.quality,
      violationCount: buildResult.data.quality.violations.length,
      qualityReportPath,
      contents: persistedArtifacts.contents,
      trackLanguageTag: persistedArtifacts.trackLanguageTag || params.trackLanguageTag,
      warnings: buildResult.data.warnings,
      shouldFail,
      failureMessage,
    }

    return { ok: true, data: result }
  }

  /**
   * Runs the transcription process
   */
  async run(
    inputFilePath: string,
    outputDir?: string,
    options: TranscriptionRunOptions = {},
  ): Promise<TranscriptionResult> {
    const requestedMode: TranscriptionMode = options.mode || 'whole'
    const chunkDurationProvided = Number.isFinite(options.chunkDuration)
    const normalizedChunkDuration = this.normalizeChunkDuration(
      options.chunkDuration ?? this.chunkDuration,
    )
    const outputFileLabel = options.outputFileName ||
      inputFilePath.split('/').pop() ||
      'transcription'
    const onProgress = options.onProgress
    const progressContext = {
      modeRequested: requestedMode,
      modeUsed: requestedMode,
      jobId: options.jobId,
    }

    const ctx: RunContext = {
      modeRequested: requestedMode,
      modeUsed: requestedMode,
      warnings: [],
      mediaKind: 'audio',
      audioExtracted: false,
      sourceDurationSec: 0,
      onProgress,
      progressContext,
    }

    let cleanupPaths: string[] = []
    let preparedInputPath = inputFilePath
    let subtitleProfile: LanguageSubtitleProfile | null = null
    let subtitleTrackLanguageTag: string | undefined
    let subtitleRuntimeConfig: SubtitleRuntimeConfig = {
      enabled: false,
      strictQuality: false,
      maxHardViolationRatio: SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO,
    }

    try {
      if (!this.transcriptionService) {
        return this.buildResult(ctx, {
          error: 'TranscriptionService not initialized. Call initialize() first.',
        })
      }

      const fileExists = await this.fileService.fileExists(inputFilePath)
      if (!fileExists) {
        return this.buildResult(ctx, {
          error: `Input file not found: ${inputFilePath}`,
        })
      }

      console.log(`Processing: ${inputFilePath}`)

      if (outputDir) {
        this.fileService.setOutputDir(outputDir)
      }

      this.emitProgress(
        onProgress,
        {
          stage: 'preparing_input',
          message: 'Inspecting input media...',
          percent: 5,
        },
        progressContext,
      )

      const sourceInspectionResult = await this.mediaInspectorService.inspectMedia({
        filePath: inputFilePath,
        mimeTypeHint: options.mimeTypeHint,
      })
      if (!sourceInspectionResult.ok) {
        return this.buildResult(ctx, {
          error: sourceInspectionResult.error.message,
        })
      }

      const sourceInspection = sourceInspectionResult.data
      ctx.mediaKind = sourceInspection.mediaKind
      ctx.sourceDurationSec = sourceInspection.durationSec

      if (!sourceInspection.hasAudio) {
        return this.buildResult(ctx, {
          error:
            'Input media has no audio stream. Please provide a media file that contains audible content.',
        })
      }

      const routing = this.resolveModeRouting(
        requestedMode,
        sourceInspection,
        normalizedChunkDuration,
        chunkDurationProvided,
      )
      ctx.modeUsed = routing.modeUsed
      progressContext.modeUsed = routing.modeUsed
      ctx.warnings = [...ctx.warnings, ...routing.warnings]

      this.emitProgress(
        onProgress,
        {
          stage: sourceInspection.mediaKind === 'video' ? 'extracting_audio' : 'preparing_input',
          message: sourceInspection.mediaKind === 'video'
            ? 'Preparing video and extracting audio...'
            : 'Preparing input audio...',
          percent: 12,
        },
        progressContext,
      )

      const preparationResult = await this.mediaPreprocessorService.prepareInputForTranscription({
        inputPath: inputFilePath,
        tempDir: this.fileService.getTempDir(),
        mimeTypeHint: options.mimeTypeHint,
      })
      if (!preparationResult.ok) {
        return this.buildResult(ctx, {
          error: preparationResult.error.message,
        })
      }

      preparedInputPath = preparationResult.data.preparedFilePath
      ctx.mediaKind = preparationResult.data.mediaKind
      ctx.audioExtracted = preparationResult.data.audioExtracted
      ctx.warnings = [...ctx.warnings, ...preparationResult.data.warnings]
      cleanupPaths = preparationResult.data.cleanupPaths

      if (preparedInputPath !== inputFilePath) {
        const preparedInspectionResult = await this.mediaInspectorService.inspectMedia({
          filePath: preparedInputPath,
        })
        if (!preparedInspectionResult.ok) {
          return this.buildResult(ctx, {
            error: preparedInspectionResult.error.message,
          })
        }
        if (!preparedInspectionResult.data.hasAudio) {
          return this.buildResult(ctx, {
            error: 'Prepared media has no audio stream.',
          })
        }
        if (preparedInspectionResult.data.durationSec > 0) {
          ctx.sourceDurationSec = preparedInspectionResult.data.durationSec
        }
      }

      const currentLanguageCode = this.transcriptionService.getConfig().languageCode
      const profileSelection = resolveSubtitleProfile({
        languageCode: currentLanguageCode,
        profileId: options.subtitleOptions?.profile,
        trackLanguageTag: options.subtitleOptions?.trackLanguageTag,
      })
      subtitleProfile = profileSelection.profile
      subtitleTrackLanguageTag = profileSelection.trackLanguageTag
      ctx.warnings = [...ctx.warnings, ...profileSelection.warnings]

      const normalizedSttLanguageCode = resolveSttLanguageCode(currentLanguageCode)
      const resolvedKeyterms = resolveSubtitleKeyterms(
        subtitleProfile,
        options.subtitleOptions?.keyterms || [],
      )
      this.transcriptionService.updateConfig({
        languageCode: normalizedSttLanguageCode,
        keyterms: resolvedKeyterms,
      })

      subtitleRuntimeConfig = this.resolveSubtitleRuntimeConfig(
        ctx.mediaKind,
        options.subtitleOptions,
      )

      // ── Parts mode ──────────────────────────────────────────────────

      if (ctx.modeUsed === 'parts') {
        return await this.runPartsMode(
          ctx,
          preparedInputPath,
          inputFilePath,
          outputFileLabel,
          routing.chunkDuration,
          subtitleRuntimeConfig,
          subtitleProfile,
          subtitleTrackLanguageTag,
          false,
        )
      }

      // ── Whole mode ──────────────────────────────────────────────────

      this.emitProgress(
        onProgress,
        {
          stage: 'transcribing_whole',
          message: 'Transcribing full media in one request...',
          percent: 30,
        },
        progressContext,
      )
      const wholeResult = await this.transcribeWholeFile(preparedInputPath)

      if (wholeResult.ok) {
        return await this.finishWholeMode(
          ctx,
          wholeResult.data,
          inputFilePath,
          outputFileLabel,
          subtitleRuntimeConfig,
          subtitleProfile,
          subtitleTrackLanguageTag,
        )
      }

      // ── Fallback to parts ───────────────────────────────────────────

      const wholeErrorMessage = wholeResult.error.message
      if (!this.isRecoverableWholeModeError(wholeErrorMessage)) {
        return this.buildResult(ctx, { error: wholeErrorMessage })
      }

      const fallbackWarning =
        `Whole-file transcription failed (${wholeErrorMessage}). Automatically retrying in parts.`
      console.warn(fallbackWarning)
      ctx.warnings = [...ctx.warnings, fallbackWarning]
      ctx.modeUsed = 'parts'
      progressContext.modeUsed = 'parts'
      this.emitProgress(
        onProgress,
        { stage: 'splitting', message: fallbackWarning, percent: 25 },
        progressContext,
      )

      return await this.runPartsMode(
        ctx,
        preparedInputPath,
        inputFilePath,
        outputFileLabel,
        routing.chunkDuration,
        subtitleRuntimeConfig,
        subtitleProfile,
        subtitleTrackLanguageTag,
        true,
      )
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Error processing audio file:', errorMessage)
      return this.buildResult(ctx, { error: errorMessage })
    } finally {
      await this.cleanupPreparedFiles(cleanupPaths)
    }
  }

  /**
   * Handles the parts-mode transcription flow (also used for fallback).
   */
  private async runPartsMode(
    ctx: RunContext,
    preparedInputPath: string,
    inputFilePath: string,
    outputFileLabel: string,
    chunkDuration: number,
    subtitleRuntimeConfig: SubtitleRuntimeConfig,
    subtitleProfile: LanguageSubtitleProfile | null,
    subtitleTrackLanguageTag: string | undefined,
    fallbackApplied: boolean,
  ): Promise<TranscriptionResult> {
    const partsResult = await this.transcribeInParts(
      preparedInputPath,
      chunkDuration,
      ctx.onProgress,
      ctx.progressContext,
    )
    if (!partsResult.ok) {
      const errorPrefix = fallbackApplied ? 'Fallback failed: ' : ''
      return this.buildResult(ctx, {
        error: `${errorPrefix}${partsResult.error.message}`,
        fallbackApplied,
      })
    }

    const expectedDurationSec = ctx.sourceDurationSec > 0
      ? ctx.sourceDurationSec
      : partsResult.data.totalPlannedDurationSec
    const coverageResult = this.verifyCoverage(
      expectedDurationSec,
      partsResult.data.transcribedDurationSec,
    )
    if (!coverageResult.ok) {
      return this.buildResult(ctx, {
        error: coverageResult.error.message,
        fallbackApplied,
        totalChunks: partsResult.data.totalChunks,
        successfulChunks: partsResult.data.successfulChunks,
        failedChunks: partsResult.data.failedChunks,
        sourceDurationSec: expectedDurationSec,
        transcribedDurationSec: partsResult.data.transcribedDurationSec,
        coverageRatio: expectedDurationSec > 0
          ? partsResult.data.transcribedDurationSec / expectedDurationSec
          : 1,
      })
    }

    let subtitleFields: Partial<TranscriptionResult> = {}

    if (subtitleRuntimeConfig.enabled) {
      const activeProfile = subtitleProfile ||
        resolveSubtitleProfile({ languageCode: 'en' }).profile
      const chunkInputs: SubtitleChunkInput[] = partsResult.data.chunks.map(
        (chunk) => ({
          startSec: chunk.segment.startSec,
          durationSec: chunk.segment.durationSec,
          text: chunk.transcription.text,
          words: chunk.transcription.words,
          additionalFormats: chunk.transcription.additionalFormats,
        }),
      )

      const subResult = await this.generateAndPersistSubtitles({
        text: partsResult.data.text,
        words: [],
        additionalFormats: [],
        sourceDurationSec: expectedDurationSec,
        chunks: chunkInputs,
        outputFileLabel,
        profile: activeProfile,
        trackLanguageTag: subtitleTrackLanguageTag || activeProfile.defaultTrackLanguageTag,
        runtimeConfig: subtitleRuntimeConfig,
        modeUsed: ctx.modeUsed,
        modeRequested: ctx.modeRequested,
        mediaKind: ctx.mediaKind,
        onProgress: ctx.onProgress,
        progressContext: ctx.progressContext,
      })

      if (!subResult.ok) {
        return this.buildResult(ctx, {
          error: subResult.error.message,
          fallbackApplied,
          totalChunks: partsResult.data.totalChunks,
          successfulChunks: partsResult.data.successfulChunks,
          failedChunks: partsResult.data.failedChunks,
          sourceDurationSec: expectedDurationSec,
          transcribedDurationSec: partsResult.data.transcribedDurationSec,
          coverageRatio: coverageResult.data,
        })
      }

      ctx.warnings = [...ctx.warnings, ...subResult.data.warnings]
      subtitleFields = this.toSubtitleFields(subResult.data)

      if (subResult.data.shouldFail) {
        return this.buildResult(ctx, {
          error: subResult.data.failureMessage!,
          fallbackApplied,
          totalChunks: partsResult.data.totalChunks,
          successfulChunks: partsResult.data.successfulChunks,
          failedChunks: partsResult.data.failedChunks,
          sourceDurationSec: expectedDurationSec,
          transcribedDurationSec: partsResult.data.transcribedDurationSec,
          coverageRatio: coverageResult.data,
          ...subtitleFields,
        })
      }
    }

    this.emitProgress(
      ctx.onProgress,
      {
        stage: 'combining_chunks',
        message: 'Combining chunk transcripts...',
        percent: 85,
      },
      ctx.progressContext,
    )
    const outputPath = await this.saveTranscript(
      inputFilePath,
      partsResult.data.text,
      outputFileLabel,
    )

    this.emitProgress(
      ctx.onProgress,
      {
        stage: 'saving_output',
        message: 'Saving transcript output...',
        percent: 95,
      },
      ctx.progressContext,
    )
    this.emitProgress(
      ctx.onProgress,
      {
        stage: 'completed',
        message: fallbackApplied
          ? 'Transcription completed with fallback to parts mode.'
          : 'Transcription completed.',
        percent: 100,
      },
      ctx.progressContext,
    )

    return this.buildResult(ctx, {
      success: true,
      data: partsResult.data.text,
      outputPath,
      fallbackApplied,
      isComplete: true,
      totalChunks: partsResult.data.totalChunks,
      successfulChunks: partsResult.data.successfulChunks,
      failedChunks: partsResult.data.failedChunks,
      sourceDurationSec: expectedDurationSec,
      transcribedDurationSec: partsResult.data.transcribedDurationSec,
      coverageRatio: coverageResult.data,
      ...subtitleFields,
    })
  }

  /**
   * Finishes the whole-mode flow after a successful transcription.
   */
  private async finishWholeMode(
    ctx: RunContext,
    transcription: StructuredTranscriptionResult,
    inputFilePath: string,
    outputFileLabel: string,
    subtitleRuntimeConfig: SubtitleRuntimeConfig,
    subtitleProfile: LanguageSubtitleProfile | null,
    subtitleTrackLanguageTag: string | undefined,
  ): Promise<TranscriptionResult> {
    let subtitleFields: Partial<TranscriptionResult> = {}

    if (subtitleRuntimeConfig.enabled) {
      const activeProfile = subtitleProfile ||
        resolveSubtitleProfile({ languageCode: 'en' }).profile

      const subResult = await this.generateAndPersistSubtitles({
        text: transcription.text,
        words: transcription.words,
        additionalFormats: transcription.additionalFormats,
        sourceDurationSec: ctx.sourceDurationSec,
        outputFileLabel,
        profile: activeProfile,
        trackLanguageTag: subtitleTrackLanguageTag || activeProfile.defaultTrackLanguageTag,
        runtimeConfig: subtitleRuntimeConfig,
        modeUsed: ctx.modeUsed,
        modeRequested: ctx.modeRequested,
        mediaKind: ctx.mediaKind,
        onProgress: ctx.onProgress,
        progressContext: ctx.progressContext,
      })

      if (!subResult.ok) {
        return this.buildResult(ctx, { error: subResult.error.message })
      }

      ctx.warnings = [...ctx.warnings, ...subResult.data.warnings]
      subtitleFields = this.toSubtitleFields(subResult.data)

      if (subResult.data.shouldFail) {
        return this.buildResult(ctx, {
          error: subResult.data.failureMessage!,
          ...subtitleFields,
        })
      }
    }

    this.emitProgress(
      ctx.onProgress,
      {
        stage: 'saving_output',
        message: 'Saving transcript output...',
        percent: 95,
      },
      ctx.progressContext,
    )
    const outputPath = await this.saveTranscript(
      inputFilePath,
      transcription.text,
      outputFileLabel,
    )

    this.emitProgress(
      ctx.onProgress,
      { stage: 'completed', message: 'Transcription completed.', percent: 100 },
      ctx.progressContext,
    )

    return this.buildResult(ctx, {
      success: true,
      data: transcription.text,
      outputPath,
      isComplete: true,
      ...subtitleFields,
    })
  }

  updateConfig(config: Partial<TranscriptionConfig>): void {
    if (this.transcriptionService) {
      this.transcriptionService.updateConfig(config)
    }
  }

  updateOutputDir(outputDir: string): Promise<void> {
    if (outputDir && this.fileService) {
      this.fileService.setOutputDir(outputDir)
      console.log(`TranscriptionApp output directory updated to: ${outputDir}`)
    }
    return Promise.resolve()
  }
}
