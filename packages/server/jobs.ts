import type {
  TranscriptionJobSnapshot,
  TranscriptionJobStatus,
  TranscriptionProgressEvent,
} from '@transcriber/core'
import type { TranscriptionOutput } from '@transcriber/core'

const JOB_TTL_MS = 20 * 60 * 1000

type JobRecord = {
  snapshot: TranscriptionJobSnapshot
  subscribers: Set<(event: TranscriptionProgressEvent) => void>
  cleanupTimer?: number
}

export class JobManager {
  private jobs = new Map<string, JobRecord>()

  create(jobId: string): JobRecord {
    const record: JobRecord = {
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

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)
  }

  updateStatus(jobId: string, status: TranscriptionJobStatus): void {
    const record = this.jobs.get(jobId)
    if (record) {
      record.snapshot.status = status
    }
  }

  publish(jobId: string, event: TranscriptionProgressEvent): void {
    const record = this.jobs.get(jobId)
    if (!record) return
    record.snapshot.progress = event
    for (const handler of record.subscribers) {
      try {
        handler(event)
      } catch {
        // subscriber error should not break others
      }
    }
  }

  subscribe(
    jobId: string,
    handler: (event: TranscriptionProgressEvent) => void,
  ): () => void {
    const record = this.jobs.get(jobId)
    if (!record) return () => {}
    record.subscribers.add(handler)
    return () => {
      record.subscribers.delete(handler)
    }
  }

  complete(
    jobId: string,
    result: TranscriptionOutput,
    status: TranscriptionJobStatus,
    terminalMessage: string,
  ): void {
    const record = this.jobs.get(jobId)
    if (!record) return

    record.snapshot.status = status
    record.snapshot.result = result.data
    record.snapshot.outputPath = result.outputPath
    record.snapshot.error = result.error
    record.snapshot.modeRequested = result.modeRequested
    record.snapshot.modeUsed = result.modeUsed
    record.snapshot.fallbackApplied = result.fallbackApplied
    record.snapshot.warnings = result.warnings
    record.snapshot.mediaKind = result.mediaKind
    record.snapshot.audioExtracted = result.audioExtracted
    record.snapshot.isComplete = result.isComplete
    record.snapshot.totalChunks = result.totalChunks
    record.snapshot.successfulChunks = result.successfulChunks
    record.snapshot.failedChunks = result.failedChunks
    record.snapshot.sourceDurationSec = result.sourceDurationSec
    record.snapshot.transcribedDurationSec = result.transcribedDurationSec
    record.snapshot.coverageRatio = result.coverageRatio
    record.snapshot.subtitleGenerated = result.subtitleGenerated
    record.snapshot.subtitleFormats = result.subtitleFormats
    record.snapshot.subtitlePaths = result.subtitlePaths
    record.snapshot.subtitleCueCount = result.subtitleCueCount
    record.snapshot.subtitleQuality = result.subtitleQuality
    record.snapshot.subtitleViolationCount = result.subtitleViolationCount
    record.snapshot.subtitleQualityReportPath = result.subtitleQualityReportPath
    record.snapshot.subtitleContents = result.subtitleContents
    record.snapshot.subtitleTrackLanguageTag = result.subtitleTrackLanguageTag

    // Emit terminal event
    const terminalEvent: TranscriptionProgressEvent = {
      jobId,
      stage: status === 'completed' ? 'completed' : 'failed',
      message: terminalMessage,
      percent: 100,
      modeRequested: result.modeRequested,
      modeUsed: result.modeUsed,
      timestamp: new Date().toISOString(),
    }
    this.publish(jobId, terminalEvent)

    // Schedule cleanup
    record.cleanupTimer = setTimeout(() => {
      this.jobs.delete(jobId)
    }, JOB_TTL_MS)
  }

  cleanup(): void {
    for (const [id, record] of this.jobs) {
      if (record.cleanupTimer) {
        clearTimeout(record.cleanupTimer)
      }
      this.jobs.delete(id)
    }
  }
}
