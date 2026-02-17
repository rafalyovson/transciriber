import { extname } from '@std/path'
import type { CommandRunner, InputMediaKind, MediaInspection } from '@transcriber/core'
import type { Result } from '@transcriber/core'

export const ELEVENLABS_MAX_REQUEST_BYTES = 3 * 1024 * 1024 * 1024
export const ELEVENLABS_MAX_REQUEST_DURATION_SEC = 10 * 60 * 60

export type InspectMediaOptions = {
  filePath: string
  mimeTypeHint?: string
}

type FFprobeStream = {
  codec_type?: string
  duration?: string
}

type FFprobeFormat = {
  duration?: string
}

type FFprobeResult = {
  streams?: FFprobeStream[]
  format?: FFprobeFormat
}

function createCommandRunner(): CommandRunner {
  return async (command, args) => {
    const process = new Deno.Command(command, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    })
    return await process.output()
  }
}

function parseDuration(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function exceedsElevenLabsHardLimits(inspection: MediaInspection): boolean {
  return inspection.sizeBytes > ELEVENLABS_MAX_REQUEST_BYTES ||
    inspection.durationSec > ELEVENLABS_MAX_REQUEST_DURATION_SEC
}

export class MediaInspectorService {
  private readonly runCommand: CommandRunner

  constructor(options: { runCommand?: CommandRunner } = {}) {
    this.runCommand = options.runCommand ?? createCommandRunner()
  }

  private inferMediaKind(filePath: string, mimeTypeHint?: string): InputMediaKind {
    const hint = (mimeTypeHint || '').trim().toLowerCase()
    if (hint === 'video/mp4') return 'video'
    return extname(filePath).toLowerCase() === '.mp4' ? 'video' : 'audio'
  }

  private async probeMedia(filePath: string): Promise<Result<FFprobeResult, Error>> {
    try {
      const result = await this.runCommand('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ])

      if (result.code !== 0) {
        const stderr = new TextDecoder().decode(result.stderr).trim()
        return {
          ok: false,
          error: new Error(
            `Failed to inspect media with ffprobe. Ensure ffprobe is installed and on PATH. ${stderr}`,
          ),
        }
      }

      const raw = new TextDecoder().decode(result.stdout)
      const parsed = JSON.parse(raw) as FFprobeResult
      return { ok: true, data: parsed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(
          `Unable to run ffprobe. Ensure FFmpeg/ffprobe is installed and on PATH. ${message}`,
        ),
      }
    }
  }

  async inspectMedia(options: InspectMediaOptions): Promise<Result<MediaInspection, Error>> {
    const { filePath, mimeTypeHint } = options
    const mediaKind = this.inferMediaKind(filePath, mimeTypeHint)

    try {
      const stat = await Deno.stat(filePath)
      if (!stat.isFile) {
        return { ok: false, error: new Error(`Input path "${filePath}" is not a file`) }
      }

      const probeResult = await this.probeMedia(filePath)
      if (!probeResult.ok) {
        return probeResult
      }

      const { streams = [], format } = probeResult.data
      const hasAudio = streams.some((stream) => stream.codec_type === 'audio')

      const formatDuration = parseDuration(format?.duration)
      const streamDurations = streams.map((stream) => parseDuration(stream.duration))
      const longestStreamDuration = streamDurations.reduce((max, value) => Math.max(max, value), 0)
      const durationSec = formatDuration > 0 ? formatDuration : longestStreamDuration

      return {
        ok: true,
        data: {
          filePath,
          mediaKind,
          sizeBytes: stat.size,
          durationSec,
          hasAudio,
        },
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return {
          ok: false,
          error: new Error(`Input file "${filePath}" does not exist`),
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }
}
