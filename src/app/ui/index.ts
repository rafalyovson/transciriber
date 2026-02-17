import { basename, join } from '@std/path'
import { ensureDir } from '@std/fs/ensure-dir'
import { exists } from '@std/fs/exists'
import { serveDir } from '@std/http/file-server'
import { TranscriptionApp } from '../index.ts'
import type {
  TranscriptionJobStatus,
  TranscriptionMode,
  TranscriptionProgressEvent,
} from '../../types/index.ts'
import { JOB_TTL_MS, SSE_HEARTBEAT_MS } from './types.ts'
import type {
  ActiveTranscriptionRequest,
  RouterContext,
  TranscriptionApiPayload,
  TranscriptionJobRecord,
} from './types.ts'
import {
  isPathWithinDirectory,
  normalizeTranscriptionRequestOptions,
  toTranscriptionApiResponse,
} from './utils.ts'
import {
  handleCreateJob,
  handleDownloadYouTube,
  handleGetDefaultFolder,
  handleGetLanguageName,
  handleGetLanguages,
  handleSelectOutputFolder,
  handleSetOutputFolder,
  handleTranscribeAudio,
  handleUploadFile,
} from './routes.ts'

// Re-export utilities so existing tests and imports keep working
export {
  isPathWithinDirectory,
  isSupportedUploadFile,
  normalizeTranscriptionRequestOptions,
  toTranscriptionApiResponse,
} from './utils.ts'

export class TranscriberUI {
  private app: TranscriptionApp
  private outputFolders: string[] = ['outputs', 'inputs']
  private tempDir: string
  private isShuttingDown = false
  private server: Deno.HttpServer | null = null
  private jobs: Map<string, TranscriptionJobRecord> = new Map()
  private activeJobId: string | null = null

  constructor() {
    this.app = new TranscriptionApp({ languageCode: 'hy' })
    this.initializeOutputFolders()
    this.tempDir = join(Deno.cwd(), 'temp')
    this.initializeTempDir()
  }

  // --- Initialization ---

  private async initializeApp(): Promise<boolean> {
    try {
      return await this.app.initialize()
    } catch (error) {
      console.error('Error initializing transcription app:', error)
      return false
    }
  }

  private async initializeTempDir() {
    try {
      await ensureDir(this.tempDir)
      console.log(`Temporary directory created at ${this.tempDir}`)
    } catch (error) {
      console.error('Error creating temp directory:', error)
    }
  }

  private async initializeOutputFolders() {
    try {
      this.outputFolders.push(Deno.cwd())

      const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
      if (homeDir) {
        this.outputFolders.push(homeDir)

        const downloadsPath = join(homeDir, 'Downloads')
        if (await exists(downloadsPath)) {
          this.outputFolders.unshift(downloadsPath)
          if (this.app) {
            await this.app.updateOutputDir(downloadsPath)
            console.log(
              `Set default output directory to Downloads: ${downloadsPath}`,
            )
          }
        }

        const commonDirs = ['Documents', 'Desktop']
        for (const dir of commonDirs) {
          const path = join(homeDir, dir)
          if (await exists(path)) {
            this.outputFolders.push(path)
          }
        }
      }
    } catch (error) {
      console.error('Error initializing output folders:', error)
    }
  }

  // --- Utilities ---

