import type { AudioChunkSegment, TranscriptionConfig, TranscriptionResult } from '../types.ts'
import type { Result } from '../result.ts'
import type { EventBus, PipelineEvents } from '../events.ts'
import { AudioSplitterService } from '@transcriber/audio-splitter'
import { TranscriptionService } from '@transcriber/transcription'
import { FileService } from '@transcriber/file-service'

const CHUNK_RETRY_MAX_ATTEMPTS = 3
const CHUNK_RETRY_BASE_DELAY_MS = 500

export type TranscribePartsInput = {
  filePath: string
  chunkDuration: number
  config: Partial<TranscriptionConfig>
  jobId?: string
}

export type ChunkDetail = {
  segment: AudioChunkSegment
  transcription: TranscriptionResult
}

export type TranscribePartsOutput = {
  text: string
  chunks: ChunkDetail[]
  totalChunks: number
  successfulChunks: number
  failedChunks: number
  transcribedDurationSec: number
  totalPlannedDurationSec: number
}

async function waitForRetry(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function transcribeChunkWithRetry(
  service: TranscriptionService,
  fileService: FileService,
  segment: AudioChunkSegment,
  totalChunks: number,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Promise<Result<TranscriptionResult, Error>> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= CHUNK_RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      bus.emit('progress', {
        stage: 'transcribing_chunk',
        message: `Retrying chunk ${
          segment.index + 1
        }/${totalChunks} (attempt ${attempt}/${CHUNK_RETRY_MAX_ATTEMPTS})...`,
        chunkIndex: segment.index + 1,
        chunkTotal: totalChunks,
        jobId,
        timestamp: new Date().toISOString(),
      })
    }

    const audioResult = await fileService.readAudioFileFromPath(segment.path)
    if (!audioResult.ok) {
      lastError = new Error(
        `Failed to read chunk ${segment.index + 1}/${totalChunks}: ${audioResult.error.message}`,
      )
    } else {
      const result = await service.transcribe(audioResult.data)
      if (result.ok) return result

      lastError = new Error(
        `Chunk ${
          segment.index + 1
        }/${totalChunks} failed on attempt ${attempt}: ${result.error.message}`,
      )
    }

    if (attempt < CHUNK_RETRY_MAX_ATTEMPTS) {
      const delay = CHUNK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      await waitForRetry(delay)
    }
  }

  return {
    ok: false,
    error: lastError || new Error(`Chunk ${segment.index + 1} failed`),
  }
}

export async function transcribeParts(
  input: TranscribePartsInput,
  bus: EventBus<PipelineEvents>,
): Promise<Result<TranscribePartsOutput, Error>> {
  const fileService = new FileService()
  const splitter = new AudioSplitterService()
  const service = new TranscriptionService(input.config)
  const tempDir = fileService.getTempDir()

  try {
    bus.emit('progress', {
      stage: 'splitting',
      message: `Splitting media into ${input.chunkDuration}-second chunks...`,
      percent: 20,
      jobId: input.jobId,
      timestamp: new Date().toISOString(),
    })

    const splitResult = await splitter.splitAudio({
      inputFile: input.filePath,
      outputDir: tempDir,
      segmentDuration: input.chunkDuration,
      filePrefix: `chunk_${input.filePath.split('/').pop()?.split('.')[0]}`,
    })

    if (!splitResult.ok) {
      return {
        ok: false,
        error: new Error(`Failed to split audio: ${splitResult.error.message}`),
      }
    }

    const segments = splitResult.data
    const totalChunks = segments.length

    bus.emit('progress', {
      stage: 'splitting',
      message: `Created ${totalChunks} chunk${totalChunks === 1 ? '' : 's'}.`,
      percent: 30,
      jobId: input.jobId,
      timestamp: new Date().toISOString(),
    })

    const chunkDetails: ChunkDetail[] = []
    let transcribedDurationSec = 0

    for (const segment of segments) {
      const startPercent = 30 + Math.floor((segment.index / totalChunks) * 50)
      bus.emit('progress', {
        stage: 'transcribing_chunk',
        message: `Transcribing chunk ${segment.index + 1}/${totalChunks}...`,
        percent: startPercent,
        chunkIndex: segment.index + 1,
        chunkTotal: totalChunks,
        jobId: input.jobId,
        timestamp: new Date().toISOString(),
      })

      const chunkResult = await transcribeChunkWithRetry(
        service,
        fileService,
        segment,
        totalChunks,
        bus,
        input.jobId,
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

      chunkDetails.push({ segment, transcription: chunkResult.data })
      transcribedDurationSec += segment.durationSec

      const endPercent = 30 + Math.floor(((segment.index + 1) / totalChunks) * 50)
      bus.emit('progress', {
        stage: 'transcribing_chunk',
        message: `Completed chunk ${segment.index + 1}/${totalChunks}.`,
        percent: endPercent,
        chunkIndex: segment.index + 1,
        chunkTotal: totalChunks,
        partialText: chunkResult.data.text,
        jobId: input.jobId,
        timestamp: new Date().toISOString(),
      })
    }

    const totalPlannedDurationSec = segments.reduce(
      (sum, s) => sum + s.durationSec,
      0,
    )
    const combinedText = fileService.combineChunkTranscriptions(
      chunkDetails.map((c) => c.transcription.text),
    )

    return {
      ok: true,
      data: {
        text: combinedText,
        chunks: chunkDetails,
        totalChunks,
        successfulChunks: totalChunks,
        failedChunks: 0,
        transcribedDurationSec,
        totalPlannedDurationSec,
      },
    }
  } finally {
    await fileService.cleanupTempFiles()
  }
}
