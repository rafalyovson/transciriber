import { ensureDir } from '@std/fs/ensure-dir'
import { join } from '@std/path'
import type { Result } from 'types'
import type { CommandRunner } from '../media-preprocessor/index.ts'

export type VideoInfo = {
  title: string
  durationSec: number
}

export type DownloadAudioOptions = {
  url: string
  outputDir: string
}

export type DownloadAudioResult = {
  filePath: string
  title: string
  durationSec: number
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

function createId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

export class YouTubeDownloaderService {
  private readonly runCommand: CommandRunner
  private readonly idGenerator: () => string

  constructor(
    options: {
      runCommand?: CommandRunner
      idGenerator?: () => string
    } = {},
  ) {
    this.runCommand = options.runCommand ?? createCommandRunner()
    this.idGenerator = options.idGenerator ?? createId
  }

  static isYouTubeUrl(input: string): boolean {
    try {
      const url = new URL(input)
      const hostname = url.hostname.replace(/^www\./, '')
      return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be'
    } catch {
      return false
    }
  }

  private decodeOutput(buffer: Uint8Array): string {
    return new TextDecoder().decode(buffer).trim()
  }

  async checkAvailability(): Promise<Result<void, Error>> {
    try {
      const result = await this.runCommand('yt-dlp', ['--version'])

      if (result.code !== 0) {
        return {
          ok: false,
          error: new Error(
            'yt-dlp is installed but returned an error. Please verify your yt-dlp installation.',
          ),
        }
      }

      return { ok: true, data: undefined }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(
          `yt-dlp is not available. Install it with: pip install yt-dlp or brew install yt-dlp. ${message}`,
        ),
      }
    }
  }

  async getVideoInfo(url: string): Promise<Result<VideoInfo, Error>> {
    try {
      const result = await this.runCommand('yt-dlp', [
        '--dump-json',
        '--no-download',
        '--no-playlist',
        url,
      ])

      if (result.code !== 0) {
        const stderr = this.decodeOutput(result.stderr)
        return {
          ok: false,
          error: new Error(`Failed to get video info: ${stderr}`),
        }
      }

      const stdout = this.decodeOutput(result.stdout)
      const info = JSON.parse(stdout)

      return {
        ok: true,
        data: {
          title: info.title || 'Unknown',
          durationSec: typeof info.duration === 'number' ? info.duration : 0,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(`Failed to get video info: ${message}`),
      }
    }
  }

  async downloadAudio(options: DownloadAudioOptions): Promise<Result<DownloadAudioResult, Error>> {
    const { url, outputDir } = options

    try {
      await ensureDir(outputDir)

      // Get video info first (separate call, uses --simulate)
      const infoResult = await this.getVideoInfo(url)
      const title = infoResult.ok ? infoResult.data.title : 'Unknown'
      const durationSec = infoResult.ok ? infoResult.data.durationSec : 0

      const outputTemplate = join(outputDir, `yt_${this.idGenerator()}.%(ext)s`)

      // Download audio — --print after_move:filepath gives us the actual final path
      const result = await this.runCommand('yt-dlp', [
        '-x',
        '--audio-format',
        'wav',
        '--audio-quality',
        '0',
        '--no-playlist',
        '--print',
        'after_move:filepath',
        '-o',
        outputTemplate,
        url,
      ])

      if (result.code !== 0) {
        const stderr = this.decodeOutput(result.stderr)
        return {
          ok: false,
          error: new Error(`Failed to download audio: ${stderr}`),
        }
      }

      // --print after_move:filepath outputs the final file path to stdout
      const stdout = this.decodeOutput(result.stdout)
      const printedPath = stdout.split('\n').pop()?.trim() || ''

      if (printedPath) {
        try {
          await Deno.stat(printedPath)
          return {
            ok: true,
            data: { filePath: printedPath, title, durationSec },
          }
        } catch {
          // Fall through to scan
        }
      }

      // Fallback: scan outputDir for a file matching our unique ID prefix
      const idSegment = outputTemplate.split('/').pop()?.split('.')[0] || ''
      for await (const entry of Deno.readDir(outputDir)) {
        if (idSegment && entry.name.startsWith(idSegment)) {
          return {
            ok: true,
            data: {
              filePath: join(outputDir, entry.name),
              title,
              durationSec,
            },
          }
        }
      }

      return {
        ok: false,
        error: new Error('Download completed but output file was not found.'),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(`Failed to download audio from YouTube: ${message}`),
      }
    }
  }
}
