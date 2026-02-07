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

  /**
   * Creates a new TranscriptionApp instance
   */
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

  /**
   * Initializes the application
   */
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
    return /413|payload|too\s+large|size|timeout|timed\s*out|resource|limit|process/i.test(message)
  }

  private async waitForRetry(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private isAsyncWebhookEnabled(): boolean {
    const raw = (Deno.env.get('ENABLE_ELEVENLABS_ASYNC_WEBHOOK') || '').trim().toLowerCase()
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
      warnings.push('Video inputs are always transcribed in parts mode to guarantee full coverage.')
    }

    if (exceedsElevenLabsHardLimits(inspection) && modeUsed !== 'parts') {
      modeUsed = 'parts'
      warnings.push(
        'Input exceeds single-request hard limits (3GB or 10h). Automatically switching to parts mode.',
      )
    }

    if (
      this.isAsyncWebhookEnabled() && inspection.durationSec >= ASYNC_WEBHOOK_RUNTIME_THRESHOLD_SEC
    ) {
      warnings.push(
        'Async webhook mode flag is enabled for long media. This local build keeps deterministic chunked processing enabled.',
      )
    }

    if (modeUsed === 'parts' && inspection.mediaKind === 'video' && !chunkDurationProvided) {
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
        error: new Error(`Failed to read input audio file: ${audioResult.error.message}`),
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
      const audioResult = await this.fileService.readAudioFileFromPath(segment.path)
      if (!audioResult.ok) {
        lastError = new Error(
          `Failed to read chunk ${segment.index + 1}/${totalChunks}: ${audioResult.error.message}`,
        )
      } else {
        const transcriptionResult = await this.transcriptionService.transcribe(audioResult.data)
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
        const delay = CHUNK_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
        await this.waitForRetry(delay)
      }
    }

    return {
      ok: false,
      error: lastError || new Error(`Chunk ${segment.index + 1}/${totalChunks} failed`),
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
      console.log(`Splitting audio file into ${chunkDuration}-second chunks...`)
      const splitResult = await this.audioSplitterService.splitAudio({
        inputFile: inputFilePath,
        outputDir: tempDir,
        segmentDuration: chunkDuration,
        filePrefix: `chunk_${inputFilePath.split('/').pop()?.split('.')[0]}`,
      })

      if (!splitResult.ok) {
        return {
          ok: false,
          error: new Error(`Failed to split audio file: ${splitResult.error.message}`),
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
        console.log(`Transcribing chunk ${segment.index + 1}/${totalChunks}...`)

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
        chunkDetails.push({
          segment,
          transcription: chunkResult.data,
        })
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
            chunkTranscriptions.map((transcription) => transcription.text),
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
    if (!onProgress) {
      return
    }

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

      // Video jobs are business-critical for subtitle output: never disable or relax strict mode.
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

    return {
      enabled,
      strictQuality,
      maxHardViolationRatio,
    }
  }

  private hasRequiredSubtitleArtifacts(
    artifacts: SubtitleArtifacts,
    strictMode: boolean,
  ): boolean {
    if (!strictMode) {
      return artifacts.generated
    }

    return artifacts.generated &&
      artifacts.formats.includes('srt') &&
      artifacts.formats.includes('vtt') &&
      Boolean(artifacts.paths?.srt) &&
      Boolean(artifacts.paths?.vtt)
  }

  private async saveSubtitles(
    fileName: string,
    artifacts: SubtitleArtifacts,
  ): Promise<SubtitleArtifacts> {
    if (!artifacts.contents) {
      return artifacts
    }

    const paths: { srt?: string; vtt?: string } = { ...artifacts.paths }
    if (artifacts.contents.srt) {
      paths.srt = await this.fileService.saveSubtitle(artifacts.contents.srt, fileName, 'srt')
    }
    if (artifacts.contents.vtt) {
      paths.vtt = await this.fileService.saveSubtitle(artifacts.contents.vtt, fileName, 'vtt')
    }

    return {
      ...artifacts,
      paths,
    }
  }

  private summarizeViolations(violations: string[], maxItems = 8): string {
    if (violations.length === 0) {
      return 'No detailed violations were provided.'
    }

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

  private buildSubtitles(
    options: {
      text: string
      words: StructuredTranscriptionResult['words']
      additionalFormats: StructuredTranscriptionResult['additionalFormats']
      sourceDurationSec: number
      profile: LanguageSubtitleProfile
      trackLanguageTag: string
      chunks?: SubtitleChunkInput[]
      strictQuality: boolean
      maxHardViolationRatio: number
    },
  ): Result<SubtitleGenerationOutput, Error> {
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
          this.summarizeViolations(quality.violations)
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
      return {
        ok: false,
        error: new Error(message),
      }
    }
  }

  private verifyCoverage(
    sourceDurationSec: number,
    transcribedDurationSec: number,
  ): Result<number, Error> {
    if (!(sourceDurationSec > 0)) {
      return { ok: true, data: 1 }
    }

    if (!(transcribedDurationSec > 0)) {
      return {
        ok: false,
        error: new Error('No transcribed duration was recorded for chunked transcription.'),
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
   * Runs the transcription process
   * @param inputFilePath - Path to the input media file
   * @param outputDir - Optional output directory for the transcription
   * @param options - Transcription mode and chunk options
   * @returns A TranscriptionResult object
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
    let modeUsed: TranscriptionMode = requestedMode
    const outputFileName = options.outputFileName
    const outputFileLabel = outputFileName || inputFilePath.split('/').pop() || 'transcription'
    const mimeTypeHint = options.mimeTypeHint
    const subtitleOptions = options.subtitleOptions
    const onProgress = options.onProgress
    const progressContext = {
      modeRequested: requestedMode,
      modeUsed,
      jobId: options.jobId,
    }

    let mediaKind: InputMediaKind = 'audio'
    let audioExtracted = false
    let warnings: string[] = []
    let cleanupPaths: string[] = []
    let preparedInputPath = inputFilePath
    let sourceDurationSec = 0
    let subtitleProfile: LanguageSubtitleProfile | null = null
    let subtitleTrackLanguageTag: string | undefined
    let subtitleRuntimeConfig: SubtitleRuntimeConfig = {
      enabled: false,
      strictQuality: false,
      maxHardViolationRatio: SUBTITLE_DEFAULT_HARD_VIOLATION_RATIO,
    }
    let subtitleGenerated = false
    let subtitleFormats: Array<'srt' | 'vtt'> | undefined
    let subtitlePaths: { srt?: string; vtt?: string } | undefined
    let subtitleCueCount: number | undefined
    let subtitleQuality: SubtitleQualityReport | undefined
    let subtitleViolationCount: number | undefined
    let subtitleQualityReportPath: string | undefined
    let subtitleContents: { srt?: string; vtt?: string } | undefined

    try {
      if (!this.transcriptionService) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: 'Transcription service is not initialized.',
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: 'TranscriptionService not initialized. Call initialize() first.',
          modeRequested: requestedMode,
          modeUsed,
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
        }
      }

      const fileExists = await this.fileService.fileExists(inputFilePath)
      if (!fileExists) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: `Input file not found: ${inputFilePath}`,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: `Input file not found: ${inputFilePath}`,
          modeRequested: requestedMode,
          modeUsed,
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
        }
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
        mimeTypeHint,
      })
      if (!sourceInspectionResult.ok) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: sourceInspectionResult.error.message,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: sourceInspectionResult.error.message,
          modeRequested: requestedMode,
          modeUsed,
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
        }
      }

      const sourceInspection = sourceInspectionResult.data
      mediaKind = sourceInspection.mediaKind
      sourceDurationSec = sourceInspection.durationSec

      if (!sourceInspection.hasAudio) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: 'Input media has no audio stream.',
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error:
            'Input media has no audio stream. Please provide a media file that contains audible content.',
          modeRequested: requestedMode,
          modeUsed,
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
        }
      }

      const routing = this.resolveModeRouting(
        requestedMode,
        sourceInspection,
        normalizedChunkDuration,
        chunkDurationProvided,
      )
      modeUsed = routing.modeUsed
      progressContext.modeUsed = modeUsed
      warnings = [...warnings, ...routing.warnings]

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
        mimeTypeHint,
      })

      if (!preparationResult.ok) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: preparationResult.error.message,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: preparationResult.error.message,
          modeRequested: requestedMode,
          modeUsed,
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
        }
      }

      preparedInputPath = preparationResult.data.preparedFilePath
      mediaKind = preparationResult.data.mediaKind
      audioExtracted = preparationResult.data.audioExtracted
      warnings = [...warnings, ...preparationResult.data.warnings]
      cleanupPaths = preparationResult.data.cleanupPaths

      if (preparedInputPath !== inputFilePath) {
        const preparedInspectionResult = await this.mediaInspectorService.inspectMedia({
          filePath: preparedInputPath,
        })
        if (!preparedInspectionResult.ok) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: preparedInspectionResult.error.message,
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: preparedInspectionResult.error.message,
            modeRequested: requestedMode,
            modeUsed,
            fallbackApplied: false,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
          }
        }

        if (!preparedInspectionResult.data.hasAudio) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: 'Prepared media has no audio stream.',
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: 'Prepared media has no audio stream.',
            modeRequested: requestedMode,
            modeUsed,
            fallbackApplied: false,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
          }
        }

        if (preparedInspectionResult.data.durationSec > 0) {
          sourceDurationSec = preparedInspectionResult.data.durationSec
        }
      }

      const currentLanguageCode = this.transcriptionService.getConfig().languageCode
      const profileSelection = resolveSubtitleProfile({
        languageCode: currentLanguageCode,
        profileId: subtitleOptions?.profile,
        trackLanguageTag: subtitleOptions?.trackLanguageTag,
      })
      subtitleProfile = profileSelection.profile
      subtitleTrackLanguageTag = profileSelection.trackLanguageTag
      warnings = [...warnings, ...profileSelection.warnings]

      const normalizedSttLanguageCode = resolveSttLanguageCode(currentLanguageCode)
      const resolvedKeyterms = resolveSubtitleKeyterms(
        subtitleProfile,
        subtitleOptions?.keyterms || [],
      )
      this.transcriptionService.updateConfig({
        languageCode: normalizedSttLanguageCode,
        keyterms: resolvedKeyterms,
      })

      subtitleRuntimeConfig = this.resolveSubtitleRuntimeConfig(mediaKind, subtitleOptions)

      if (modeUsed === 'parts') {
        const partsResult = await this.transcribeInParts(
          preparedInputPath,
          routing.chunkDuration,
          onProgress,
          progressContext,
        )
        if (!partsResult.ok) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: partsResult.error.message,
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: partsResult.error.message,
            modeRequested: requestedMode,
            modeUsed: 'parts',
            fallbackApplied: false,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
          }
        }

        const expectedDurationSec = sourceDurationSec > 0
          ? sourceDurationSec
          : partsResult.data.totalPlannedDurationSec
        const coverageResult = this.verifyCoverage(
          expectedDurationSec,
          partsResult.data.transcribedDurationSec,
        )
        if (!coverageResult.ok) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: coverageResult.error.message,
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: coverageResult.error.message,
            modeRequested: requestedMode,
            modeUsed: 'parts',
            fallbackApplied: false,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
            totalChunks: partsResult.data.totalChunks,
            successfulChunks: partsResult.data.successfulChunks,
            failedChunks: partsResult.data.failedChunks,
            sourceDurationSec: expectedDurationSec,
            transcribedDurationSec: partsResult.data.transcribedDurationSec,
            coverageRatio: expectedDurationSec > 0
              ? partsResult.data.transcribedDurationSec / expectedDurationSec
              : 1,
          }
        }

        if (subtitleRuntimeConfig.enabled) {
          this.emitProgress(
            onProgress,
            {
              stage: 'generating_subtitles',
              message: 'Generating subtitle sidecars...',
              percent: 90,
            },
            progressContext,
          )

          const activeProfile = subtitleProfile ||
            resolveSubtitleProfile({ languageCode: 'en' }).profile
          const chunkInputs: SubtitleChunkInput[] = partsResult.data.chunks.map((chunk) => ({
            startSec: chunk.segment.startSec,
            durationSec: chunk.segment.durationSec,
            text: chunk.transcription.text,
            words: chunk.transcription.words,
            additionalFormats: chunk.transcription.additionalFormats,
          }))
          const subtitleBuildResult = this.buildSubtitles({
            text: partsResult.data.text,
            words: [],
            additionalFormats: [],
            sourceDurationSec: expectedDurationSec,
            profile: activeProfile,
            trackLanguageTag: subtitleTrackLanguageTag || activeProfile.defaultTrackLanguageTag,
            chunks: chunkInputs,
            strictQuality: subtitleRuntimeConfig.strictQuality,
            maxHardViolationRatio: subtitleRuntimeConfig.maxHardViolationRatio,
          })

          if (!subtitleBuildResult.ok) {
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: subtitleBuildResult.error.message,
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: subtitleBuildResult.error.message,
              modeRequested: requestedMode,
              modeUsed: 'parts',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              totalChunks: partsResult.data.totalChunks,
              successfulChunks: partsResult.data.successfulChunks,
              failedChunks: partsResult.data.failedChunks,
              sourceDurationSec: expectedDurationSec,
              transcribedDurationSec: partsResult.data.transcribedDurationSec,
              coverageRatio: coverageResult.data,
            }
          }

          warnings = [...warnings, ...subtitleBuildResult.data.warnings]
          const persistedArtifacts = await this.saveSubtitles(
            outputFileLabel,
            subtitleBuildResult.data.artifacts,
          )

          subtitleGenerated = persistedArtifacts.generated
          subtitleFormats = persistedArtifacts.formats as Array<'srt' | 'vtt'>
          subtitlePaths = persistedArtifacts.paths
          subtitleCueCount = persistedArtifacts.cueCount
          subtitleQuality = subtitleBuildResult.data.quality
          subtitleViolationCount = subtitleBuildResult.data.quality.violations.length
          subtitleContents = persistedArtifacts.contents
          subtitleTrackLanguageTag = persistedArtifacts.trackLanguageTag || subtitleTrackLanguageTag
          subtitleQualityReportPath = await this.saveSubtitleQualityDiagnostics(
            outputFileLabel,
            {
              quality: subtitleBuildResult.data.quality,
              warnings: subtitleBuildResult.data.warnings,
              artifacts: persistedArtifacts,
              modeRequested: requestedMode,
              modeUsed: 'parts',
              mediaKind,
            },
          )

          if (subtitleBuildResult.data.shouldFail) {
            const failureMessage = subtitleBuildResult.data.failureMessage ||
              'Subtitle quality checks failed in strict mode.'
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: failureMessage,
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: failureMessage,
              modeRequested: requestedMode,
              modeUsed: 'parts',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              totalChunks: partsResult.data.totalChunks,
              successfulChunks: partsResult.data.successfulChunks,
              failedChunks: partsResult.data.failedChunks,
              sourceDurationSec: expectedDurationSec,
              transcribedDurationSec: partsResult.data.transcribedDurationSec,
              coverageRatio: coverageResult.data,
              subtitleGenerated,
              subtitleFormats,
              subtitlePaths,
              subtitleCueCount,
              subtitleQuality,
              subtitleViolationCount,
              subtitleQualityReportPath,
              subtitleContents,
              subtitleTrackLanguageTag,
            }
          }

          if (
            subtitleRuntimeConfig.strictQuality &&
            !this.hasRequiredSubtitleArtifacts(
              persistedArtifacts,
              subtitleRuntimeConfig.strictQuality,
            )
          ) {
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
              modeRequested: requestedMode,
              modeUsed: 'parts',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              totalChunks: partsResult.data.totalChunks,
              successfulChunks: partsResult.data.successfulChunks,
              failedChunks: partsResult.data.failedChunks,
              sourceDurationSec: expectedDurationSec,
              transcribedDurationSec: partsResult.data.transcribedDurationSec,
              coverageRatio: coverageResult.data,
            }
          }
        }

        this.emitProgress(
          onProgress,
          {
            stage: 'combining_chunks',
            message: 'Combining chunk transcripts...',
            percent: 85,
          },
          progressContext,
        )
        const outputPath = await this.saveTranscript(
          inputFilePath,
          partsResult.data.text,
          outputFileLabel,
        )

        this.emitProgress(
          onProgress,
          {
            stage: 'saving_output',
            message: 'Saving transcript output...',
            percent: 95,
          },
          progressContext,
        )

        this.emitProgress(
          onProgress,
          {
            stage: 'completed',
            message: 'Transcription completed.',
            percent: 100,
          },
          progressContext,
        )
        return {
          success: true,
          data: partsResult.data.text,
          outputPath,
          modeRequested: requestedMode,
          modeUsed: 'parts',
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: true,
          totalChunks: partsResult.data.totalChunks,
          successfulChunks: partsResult.data.successfulChunks,
          failedChunks: partsResult.data.failedChunks,
          sourceDurationSec: expectedDurationSec,
          transcribedDurationSec: partsResult.data.transcribedDurationSec,
          coverageRatio: coverageResult.data,
          subtitleGenerated,
          subtitleFormats,
          subtitlePaths,
          subtitleCueCount,
          subtitleQuality,
          subtitleViolationCount,
          subtitleQualityReportPath,
          subtitleContents,
          subtitleTrackLanguageTag,
        }
      }

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
        if (subtitleRuntimeConfig.enabled) {
          this.emitProgress(
            onProgress,
            {
              stage: 'generating_subtitles',
              message: 'Generating subtitle sidecars...',
              percent: 90,
            },
            progressContext,
          )

          const activeProfile = subtitleProfile ||
            resolveSubtitleProfile({ languageCode: 'en' }).profile
          const subtitleBuildResult = this.buildSubtitles({
            text: wholeResult.data.text,
            words: wholeResult.data.words,
            additionalFormats: wholeResult.data.additionalFormats,
            sourceDurationSec: sourceDurationSec,
            profile: activeProfile,
            trackLanguageTag: subtitleTrackLanguageTag || activeProfile.defaultTrackLanguageTag,
            strictQuality: subtitleRuntimeConfig.strictQuality,
            maxHardViolationRatio: subtitleRuntimeConfig.maxHardViolationRatio,
          })

          if (!subtitleBuildResult.ok) {
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: subtitleBuildResult.error.message,
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: subtitleBuildResult.error.message,
              modeRequested: requestedMode,
              modeUsed: 'whole',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
            }
          }

          warnings = [...warnings, ...subtitleBuildResult.data.warnings]
          const persistedArtifacts = await this.saveSubtitles(
            outputFileLabel,
            subtitleBuildResult.data.artifacts,
          )
          subtitleGenerated = persistedArtifacts.generated
          subtitleFormats = persistedArtifacts.formats as Array<'srt' | 'vtt'>
          subtitlePaths = persistedArtifacts.paths
          subtitleCueCount = persistedArtifacts.cueCount
          subtitleQuality = subtitleBuildResult.data.quality
          subtitleViolationCount = subtitleBuildResult.data.quality.violations.length
          subtitleContents = persistedArtifacts.contents
          subtitleTrackLanguageTag = persistedArtifacts.trackLanguageTag || subtitleTrackLanguageTag
          subtitleQualityReportPath = await this.saveSubtitleQualityDiagnostics(
            outputFileLabel,
            {
              quality: subtitleBuildResult.data.quality,
              warnings: subtitleBuildResult.data.warnings,
              artifacts: persistedArtifacts,
              modeRequested: requestedMode,
              modeUsed: 'whole',
              mediaKind,
            },
          )

          if (subtitleBuildResult.data.shouldFail) {
            const failureMessage = subtitleBuildResult.data.failureMessage ||
              'Subtitle quality checks failed in strict mode.'
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: failureMessage,
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: failureMessage,
              modeRequested: requestedMode,
              modeUsed: 'whole',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
              subtitleGenerated,
              subtitleFormats,
              subtitlePaths,
              subtitleCueCount,
              subtitleQuality,
              subtitleViolationCount,
              subtitleQualityReportPath,
              subtitleContents,
              subtitleTrackLanguageTag,
            }
          }

          if (
            subtitleRuntimeConfig.strictQuality &&
            !this.hasRequiredSubtitleArtifacts(
              persistedArtifacts,
              subtitleRuntimeConfig.strictQuality,
            )
          ) {
            this.emitProgress(
              onProgress,
              {
                stage: 'failed',
                message: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
                percent: 100,
              },
              progressContext,
            )
            return {
              success: false,
              error: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
              modeRequested: requestedMode,
              modeUsed: 'whole',
              fallbackApplied: false,
              warnings,
              mediaKind,
              audioExtracted,
              isComplete: false,
              sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
            }
          }
        }

        this.emitProgress(
          onProgress,
          {
            stage: 'saving_output',
            message: 'Saving transcript output...',
            percent: 95,
          },
          progressContext,
        )
        const outputPath = await this.saveTranscript(
          inputFilePath,
          wholeResult.data.text,
          outputFileLabel,
        )

        this.emitProgress(
          onProgress,
          {
            stage: 'completed',
            message: 'Transcription completed.',
            percent: 100,
          },
          progressContext,
        )
        return {
          success: true,
          data: wholeResult.data.text,
          outputPath,
          modeRequested: requestedMode,
          modeUsed: 'whole',
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: true,
          sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
          subtitleGenerated,
          subtitleFormats,
          subtitlePaths,
          subtitleCueCount,
          subtitleQuality,
          subtitleViolationCount,
          subtitleQualityReportPath,
          subtitleContents,
          subtitleTrackLanguageTag,
        }
      }

      const wholeErrorMessage = wholeResult.error.message
      if (!this.isRecoverableWholeModeError(wholeErrorMessage)) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: wholeErrorMessage,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: wholeErrorMessage,
          modeRequested: requestedMode,
          modeUsed: 'whole',
          fallbackApplied: false,
          warnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
          sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
        }
      }

      const fallbackWarning =
        `Whole-file transcription failed (${wholeErrorMessage}). Automatically retrying in parts.`
      console.warn(fallbackWarning)
      const fallbackWarnings = [...warnings, fallbackWarning]
      progressContext.modeUsed = 'parts'
      this.emitProgress(
        onProgress,
        {
          stage: 'splitting',
          message: fallbackWarning,
          percent: 25,
        },
        progressContext,
      )

      const fallbackResult = await this.transcribeInParts(
        preparedInputPath,
        routing.chunkDuration,
        onProgress,
        progressContext,
      )
      if (!fallbackResult.ok) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: `${wholeErrorMessage}. Fallback failed: ${fallbackResult.error.message}`,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: `${wholeErrorMessage}. Fallback failed: ${fallbackResult.error.message}`,
          modeRequested: requestedMode,
          modeUsed: 'parts',
          fallbackApplied: true,
          warnings: fallbackWarnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
          sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
        }
      }

      const expectedDurationSec = sourceDurationSec > 0
        ? sourceDurationSec
        : fallbackResult.data.totalPlannedDurationSec
      const coverageResult = this.verifyCoverage(
        expectedDurationSec,
        fallbackResult.data.transcribedDurationSec,
      )
      if (!coverageResult.ok) {
        this.emitProgress(
          onProgress,
          {
            stage: 'failed',
            message: coverageResult.error.message,
            percent: 100,
          },
          progressContext,
        )
        return {
          success: false,
          error: coverageResult.error.message,
          modeRequested: requestedMode,
          modeUsed: 'parts',
          fallbackApplied: true,
          warnings: fallbackWarnings,
          mediaKind,
          audioExtracted,
          isComplete: false,
          totalChunks: fallbackResult.data.totalChunks,
          successfulChunks: fallbackResult.data.successfulChunks,
          failedChunks: fallbackResult.data.failedChunks,
          sourceDurationSec: expectedDurationSec,
          transcribedDurationSec: fallbackResult.data.transcribedDurationSec,
          coverageRatio: expectedDurationSec > 0
            ? fallbackResult.data.transcribedDurationSec / expectedDurationSec
            : 1,
        }
      }

      if (subtitleRuntimeConfig.enabled) {
        this.emitProgress(
          onProgress,
          {
            stage: 'generating_subtitles',
            message: 'Generating subtitle sidecars...',
            percent: 90,
          },
          progressContext,
        )

        const activeProfile = subtitleProfile ||
          resolveSubtitleProfile({ languageCode: 'en' }).profile
        const chunkInputs: SubtitleChunkInput[] = fallbackResult.data.chunks.map((chunk) => ({
          startSec: chunk.segment.startSec,
          durationSec: chunk.segment.durationSec,
          text: chunk.transcription.text,
          words: chunk.transcription.words,
          additionalFormats: chunk.transcription.additionalFormats,
        }))
        const subtitleBuildResult = this.buildSubtitles({
          text: fallbackResult.data.text,
          words: [],
          additionalFormats: [],
          sourceDurationSec: expectedDurationSec,
          profile: activeProfile,
          trackLanguageTag: subtitleTrackLanguageTag || activeProfile.defaultTrackLanguageTag,
          chunks: chunkInputs,
          strictQuality: subtitleRuntimeConfig.strictQuality,
          maxHardViolationRatio: subtitleRuntimeConfig.maxHardViolationRatio,
        })

        if (!subtitleBuildResult.ok) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: subtitleBuildResult.error.message,
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: subtitleBuildResult.error.message,
            modeRequested: requestedMode,
            modeUsed: 'parts',
            fallbackApplied: true,
            warnings: fallbackWarnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
            totalChunks: fallbackResult.data.totalChunks,
            successfulChunks: fallbackResult.data.successfulChunks,
            failedChunks: fallbackResult.data.failedChunks,
            sourceDurationSec: expectedDurationSec,
            transcribedDurationSec: fallbackResult.data.transcribedDurationSec,
            coverageRatio: coverageResult.data,
          }
        }

        warnings = [...fallbackWarnings, ...subtitleBuildResult.data.warnings]
        const persistedArtifacts = await this.saveSubtitles(
          outputFileLabel,
          subtitleBuildResult.data.artifacts,
        )
        subtitleGenerated = persistedArtifacts.generated
        subtitleFormats = persistedArtifacts.formats as Array<'srt' | 'vtt'>
        subtitlePaths = persistedArtifacts.paths
        subtitleCueCount = persistedArtifacts.cueCount
        subtitleQuality = subtitleBuildResult.data.quality
        subtitleViolationCount = subtitleBuildResult.data.quality.violations.length
        subtitleContents = persistedArtifacts.contents
        subtitleTrackLanguageTag = persistedArtifacts.trackLanguageTag || subtitleTrackLanguageTag
        subtitleQualityReportPath = await this.saveSubtitleQualityDiagnostics(
          outputFileLabel,
          {
            quality: subtitleBuildResult.data.quality,
            warnings: subtitleBuildResult.data.warnings,
            artifacts: persistedArtifacts,
            modeRequested: requestedMode,
            modeUsed: 'parts',
            mediaKind,
          },
        )

        if (subtitleBuildResult.data.shouldFail) {
          const failureMessage = subtitleBuildResult.data.failureMessage ||
            'Subtitle quality checks failed in strict mode.'
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: failureMessage,
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: failureMessage,
            modeRequested: requestedMode,
            modeUsed: 'parts',
            fallbackApplied: true,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
            totalChunks: fallbackResult.data.totalChunks,
            successfulChunks: fallbackResult.data.successfulChunks,
            failedChunks: fallbackResult.data.failedChunks,
            sourceDurationSec: expectedDurationSec,
            transcribedDurationSec: fallbackResult.data.transcribedDurationSec,
            coverageRatio: coverageResult.data,
            subtitleGenerated,
            subtitleFormats,
            subtitlePaths,
            subtitleCueCount,
            subtitleQuality,
            subtitleViolationCount,
            subtitleQualityReportPath,
            subtitleContents,
            subtitleTrackLanguageTag,
          }
        }

        if (
          subtitleRuntimeConfig.strictQuality &&
          !this.hasRequiredSubtitleArtifacts(
            persistedArtifacts,
            subtitleRuntimeConfig.strictQuality,
          )
        ) {
          this.emitProgress(
            onProgress,
            {
              stage: 'failed',
              message: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
              percent: 100,
            },
            progressContext,
          )
          return {
            success: false,
            error: 'Strict subtitle mode requires generated SRT and VTT sidecars.',
            modeRequested: requestedMode,
            modeUsed: 'parts',
            fallbackApplied: true,
            warnings,
            mediaKind,
            audioExtracted,
            isComplete: false,
            totalChunks: fallbackResult.data.totalChunks,
            successfulChunks: fallbackResult.data.successfulChunks,
            failedChunks: fallbackResult.data.failedChunks,
            sourceDurationSec: expectedDurationSec,
            transcribedDurationSec: fallbackResult.data.transcribedDurationSec,
            coverageRatio: coverageResult.data,
          }
        }
      } else {
        warnings = fallbackWarnings
      }

      this.emitProgress(
        onProgress,
        {
          stage: 'combining_chunks',
          message: 'Combining chunk transcripts...',
          percent: 85,
        },
        progressContext,
      )
      const outputPath = await this.saveTranscript(
        inputFilePath,
        fallbackResult.data.text,
        outputFileLabel,
      )

      this.emitProgress(
        onProgress,
        {
          stage: 'saving_output',
          message: 'Saving transcript output...',
          percent: 95,
        },
        progressContext,
      )
      this.emitProgress(
        onProgress,
        {
          stage: 'completed',
          message: 'Transcription completed with fallback to parts mode.',
          percent: 100,
        },
        progressContext,
      )
      return {
        success: true,
        data: fallbackResult.data.text,
        outputPath,
        modeRequested: requestedMode,
        modeUsed: 'parts',
        fallbackApplied: true,
        warnings: fallbackWarnings,
        mediaKind,
        audioExtracted,
        isComplete: true,
        totalChunks: fallbackResult.data.totalChunks,
        successfulChunks: fallbackResult.data.successfulChunks,
        failedChunks: fallbackResult.data.failedChunks,
        sourceDurationSec: expectedDurationSec,
        transcribedDurationSec: fallbackResult.data.transcribedDurationSec,
        coverageRatio: coverageResult.data,
        subtitleGenerated,
        subtitleFormats,
        subtitlePaths,
        subtitleCueCount,
        subtitleQuality,
        subtitleViolationCount,
        subtitleQualityReportPath,
        subtitleContents,
        subtitleTrackLanguageTag,
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Error processing audio file:', errorMessage)
      this.emitProgress(
        onProgress,
        {
          stage: 'failed',
          message: errorMessage,
          percent: 100,
        },
        progressContext,
      )

      return {
        success: false,
        error: errorMessage,
        modeRequested: requestedMode,
        modeUsed,
        fallbackApplied: false,
        warnings,
        mediaKind,
        audioExtracted,
        isComplete: false,
        sourceDurationSec: sourceDurationSec > 0 ? sourceDurationSec : undefined,
      }
    } finally {
      await this.cleanupPreparedFiles(cleanupPaths)
    }
  }

  /**
   * Updates the transcription configuration
   */
  updateConfig(config: Partial<TranscriptionConfig>): void {
    if (this.transcriptionService) {
      this.transcriptionService.updateConfig(config)
    }
  }

  /**
   * Updates the output directory
   * @param outputDir - New output directory
   */
  updateOutputDir(outputDir: string): Promise<void> {
    if (outputDir && this.fileService) {
      this.fileService.setOutputDir(outputDir)
      console.log(`TranscriptionApp output directory updated to: ${outputDir}`)
    }
    return Promise.resolve()
  }
}
