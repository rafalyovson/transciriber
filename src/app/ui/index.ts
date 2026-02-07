// import { Webview } from 'https://deno.land/x/deno_webview/mod.ts'
import { basename, extname, join } from '@std/path'
import { ensureDir } from '@std/fs/ensure-dir'
import { exists } from '@std/fs/exists'
import { TranscriptionApp } from '../index.ts'
import type { TranscriptionResult } from '../index.ts'
import {
  TranscriptionJobSnapshot,
  TranscriptionJobStatus,
  TranscriptionMode,
  TranscriptionProgressEvent,
} from '../../types/index.ts'
import { getChunkDuration } from '../../utils/env.ts'

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.flac',
  '.aac',
  '.webm',
])
const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
])

type UploadFileDescriptor = {
  name: string
  type?: string | null
}

type TranscriptionApiPayload = {
  success: boolean
  result?: string
  outputPath?: string
  error?: string
  modeRequested: TranscriptionMode
  modeUsed: TranscriptionMode
  fallbackApplied: boolean
  warnings: string[]
  mediaKind: 'audio' | 'video'
  audioExtracted: boolean
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
  subtitleViolationCount?: number
  subtitleQualityReportPath?: string
  subtitleQuality?: {
    status: 'pass' | 'review_required' | 'fail'
    violations: string[]
    metrics: Record<string, number>
  }
  subtitleContents?: { srt?: string; vtt?: string }
  subtitleTrackLanguageTag?: string
}

type ActiveTranscriptionRequest = {
  filePath: string
  options: Record<string, unknown>
}

type TranscriptionJobRecord = {
  snapshot: TranscriptionJobSnapshot
  subscribers: Set<(event: TranscriptionProgressEvent) => void>
  cleanupTimer?: number
}

const JOB_TTL_MS = 20 * 60 * 1000
const SSE_HEARTBEAT_MS = 15_000

export function normalizeTranscriptionRequestOptions(
  options: Record<string, unknown> = {},
): { modeRequested: TranscriptionMode; chunkDuration: number } {
  const modeRequested: TranscriptionMode = options.transcriptionMode === 'parts' ? 'parts' : 'whole'

  const fallbackChunkDuration = getChunkDuration()
  const chunkInput = options.chunkDuration
  const chunkDuration = typeof chunkInput === 'number' && Number.isFinite(chunkInput) &&
      chunkInput > 0
    ? Math.floor(chunkInput)
    : fallbackChunkDuration

  return {
    modeRequested,
    chunkDuration,
  }
}

export function toTranscriptionApiResponse(
  result: Partial<TranscriptionResult> & { success: boolean },
  fallbackMode: TranscriptionMode,
): TranscriptionApiPayload {
  return {
    success: result.success,
    result: result.data,
    outputPath: result.outputPath,
    error: result.error,
    modeRequested: result.modeRequested || fallbackMode,
    modeUsed: result.modeUsed || fallbackMode,
    fallbackApplied: result.fallbackApplied ?? false,
    warnings: result.warnings || [],
    mediaKind: result.mediaKind === 'video' ? 'video' : 'audio',
    audioExtracted: result.audioExtracted ?? false,
    isComplete: result.isComplete ?? false,
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
}

export function isSupportedUploadFile(file: UploadFileDescriptor): boolean {
  const extension = extname(file.name).toLowerCase()
  const mimeType = (file.type || '').trim().toLowerCase()

  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return true
  }
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return true
  }
  if (mimeType.startsWith('audio/')) {
    return true
  }
  if (mimeType === 'video/mp4') {
    return true
  }

  return false
}

