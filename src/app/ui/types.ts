import type {
  TranscriptionJobSnapshot,
  TranscriptionJobStatus,
  TranscriptionMode,
  TranscriptionProgressEvent,
} from '../../types/index.ts'
import type { TranscriptionApp } from '../index.ts'

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.flac',
  '.aac',
  '.webm',
])
export const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4'])

export const JOB_TTL_MS = 20 * 60 * 1000
export const SSE_HEARTBEAT_MS = 15_000

export type UploadFileDescriptor = {
  name: string
  type?: string | null
}

export type TranscriptionApiPayload = {
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

export type ActiveTranscriptionRequest = {
  filePath: string
  options: Record<string, unknown>
}

export type TranscriptionJobRecord = {
  snapshot: TranscriptionJobSnapshot
  subscribers: Set<(event: TranscriptionProgressEvent) => void>
  cleanupTimer?: number
}

export type RouterContext = {
  app: TranscriptionApp
  tempDir: string
  outputFolders: string[]
  activeJobId: string | null
  jobs: Map<string, TranscriptionJobRecord>
  jsonResponse: (body: unknown, status?: number) => Response
  generateId: () => string
  initializeApp: () => Promise<boolean>
  validateAndPrepareRequest: (
    requestBody: ActiveTranscriptionRequest,
  ) => Promise<
    | {
      ok: true
      filePath: string
      options: Record<string, unknown>
      modeRequested: TranscriptionMode
      chunkDuration: number
    }
    | { ok: false; response: Response }
  >
  executeTranscription: (
    jobId: string | undefined,
    filePath: string,
    options: Record<string, unknown>,
    modeRequested: TranscriptionMode,
    chunkDuration: number,
  ) => Promise<TranscriptionApiPayload>
  createJobRecord: (jobId: string) => TranscriptionJobRecord
  updateJobStatus: (
    record: TranscriptionJobRecord,
    status: TranscriptionJobStatus,
  ) => void
  publishJobEvent: (jobId: string, event: TranscriptionProgressEvent) => void
  completeJob: (
    jobId: string,
    result: TranscriptionApiPayload,
    status: TranscriptionJobStatus,
    terminalMessage: string,
  ) => void
  setActiveJobId: (id: string | null) => void
}
