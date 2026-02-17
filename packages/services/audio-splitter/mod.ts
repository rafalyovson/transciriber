/**
 * Service for splitting audio files into smaller chunks
 */
import { ensureDir } from '@std/fs/ensure-dir'
import { basename, isAbsolute, join } from '@std/path'
import type { AudioChunkSegment, Result } from '@transcriber/core'

/** Configuration for audio splitting */
export type AudioSplitOptions = {
  readonly inputFile: string
  readonly outputDir: string
  readonly segmentDuration: number
  readonly filePrefix?: string
}

/**
 * Service to split audio files into smaller segments
 */
export class AudioSplitterService {
  private parseSegmentList(csvContent: string, outputDir: string): AudioChunkSegment[] {
    const lines = csvContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const segments: AudioChunkSegment[] = []
    for (const [index, line] of lines.entries()) {
      const columns = line.split(',')
      if (columns.length < 3) {
        continue
      }

      const fileColumn = columns[0].trim()
      const startSec = Number.parseFloat(columns[1])
      const endSec = Number.parseFloat(columns[2])

      if (
        !fileColumn || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec
      ) {
        continue
      }

      segments.push({
        path: isAbsolute(fileColumn) ? fileColumn : join(outputDir, basename(fileColumn)),
        index,
        startSec,
        endSec,
        durationSec: endSec - startSec,
      })
    }

    return segments
  }

  /**
   * Splits an audio file into segments of specified duration
   */
  async splitAudio(options: AudioSplitOptions): Promise<Result<AudioChunkSegment[], Error>> {
    const { inputFile, outputDir, segmentDuration, filePrefix = 'chunk' } = options

    try {
      // Verify input file exists
      try {
        const fileInfo = await Deno.stat(inputFile)
        if (!fileInfo.isFile) {
          return {
            ok: false,
            error: new Error(`Input path "${inputFile}" is not a file`),
          }
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return {
            ok: false,
            error: new Error(`Input file "${inputFile}" does not exist`),
          }
        }
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
      }

      // Create output directory if it doesn't exist
      await ensureDir(outputDir)

      // Normalize the input file path
      const normalizedInput = await Deno.realPath(inputFile)
      const segmentListPath = join(outputDir, `${filePrefix}_segments.csv`)
      const outputPattern = join(outputDir, `${filePrefix}_%05d.wav`)

      // Execute FFmpeg command using Deno.Command API
      const command = new Deno.Command('ffmpeg', {
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          normalizedInput,
          '-map',
          '0:a:0',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          '-f',
          'segment',
          '-segment_time',
          segmentDuration.toString(),
          '-reset_timestamps',
          '1',
          '-segment_list',
          segmentListPath,
          '-segment_list_type',
          'csv',
          outputPattern,
        ],
        stdout: 'piped',
        stderr: 'piped',
      })

      // Run the command and wait for it to complete
      const { code, stderr } = await command.output()

      if (code !== 0) {
        const errorOutput = new TextDecoder().decode(stderr)
        return {
          ok: false,
          error: new Error(`FFmpeg process failed with code ${code}: ${errorOutput}`),
        }
      }

      const segmentListContent = await Deno.readTextFile(segmentListPath)
      const segments = this.parseSegmentList(segmentListContent, outputDir)
      if (segments.length === 0) {
        return {
          ok: false,
          error: new Error('FFmpeg produced no audio segments.'),
        }
      }

      return { ok: true, data: segments }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }
}