export async function isPathWithinDirectory(
  targetPath: string,
  directoryPath: string,
): Promise<boolean> {
  try {
    const resolvedTargetPath = (await Deno.realPath(targetPath)).replaceAll('\\', '/')
    const resolvedDirectoryPath = (await Deno.realPath(directoryPath)).replaceAll('\\', '/')

    if (resolvedTargetPath === resolvedDirectoryPath) {
      return false
    }

    const directoryPrefix = resolvedDirectoryPath.endsWith('/')
      ? resolvedDirectoryPath
      : `${resolvedDirectoryPath}/`
    return resolvedTargetPath.startsWith(directoryPrefix)
  } catch {
    return false
  }
}

/**
 * TranscriberUI class that handles the UI application
 */
export class TranscriberUI {
  private app: TranscriptionApp
  private static instance: TranscriberUI
  private outputFolders: string[] = ['outputs', 'inputs']
  private tempDir: string
  private isShuttingDown: boolean = false
  private server: Deno.HttpServer | null = null
  private jobs: Map<string, TranscriptionJobRecord> = new Map()
  private activeJobId: string | null = null

  /**
   * Get the singleton instance of TranscriberUI
   */
  public static getInstance(): TranscriberUI {
    if (!TranscriberUI.instance) {
      TranscriberUI.instance = new TranscriberUI()
    }
    return TranscriberUI.instance
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Initialize the transcription app
    this.app = new TranscriptionApp({
      languageCode: 'hy', // Default Armenian
    })

    // We don't await initialization here since constructors can't be async
    // The initialization will be properly handled in run() and API endpoints

    // Initialize with default output folders
    this.initializeOutputFolders()

    // Set up temp directory for file uploads
    this.tempDir = join(Deno.cwd(), 'temp')
    this.initializeTempDir()
  }

  /**
   * Initialize the transcription app
   */
  private async initializeApp(): Promise<boolean> {
    try {
      return await this.app.initialize()
    } catch (error) {
      console.error('Error initializing transcription app:', error)
      return false
    }
  }

  /**
   * Generate a random ID for filenames
   */
  private generateId(): string {
    const randomValues = new Array(16)
    for (let i = 0; i < 16; i++) {
      randomValues[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(new Uint8Array(randomValues))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Initialize temporary directory for file uploads
   */
  private async initializeTempDir() {
    try {
      await ensureDir(this.tempDir)
      console.log(`Temporary directory created at ${this.tempDir}`)
    } catch (error) {
      console.error('Error creating temp directory:', error)
    }
  }

  /**
   * Initialize available output folders
   */
  private async initializeOutputFolders() {
    try {
      // Add current directory
      this.outputFolders.push(Deno.cwd())

      // Add home directory if available
      const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
      if (homeDir) {
        this.outputFolders.push(homeDir)

        // Add Downloads directory as the primary output location
        const downloadsPath = join(homeDir, 'Downloads')
        if (await exists(downloadsPath)) {
          this.outputFolders.unshift(downloadsPath)

          // Set the app's output directory to Downloads by default
          if (this.app) {
            await this.app.updateOutputDir(downloadsPath)
            console.log(`Set default output directory to Downloads: ${downloadsPath}`)
          }
        }

        // Add other common subdirectories
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

  /**
   * Get the path to the UI HTML file
   */
  private getUIPath(): string {
    const currentDir = Deno.cwd()
    return join(currentDir, 'src', 'ui')
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status,
    })
  }

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
      if (this.activeJobId === jobId) {
        this.activeJobId = null
      }
    }, JOB_TTL_MS)
  }

  private createJobRecord(jobId: string): TranscriptionJobRecord {
    const record: TranscriptionJobRecord = {
      snapshot: {
        jobId,
        status: 'queued',
        progress: null,
      },
      subscribers: new Set(),
    }
    this.jobs.set(jobId, record)
    return record
  }

  private updateJobStatus(record: TranscriptionJobRecord, status: TranscriptionJobStatus): void {
    record.snapshot.status = status
  }

  private publishJobEvent(jobId: string, event: TranscriptionProgressEvent): void {
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

  private parseJobPath(path: string): { jobId: string; events: boolean } | null {
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'transcriptionJobs') {
      return null
    }
    if (parts.length === 3) {
      return { jobId: parts[2], events: false }
    }
    if (parts.length === 4 && parts[3] === 'events') {
      return { jobId: parts[2], events: true }
    }
    return null
  }

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
    const options = (typeof requestBody.options === 'object' && requestBody.options !== null)
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

    return {
      ok: true,
      filePath,
      options,
      modeRequested,
      chunkDuration,
    }
  }

