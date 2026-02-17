import { join } from '@std/path'
import { TranscriptionApp } from '../index.ts'
import { TranscriptionMode } from '../../types/index.ts'
import { getChunkDuration, getLanguageCode } from '../../utils/env.ts'
import { YouTubeDownloaderService } from '../../services/youtube-downloader/index.ts'

type ParsedCLIArgs = {
  filePath: string
  mode: TranscriptionMode
  modeExplicit: boolean
  chunkDuration: number
}

const WHOLE_MODE: TranscriptionMode = 'whole'
const PARTS_MODE: TranscriptionMode = 'parts'

/**
 * Parse CLI arguments for file path and transcription mode options.
 */
export function parseCLIArgs(args: string[], defaultChunkDuration: number): ParsedCLIArgs {
  let filePath = ''
  let mode: TranscriptionMode = WHOLE_MODE
  let modeExplicit = false
  let chunkDuration = defaultChunkDuration

  for (const arg of args) {
    if (!arg.startsWith('--') && !filePath) {
      filePath = arg
      continue
    }

    if (arg.startsWith('--mode=')) {
      const rawMode = arg.split('=')[1]?.trim().toLowerCase()
      if (rawMode === WHOLE_MODE || rawMode === PARTS_MODE) {
        mode = rawMode
        modeExplicit = true
      } else {
        throw new Error(`Invalid mode "${rawMode}". Use --mode=whole or --mode=parts.`)
      }
      continue
    }

    if (arg.startsWith('--chunk-duration=')) {
      const rawDuration = parseInt(arg.split('=')[1] || '', 10)
      if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
        throw new Error('Invalid chunk duration. Use a positive integer, e.g. --chunk-duration=30.')
      }
      chunkDuration = rawDuration
    }
  }

  if (!filePath) {
    throw new Error('No input file specified.')
  }

  return {
    filePath,
    mode,
    modeExplicit,
    chunkDuration,
  }
}

/**
 * Run the CLI application
 */