  private generateId(): string {
    const randomValues = new Array(16)
    for (let i = 0; i < 16; i++) {
      randomValues[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(new Uint8Array(randomValues))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private getUIPath(): string {
    return join(Deno.cwd(), 'src', 'ui')
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status,
    })
  }

  // --- Job management ---

  private getJobRecord(jobId: string): TranscriptionJobRecord | undefined {
    return this.jobs.get(jobId)
  }

  private clearJobCleanupTimer(record: TranscriptionJobRecord): void {
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer)
      record.cleanupTimer = undefined
    }
  }

  private scheduleJobCleanup(jobId: string): void {
    const record = this.jobs.get(jobId)
    if (!record) return

    this.clearJobCleanupTimer(record)
    record.cleanupTimer = setTimeout(() => {
      this.jobs.delete(jobId)
      if (this.activeJobId === jobId) this.activeJobId = null
    }, JOB_TTL_MS)
  }

  private createJobRecord(jobId: string): TranscriptionJobRecord {
    const record: TranscriptionJobRecord = {
      snapshot: { jobId, status: 'queued', progress: null },
      subscribers: new Set(),
    }
    this.jobs.set(jobId, record)
    return record
  }

  private updateJobStatus(
    record: TranscriptionJobRecord,
    status: TranscriptionJobStatus,
  ): void {
    record.snapshot.status = status
  }

  private publishJobEvent(
    jobId: string,
    event: TranscriptionProgressEvent,
  ): void {
    const record = this.jobs.get(jobId)
    if (!record) return
    record.snapshot.progress = event
    for (const subscriber of record.subscribers) {
      subscriber(event)
    }
  }

  private completeJob(
    jobId: string,
    result: TranscriptionApiPayload,
    status: TranscriptionJobStatus,
    terminalMessage: string,
  ): void {
    const record = this.jobs.get(jobId)
    if (!record) return

    const terminalEvent: TranscriptionProgressEvent = {
      jobId,
      stage: status === 'completed' ? 'completed' : 'failed',
      message: terminalMessage,
      percent: 100,
      modeRequested: result.modeRequested,
      modeUsed: result.modeUsed,
      timestamp: new Date().toISOString(),
    }

    record.snapshot = {
      jobId,
      status,
      progress: terminalEvent,
      result: result.result,
      outputPath: result.outputPath,
      error: result.error,
      modeRequested: result.modeRequested,
      modeUsed: result.modeUsed,
      fallbackApplied: result.fallbackApplied,
      warnings: result.warnings,
      mediaKind: result.mediaKind,
      audioExtracted: result.audioExtracted,
      isComplete: result.isComplete,
      totalChunks: result.totalChunks,
      successfulChunks: result.successfulChunks,
      failedChunks: result.failedChunks,
      sourceDurationSec: result.sourceDurationSec,
      transcribedDurationSec: result.transcribedDurationSec,
      coverageRatio: result.coverageRatio,
      subtitleGenerated: result.subtitleGenerated,
      subtitleFormats: result.subtitleFormats,
      subtitlePaths: result.subtitlePaths,
      subtitleCueCount: result.subtitleCueCount,
      subtitleViolationCount: result.subtitleViolationCount,
      subtitleQualityReportPath: result.subtitleQualityReportPath,
      subtitleQuality: result.subtitleQuality,
      subtitleContents: result.subtitleContents,
      subtitleTrackLanguageTag: result.subtitleTrackLanguageTag,
    }

    this.publishJobEvent(jobId, terminalEvent)
    this.activeJobId = null
    this.scheduleJobCleanup(jobId)
  }

  private parseJobPath(
    path: string,
  ): { jobId: string; events: boolean } | null {
    const parts = path.split('/').filter(Boolean)
    if (
      parts.length < 3 ||
      parts[0] !== 'api' ||
      parts[1] !== 'transcriptionJobs'
    ) {
      return null
    }
    if (parts.length === 3) return { jobId: parts[2], events: false }
    if (parts.length === 4 && parts[3] === 'events') {
      return { jobId: parts[2], events: true }
    }
    return null
  }

  // --- Request validation & execution ---

  private async validateAndPrepareRequest(
    requestBody: ActiveTranscriptionRequest,
  ): Promise<
    | {
      ok: true
      filePath: string
      options: Record<string, unknown>
      modeRequested: TranscriptionMode
      chunkDuration: number
    }
    | { ok: false; response: Response }
  > {
    const filePath = typeof requestBody.filePath === 'string' ? requestBody.filePath : ''
    const options = typeof requestBody.options === 'object' && requestBody.options !== null
      ? requestBody.options
      : {}
    const { modeRequested, chunkDuration } = normalizeTranscriptionRequestOptions(options)

    if (!(await exists(filePath))) {
      return {
        ok: false,
        response: this.jsonResponse({
          success: false,
          error: `File not found: ${filePath}`,
          modeRequested,
          modeUsed: modeRequested,
          fallbackApplied: false,
          warnings: [],
          mediaKind: 'audio',
          audioExtracted: false,
          isComplete: false,
        }),
      }
    }

    if (!(await isPathWithinDirectory(filePath, this.tempDir))) {
      return {
        ok: false,
        response: this.jsonResponse(
          {
            success: false,
            error: 'Invalid file path. Please upload a file from this session before transcribing.',
            modeRequested,
            modeUsed: modeRequested,
            fallbackApplied: false,
            warnings: [],
            mediaKind: 'audio',
            audioExtracted: false,
            isComplete: false,
          },
          400,
        ),
      }
    }

    if (!(await this.initializeApp())) {
      return {
        ok: false,
        response: this.jsonResponse({
          success: false,
          error: 'Failed to initialize transcription service',
          modeRequested,
          modeUsed: modeRequested,
          fallbackApplied: false,
          warnings: [],
          mediaKind: 'audio',
          audioExtracted: false,
          isComplete: false,
        }),
      }
    }

    return { ok: true, filePath, options, modeRequested, chunkDuration }
  }

  private async executeTranscription(
    jobId: string | undefined,
    filePath: string,
    options: Record<string, unknown>,
    modeRequested: TranscriptionMode,
    chunkDuration: number,
  ): Promise<TranscriptionApiPayload> {
    const languageCode = typeof options.languageCode === 'string' &&
        options.languageCode.length > 0
      ? options.languageCode
      : 'en'
    const apiKey = typeof options.apiKey === 'string' && options.apiKey.trim().length > 0
      ? options.apiKey.trim()
      : undefined
    const mimeTypeHint = typeof options.mimeTypeHint === 'string' &&
        options.mimeTypeHint.length > 0
      ? options.mimeTypeHint
      : undefined
    const outputFileName = typeof options.originalName === 'string' &&
        options.originalName.trim().length > 0
      ? basename(options.originalName.trim())
      : undefined
    const requestedSubtitleOptions = typeof options.subtitleOptions === 'object' &&
        options.subtitleOptions !== null
      ? (options.subtitleOptions as Record<string, unknown>)
      : {}
    const subtitleKeytermsRaw = requestedSubtitleOptions.keyterms
    const subtitleKeyterms = Array.isArray(subtitleKeytermsRaw)
      ? subtitleKeytermsRaw
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      : []
    const subtitleOptions = {
      enabled: typeof requestedSubtitleOptions.enabled === 'boolean'
        ? requestedSubtitleOptions.enabled
        : undefined,
      strictQuality: typeof requestedSubtitleOptions.strictQuality === 'boolean'
        ? requestedSubtitleOptions.strictQuality
        : undefined,
      profile: typeof requestedSubtitleOptions.profile === 'string'
        ? requestedSubtitleOptions.profile
        : undefined,
      trackLanguageTag: typeof requestedSubtitleOptions.trackLanguageTag === 'string'
        ? requestedSubtitleOptions.trackLanguageTag
        : undefined,
      maxHardViolationRatio: typeof requestedSubtitleOptions.maxHardViolationRatio === 'number' &&
          Number.isFinite(requestedSubtitleOptions.maxHardViolationRatio)
        ? requestedSubtitleOptions.maxHardViolationRatio
        : undefined,
      keyterms: subtitleKeyterms,
    }

    this.app.updateConfig({ languageCode, apiKey, modelId: 'scribe_v2' })

    let outputFolder = typeof options.outputFolder === 'string' ? options.outputFolder : undefined
    if (!outputFolder) {
      const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
      if (homeDir) {
        const downloadsPath = join(homeDir, 'Downloads')
        if (await exists(downloadsPath)) outputFolder = downloadsPath
      }
      if (!outputFolder) outputFolder = Deno.cwd()
    }

    const progressHandler = jobId
      ? (event: TranscriptionProgressEvent) => this.publishJobEvent(jobId, { ...event, jobId })
      : undefined

    const result = await this.app.run(filePath, outputFolder, {
      mode: modeRequested,
      chunkDuration: modeRequested === 'parts' ? chunkDuration : undefined,
      outputFileName,
      mimeTypeHint,
      subtitleOptions,
      onProgress: progressHandler,
      jobId,
    })
    return toTranscriptionApiResponse(result, modeRequested)
  }

  // --- SSE ---

  private createSSEStream(jobId: string): Response {
    const record = this.getJobRecord(jobId)
    if (!record) {
      return this.jsonResponse(
        { success: false, error: 'Transcription job not found.' },
        404,
      )
    }

    const encoder = new TextEncoder()
    let cancelCleanup: (() => void) | null = null
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let isClosed = false
        let heartbeatId = 0
        let subscriber: ((event: TranscriptionProgressEvent) => void) | null = null

        const cleanup = () => {
          if (isClosed) return
          isClosed = true
          clearInterval(heartbeatId)
          if (subscriber) record.subscribers.delete(subscriber)
        }
        cancelCleanup = cleanup

        const sendData = (event: TranscriptionProgressEvent) => {
          if (isClosed) return
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
          if (event.stage === 'completed' || event.stage === 'failed') {
            cleanup()
            controller.close()
          }
        }

        heartbeatId = setInterval(() => {
          if (isClosed) return
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
        }, SSE_HEARTBEAT_MS)

        subscriber = (event: TranscriptionProgressEvent) => sendData(event)
        record.subscribers.add(subscriber)

        if (record.snapshot.progress) sendData(record.snapshot.progress)

        if (
          record.snapshot.status === 'completed' ||
          record.snapshot.status === 'failed'
        ) {
          cleanup()
          return
        }
      },
      cancel: () => {
        if (cancelCleanup) cancelCleanup()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // --- Router context (passed to route handlers) ---

  private routerContext(): RouterContext {
    return {
      app: this.app,
      tempDir: this.tempDir,
      outputFolders: this.outputFolders,
      activeJobId: this.activeJobId,
      jobs: this.jobs,
      jsonResponse: (body, status) => this.jsonResponse(body, status),
      generateId: () => this.generateId(),
      initializeApp: () => this.initializeApp(),
      validateAndPrepareRequest: (r) => this.validateAndPrepareRequest(r),
      executeTranscription: (jobId, fp, opts, mode, chunk) =>
        this.executeTranscription(jobId, fp, opts, mode, chunk),
      createJobRecord: (id) => this.createJobRecord(id),
      updateJobStatus: (r, s) => this.updateJobStatus(r, s),
      publishJobEvent: (id, e) => this.publishJobEvent(id, e),
      completeJob: (id, r, s, m) => this.completeJob(id, r, s, m),
      setActiveJobId: (id) => {
        this.activeJobId = id
      },
    }
  }

  // --- Request dispatch ---

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const ctx = this.routerContext()

    const jobRoute = this.parseJobPath(path)
    if (jobRoute && request.method === 'GET') {
      if (jobRoute.events) return this.createSSEStream(jobRoute.jobId)
      const record = this.getJobRecord(jobRoute.jobId)
      if (!record) {
        return this.jsonResponse(
          { success: false, error: 'Transcription job not found.' },
          404,
        )
      }
      return this.jsonResponse({ success: true, ...record.snapshot })
    }

    type RouteHandler = (r: Request, u: URL) => Promise<Response> | Response

    const routes: Record<string, Record<string, RouteHandler>> = {
      '/api/transcriptionJobs': {
        POST: (r) => handleCreateJob(ctx, r),
      },
      '/api/downloadYouTube': {
        POST: (r) => handleDownloadYouTube(ctx, r),
      },
      '/api/uploadFile': {
        POST: (r) => handleUploadFile(ctx, r),
      },
      '/api/transcribeAudio': {
        POST: (r) => handleTranscribeAudio(ctx, r),
      },
      '/api/setOutputFolder': {
        POST: (r) => handleSetOutputFolder(ctx, r),
      },
      '/api/selectOutputFolder': {
        GET: () => handleSelectOutputFolder(ctx),
      },
      '/api/getDefaultFolder': {
        GET: () => handleGetDefaultFolder(ctx),
      },
      '/api/getAvailableLanguages': {
        GET: () => handleGetLanguages(ctx),
      },
      '/api/getLanguageName': {
        GET: (_, u) => handleGetLanguageName(ctx, u),
      },
    }

    const handler = routes[path]?.[request.method]
    if (handler) return await handler(request, url)

    return await serveDir(request, {
      fsRoot: this.getUIPath(),
      quiet: true,
    })
  }

  // --- Cleanup & lifecycle ---

  private async cleanup(): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    console.log('Cleaning up resources...')

    try {
      const tempFiles = []
      try {
        for await (const entry of Deno.readDir(this.tempDir)) {
          if (entry.isFile) tempFiles.push(join(this.tempDir, entry.name))
        }
      } catch (error) {
        console.error('Error reading temp directory:', error)
      }

      for (const file of tempFiles) {
        try {
          await Deno.remove(file)
          console.log(`Removed temp file: ${file}`)
        } catch (error) {
          console.error(`Error removing temp file ${file}:`, error)
        }
      }

      for (const [jobId, record] of this.jobs.entries()) {
        this.clearJobCleanupTimer(record)
        record.subscribers.clear()
        this.jobs.delete(jobId)
      }
      this.activeJobId = null
      console.log('Cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  }

  public async run(): Promise<void> {
    try {
      await this.initializeApp()

      const port = 8000
      console.log(`Starting web server on http://localhost:${port}`)

      const abortController = new AbortController()
      const { signal } = abortController

      this.server = Deno.serve({ port, signal }, (request) => this.handleRequest(request))

      console.log(
        `Server running. Open http://localhost:${port} in your browser`,
      )

      return new Promise((resolve) => {
        const handleSignal = async () => {
          console.log('Shutting down server...')
          abortController.abort()
          await this.cleanup()
          resolve()
          Deno.removeSignalListener('SIGINT', handleSignal)
          Deno.removeSignalListener('SIGTERM', handleSignal)
        }

        Deno.addSignalListener('SIGINT', handleSignal)
        Deno.addSignalListener('SIGTERM', handleSignal)

        if (typeof self !== 'undefined' && 'addEventListener' in self) {
          self.addEventListener('unload', async () => {
            console.log('Browser closed, shutting down server...')
            abortController.abort()
            await this.cleanup()
            resolve()
          })
        }

        console.log('Press Ctrl+C to stop the server')
      })
    } catch (error) {
      console.error('Error running UI:', error)
      throw error
    }
  }
}

if (import.meta.main) {
  const ui = new TranscriberUI()
  await ui.run()
}