  private async executeTranscription(
    jobId: string | undefined,
    filePath: string,
    options: Record<string, unknown>,
    modeRequested: TranscriptionMode,
    chunkDuration: number,
  ): Promise<TranscriptionApiPayload> {
    const languageCode = typeof options.languageCode === 'string' && options.languageCode.length > 0
      ? options.languageCode
      : 'en'
    const apiKey = typeof options.apiKey === 'string' && options.apiKey.trim().length > 0
      ? options.apiKey.trim()
      : undefined
    const mimeTypeHint = typeof options.mimeTypeHint === 'string' && options.mimeTypeHint.length > 0
      ? options.mimeTypeHint
      : undefined
    const outputFileName =
      typeof options.originalName === 'string' && options.originalName.trim().length > 0
        ? basename(options.originalName.trim())
        : undefined
    const requestedSubtitleOptions = (
        typeof options.subtitleOptions === 'object' && options.subtitleOptions !== null
      )
      ? options.subtitleOptions as Record<string, unknown>
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

    this.app.updateConfig({
      languageCode,
      apiKey,
      modelId: 'scribe_v2',
    })

    let outputFolder = typeof options.outputFolder === 'string' ? options.outputFolder : undefined
    if (!outputFolder) {
      const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
      if (homeDir) {
        const downloadsPath = join(homeDir, 'Downloads')
        if (await exists(downloadsPath)) {
          outputFolder = downloadsPath
        }
      }

      if (!outputFolder) {
        outputFolder = Deno.cwd()
      }
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

  private createSSEStream(jobId: string): Response {
    const record = this.getJobRecord(jobId)
    if (!record) {
      return this.jsonResponse({ success: false, error: 'Transcription job not found.' }, 404)
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
          if (subscriber) {
            record.subscribers.delete(subscriber)
          }
        }
        cancelCleanup = cleanup

        const sendData = (event: TranscriptionProgressEvent) => {
          if (isClosed) return
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (event.stage === 'completed' || event.stage === 'failed') {
            cleanup()
            controller.close()
          }
        }

        heartbeatId = setInterval(() => {
          if (isClosed) return
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
        }, SSE_HEARTBEAT_MS)

        subscriber = (event: TranscriptionProgressEvent) => {
          sendData(event)
        }

        record.subscribers.add(subscriber)

        if (record.snapshot.progress) {
          sendData(record.snapshot.progress)
        }

        if (record.snapshot.status === 'completed' || record.snapshot.status === 'failed') {
          cleanup()
          return
        }
      },
      cancel: () => {
        if (cancelCleanup) {
          cancelCleanup()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const jobRoute = this.parseJobPath(path)

    // API endpoints
    if (path === '/api/transcriptionJobs' && request.method === 'POST') {
      try {
        if (this.activeJobId) {
          const active = this.jobs.get(this.activeJobId)
          if (
            active && (active.snapshot.status === 'queued' || active.snapshot.status === 'running')
          ) {
            return this.jsonResponse({
              success: false,
              error: 'A transcription job is already running. Please wait for it to complete.',
              activeJobId: this.activeJobId,
            }, 409)
          }
        }

        const requestBody = await request.json() as ActiveTranscriptionRequest
        const validation = await this.validateAndPrepareRequest(requestBody)
        if (!validation.ok) {
          return validation.response
        }

        const jobId = this.generateId()
        const record = this.createJobRecord(jobId)
        this.activeJobId = jobId
        this.updateJobStatus(record, 'running')
        this.publishJobEvent(jobId, {
          jobId,
          stage: 'queued',
          message: 'Job queued. Starting transcription...',
          percent: 0,
          modeRequested: validation.modeRequested,
          modeUsed: validation.modeRequested,
          timestamp: new Date().toISOString(),
        })

        queueMicrotask(async () => {
          try {
            const apiResult = await this.executeTranscription(
              jobId,
              validation.filePath,
              validation.options,
              validation.modeRequested,
              validation.chunkDuration,
            )

            this.completeJob(
              jobId,
              apiResult,
              apiResult.success && apiResult.isComplete ? 'completed' : 'failed',
              apiResult.success && apiResult.isComplete
                ? 'Transcription completed.'
                : (apiResult.error || 'Transcription failed.'),
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failedPayload: TranscriptionApiPayload = {
              success: false,
              error: message,
              modeRequested: validation.modeRequested,
              modeUsed: validation.modeRequested,
              fallbackApplied: false,
              warnings: [],
              mediaKind: 'audio',
              audioExtracted: false,
              isComplete: false,
            }
            this.completeJob(jobId, failedPayload, 'failed', message)
          }
        })

        return this.jsonResponse({ success: true, jobId })
      } catch (error) {
        return this.jsonResponse(
          { success: false, error: error instanceof Error ? error.message : String(error) },
          500,
        )
      }
    }

    if (jobRoute && request.method === 'GET' && jobRoute.events) {
      return this.createSSEStream(jobRoute.jobId)
    }

    if (jobRoute && request.method === 'GET' && !jobRoute.events) {
      const record = this.getJobRecord(jobRoute.jobId)
      if (!record) {
        return this.jsonResponse({ success: false, error: 'Transcription job not found.' }, 404)
      }
      return this.jsonResponse({
        success: true,
        ...record.snapshot,
      })
    }

    if (path === '/api/uploadFile' && request.method === 'POST') {
      try {
        // Get the file data from the request body
        const formData = await request.formData()
        const file = formData.get('file')

        if (!file || !(file instanceof File)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'No file found in form data',
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 400,
            },
          )
        }

        if (!isSupportedUploadFile({ name: file.name, type: file.type })) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Unsupported file type. Upload an audio file or an MP4 video.',
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 400,
            },
          )
        }

        // Generate a unique filename
        const originalName = file.name
        let ext = extname(originalName).toLowerCase()
        if (!ext && file.type.toLowerCase() === 'video/mp4') {
          ext = '.mp4'
        }
        const uniqueFilename = `${this.generateId()}${ext}`
        const filePath = join(this.tempDir, uniqueFilename)

        // Convert the file to an array buffer
        const arrayBuffer = await file.arrayBuffer()

        // Write the file to disk
        await Deno.writeFile(filePath, new Uint8Array(arrayBuffer))

        // Return the file path
        return new Response(
          JSON.stringify({
            success: true,
            filePath,
            originalName,
            mimeType: file.type || '',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
      } catch (error) {
        console.error('Error uploading file:', error)
        return new Response(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
          },
        )
      }
    }

    if (path === '/api/selectOutputFolder') {
      try {
        // Use Deno's native dialog to select a folder
        // Since Deno doesn't have a built-in folder picker, we'll simulate one
        // by creating a temporary script that uses the OS's native dialog

        let selectedFolder = ''

        if (Deno.build.os === 'darwin' || Deno.build.os === 'linux') {
          // For macOS and Linux, use osascript or zenity
          try {
            if (Deno.build.os === 'darwin') {
              // Use a simpler AppleScript on macOS for better performance
              const command = new Deno.Command('osascript', {
                args: [
                  '-e',
                  'POSIX path of (choose folder with prompt "Select Output Folder")',
                ],
              })
              const { stdout } = await command.output()
              selectedFolder = new TextDecoder().decode(stdout).trim()

              // Validate the folder exists
              if (selectedFolder && await exists(selectedFolder)) {
                console.log(`Selected folder: ${selectedFolder}`)
              } else {
                console.error('Selected folder does not exist or was not selected')
                selectedFolder = ''
              }
            } else {
              // Use zenity on Linux
              const command = new Deno.Command('zenity', {
                args: ['--file-selection', '--directory', '--title=Select Output Folder'],
              })
              const { stdout } = await command.output()
              selectedFolder = new TextDecoder().decode(stdout).trim()
            }
          } catch (error) {
            console.error('Error using native dialog:', error)
            // Fall back to the current directory if dialog fails
            selectedFolder = Deno.cwd()
          }
        } else if (Deno.build.os === 'windows') {
          // For Windows, use PowerShell
          try {
            const command = new Deno.Command('powershell', {
              args: [
                '-Command',
                `Add-Type -AssemblyName System.Windows.Forms; $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog; $folderBrowser.Description = 'Select Output Folder'; $folderBrowser.ShowDialog() | Out-Null; $folderBrowser.SelectedPath`,
              ],
            })
            const { stdout } = await command.output()
            selectedFolder = new TextDecoder().decode(stdout).trim()
          } catch (error) {
            console.error('Error using native dialog:', error)
            // Fall back to the current directory if dialog fails
            selectedFolder = Deno.cwd()
          }
        } else {
          // Fall back to current directory for unsupported OS
          selectedFolder = Deno.cwd()
        }

        // If a folder was selected, add it to the list
        if (selectedFolder && await exists(selectedFolder)) {
          if (!this.outputFolders.includes(selectedFolder)) {
            this.outputFolders.unshift(selectedFolder)
          }

          // Return the selected folder
          return new Response(
            JSON.stringify({
              success: true,
              folder: selectedFolder,
              current: selectedFolder,
              folders: this.outputFolders,
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        } else {
          // Return the current directory if no folder was selected
          return new Response(
            JSON.stringify({
              success: false,
              error: 'No folder selected',
              current: Deno.cwd(),
              folders: this.outputFolders,
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      } catch (error) {
        console.error('Error selecting folder:', error)
        return new Response(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            current: Deno.cwd(),
            folders: this.outputFolders,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
    }

    if (path === '/api/setOutputFolder' && request.method === 'POST') {
      try {
        const data = await request.json()
        const { folder } = data

        // Validate folder exists
        if (await exists(folder)) {
          // Add to the list if not already there
          if (!this.outputFolders.includes(folder)) {
            this.outputFolders.unshift(folder)
          }

          // Make sure the app's output directory is updated
          if (this.app) {
            // Update the app's output directory
            await this.app.updateOutputDir(folder)
            console.log(`Updated app output directory to: ${folder}`)
          }

          return new Response(JSON.stringify({ success: true, folder }), {
            headers: { 'Content-Type': 'application/json' },
          })
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Folder does not exist',
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 400,
            },
          )
        }
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: String(error),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
          },
        )
      }
    }

    if (path === '/api/getAvailableLanguages') {
      const languages = [
        'hy', // Armenian (default)
        'ru', // Russian
        'en', // English
      ]
      return new Response(JSON.stringify(languages), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/api/getLanguageName') {
      const params = new URLSearchParams(url.search)
      const code = params.get('code') || 'hy'

      const languageMap: Record<string, string> = {
        'hy': 'Armenian',
        'ru': 'Russian',
        'en': 'English',
      }

      return new Response(JSON.stringify({ name: languageMap[code] || code }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/api/transcribeAudio' && request.method === 'POST') {
      try {
        const requestBody = await request.json() as ActiveTranscriptionRequest
        const validation = await this.validateAndPrepareRequest(requestBody)
        if (!validation.ok) {
          return validation.response
        }

        const result = await this.executeTranscription(
          undefined,
          validation.filePath,
          validation.options,
          validation.modeRequested,
          validation.chunkDuration,
        )
        return this.jsonResponse(result)
      } catch (error) {
        console.error('Error transcribing audio:', error)
        return this.jsonResponse(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            modeRequested: 'whole',
            modeUsed: 'whole',
            fallbackApplied: false,
            warnings: [],
            mediaKind: 'audio',
            audioExtracted: false,
            isComplete: false,
          },
          500,
        )
      }
    }

    if (path === '/api/getDefaultFolder') {
      // Always use Downloads folder as default
      let defaultFolder = Deno.cwd() // Fallback

      try {
        const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
        if (homeDir) {
          const downloadsPath = join(homeDir, 'Downloads')
          if (await exists(downloadsPath)) {
            defaultFolder = downloadsPath

            // Also update the app's output directory
            if (this.app) {
              await this.app.updateOutputDir(downloadsPath)
              console.log(`Set default output directory to Downloads: ${downloadsPath}`)
            }
          }
        }
      } catch (error) {
        console.error('Error getting Downloads folder:', error)
      }

      return new Response(
        JSON.stringify({
          folder: defaultFolder,
          success: true,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Serve static files
    try {
      const uiPath = this.getUIPath()
      let filePath = join(uiPath, path === '/' ? 'index.html' : path)

      // Check if file exists
      if (!(await exists(filePath)) && !filePath.includes('.')) {
        // Try adding .html extension
        filePath += '.html'
        if (!(await exists(filePath))) {
          return new Response('Not Found', { status: 404 })
        }
      }

      // Read file
      const file = await Deno.readFile(filePath)

      // Set content type based on file extension
      const contentType = this.getContentType(filePath)

      return new Response(file, {
        headers: { 'Content-Type': contentType },
      })
    } catch (error) {
      console.error('Error serving file:', error)
      return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() || ''

    const contentTypes: Record<string, string> = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
    }

    return contentTypes[extension] || 'text/plain'
  }

  /**
   * Clean up resources when shutting down
   */
  private async cleanup(): Promise<void> {
    if (this.isShuttingDown) {
      return // Prevent multiple cleanup calls
    }

    this.isShuttingDown = true
    console.log('Cleaning up resources...')

    try {
      // Clean up temp files
      const tempFiles = []
      try {
        for await (const entry of Deno.readDir(this.tempDir)) {
          if (entry.isFile) {
            tempFiles.push(join(this.tempDir, entry.name))
          }
        }
      } catch (error) {
        console.error('Error reading temp directory:', error)
      }

      // Delete temp files
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

  /**
   * Run the UI application
   */
  public async run(): Promise<void> {
    try {
      // Initialize the transcription app
      await this.initializeApp()

      // Start the web server
      const port = 8000
      console.log(`Starting web server on http://localhost:${port}`)

      // Create an abort controller for the server
      const abortController = new AbortController()
      const { signal } = abortController

      // Serve HTTP requests
      this.server = Deno.serve({ port, signal }, (request) => this.handleRequest(request))

      console.log(`Server running. Open http://localhost:${port} in your browser`)

      // Create a promise that resolves when the server is stopped
      return new Promise((resolve) => {
        // Add a signal handler to resolve the promise when the process is terminated
        const handleSignal = async () => {
          console.log('Shutting down server...')
          abortController.abort()
          await this.cleanup()
          resolve()
          // Remove the signal handlers
          Deno.removeSignalListener('SIGINT', handleSignal)
          Deno.removeSignalListener('SIGTERM', handleSignal)
        }

        // Add signal listeners for graceful shutdown
        Deno.addSignalListener('SIGINT', handleSignal)
        Deno.addSignalListener('SIGTERM', handleSignal)

        // Add an unload event listener to handle browser closing
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
      throw error // Re-throw the error to be handled by the caller
    }
  }
}

// Run the UI application if this is the main module
if (import.meta.main) {
  const ui = TranscriberUI.getInstance()
  await ui.run()
}