export async function runCLI(): Promise<void> {
  let downloadedFilePath: string | null = null

  try {
    const defaultChunkDuration = getChunkDuration()
    const languageCode = getLanguageCode()
    const { filePath: rawInput, mode: parsedMode, modeExplicit, chunkDuration } = parseCLIArgs(
      Deno.args,
      defaultChunkDuration,
    )

    let filePath = rawInput
    let mode = parsedMode
    let youtubeTitle: string | undefined

    if (YouTubeDownloaderService.isYouTubeUrl(rawInput)) {
      const ytService = new YouTubeDownloaderService()

      console.log('Detected YouTube URL. Checking yt-dlp availability...')
      const availCheck = await ytService.checkAvailability()
      if (!availCheck.ok) {
        console.error('Error:', availCheck.error.message)
        Deno.exit(1)
      }

      console.log('Downloading audio from YouTube...')
      const tempDir = join(Deno.cwd(), 'temp')
      const downloadResult = await ytService.downloadAudio({ url: rawInput, outputDir: tempDir })
      if (!downloadResult.ok) {
        console.error('Error:', downloadResult.error.message)
        Deno.exit(1)
      }

      filePath = downloadResult.data.filePath
      downloadedFilePath = filePath
      youtubeTitle = downloadResult.data.title
      console.log(`Downloaded: "${youtubeTitle}" (${downloadResult.data.durationSec}s)`)

      if (!modeExplicit) {
        mode = 'parts'
        console.log('YouTube input: using parts mode for full coverage.')
      }
    }

    const app = new TranscriptionApp({
      languageCode,
      modelId: 'scribe_v2',
    }, chunkDuration)

    await app.initialize()

    const outputDir = Deno.env.get('OUTPUT_DIR') || undefined

    const displayName = youtubeTitle ? `"${youtubeTitle}"` : filePath
    console.log(
      `Transcribing ${displayName} in ${mode} mode (chunk duration: ${chunkDuration}s, language: ${languageCode})`,
    )
    console.log('Processing file...')

    const result = await app.run(filePath, outputDir, {
      mode,
      chunkDuration,
      onProgress: (event) => {
        const percentValue = Number.isFinite(event.percent) ? Number(event.percent) : null
        const percent = percentValue === null ? '' : ` ${Math.floor(percentValue)}%`
        const chunk = event.chunkIndex && event.chunkTotal
          ? ` [${event.chunkIndex}/${event.chunkTotal}]`
          : ''
        const partial = event.partialText
          ? ` "${event.partialText.replace(/\s+/g, ' ').trim().slice(0, 80)}${
            event.partialText.length > 80 ? '…' : ''
          }"`
          : ''
        console.log(`[${event.stage}]${percent}${chunk} ${event.message}${partial}`)
      },
    })

    if (result.success) {
      if (!result.isComplete) {
        console.error('Transcription finished but did not satisfy completeness checks.')
        if (typeof result.coverageRatio === 'number') {
          console.error(`Coverage ratio: ${(result.coverageRatio * 100).toFixed(2)}%`)
        }
        Deno.exit(1)
      }

      console.log('Transcription completed successfully!')
      if (result.fallbackApplied) {
        console.log('Automatic fallback was applied: whole -> parts mode.')
      }
      if (typeof result.totalChunks === 'number') {
        console.log(
          `Chunk coverage: ${result.successfulChunks || 0}/${result.totalChunks} successful, ${
            result.failedChunks || 0
          } failed.`,
        )
      }
      if (
        typeof result.sourceDurationSec === 'number' &&
        typeof result.transcribedDurationSec === 'number'
      ) {
        console.log(
          `Duration coverage: ${result.transcribedDurationSec.toFixed(2)}s / ${
            result.sourceDurationSec.toFixed(2)
          }s`,
        )
      }
      if (typeof result.coverageRatio === 'number') {
        console.log(`Coverage ratio: ${(result.coverageRatio * 100).toFixed(2)}%`)
      }
      if (result.subtitleGenerated) {
        console.log(
          `Subtitles: ${result.subtitleCueCount || 0} cues, quality=${
            result.subtitleQuality?.status || 'unknown'
          }`,
        )
        if (result.subtitleTrackLanguageTag) {
          console.log(`Subtitle track language tag: ${result.subtitleTrackLanguageTag}`)
        }
        if (result.subtitlePaths?.srt) {
          console.log(`Saved SRT: ${result.subtitlePaths.srt}`)
        }
        if (result.subtitlePaths?.vtt) {
          console.log(`Saved VTT: ${result.subtitlePaths.vtt}`)
        }
      } else if (result.mediaKind === 'video') {
        console.log('No subtitle sidecars were generated for this video run.')
      }
      const subtitleViolationCount = result.subtitleViolationCount ??
        result.subtitleQuality?.violations.length ??
        0
      if (subtitleViolationCount > 0) {
        const preview = result.subtitleQuality?.violations.slice(0, 3).join(' ')
        const remainder = subtitleViolationCount - Math.min(subtitleViolationCount, 3)
        const tail = remainder > 0 ? ` (+${remainder} more)` : ''
        console.log(`Subtitle quality notes: ${preview || 'See quality report.'}${tail}`)
      }
      if (result.subtitleQualityReportPath) {
        console.log(`Subtitle quality report: ${result.subtitleQualityReportPath}`)
      }
      if (result.outputPath) {
        console.log(`Saved markdown: ${result.outputPath}`)
      }
      console.log('\nTranscription result:')
      console.log('---------------------')
      console.log(result.data)
    } else {
      console.error('Transcription failed:', result.error)
      Deno.exit(1)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.error('Error:', errorMessage)
    console.log('Usage: deno run -A main.ts [options] <file-path-or-youtube-url>')
    console.log('Options:')
    console.log('  --ui                         Run with graphical user interface')
    console.log('  --mode=whole|parts           Transcription mode (default: whole)')
    console.log(
      '  --chunk-duration=<seconds>   Chunk duration for parts mode (default: CHUNK_DURATION or 30)',
    )

    Deno.exit(1)
  } finally {
    if (downloadedFilePath) {
      try {
        await Deno.remove(downloadedFilePath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
