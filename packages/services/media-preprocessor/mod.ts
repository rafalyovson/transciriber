import { ensureDir } from '@std/fs/ensure-dir'
import { extname, join } from '@std/path'
import type { CommandRunner, InputMediaKind, Result } from '@transcriber/core'

export type MediaPreparationOptions = {
  inputPath: string
  tempDir: string
  mimeTypeHint?: string
}

export type MediaPreparationResult = {
  preparedFilePath: string
  mediaKind: InputMediaKind
  audioExtracted: boolean
  warnings: string[]
  cleanupPaths: string[]
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

export class MediaPreprocessorService {
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

  private isMp4Input(inputPath: string, mimeTypeHint?: string): boolean {
    const extension = extname(inputPath).toLowerCase()
    if (extension === '.mp4') {
      return true
    }

    return (mimeTypeHint || '').trim().toLowerCase() === 'video/mp4'
  }

  private decodeOutput(buffer: Uint8Array): string {
    return new TextDecoder().decode(buffer).trim()
  }

  private async probeHasAudioStream(inputPath: string): Promise<Result<boolean, Error>> {
    try {
      const probeResult = await this.runCommand('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-select_streams',
        'a',
        inputPath,
      ])

      if (probeResult.code !== 0) {
        const stderr = this.decodeOutput(probeResult.stderr)
        return {
          ok: false,
          error: new Error(
            `Failed to inspect video streams with ffprobe. Ensure ffprobe is installed and on PATH. ${stderr}`,
          ),
        }
      }

      const stdout = this.decodeOutput(probeResult.stdout)
      return { ok: true, data: stdout.length > 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(
          `Unable to run ffprobe. Ensure FFmpeg/ffprobe is installed and available on PATH. ${message}`,
        ),
      }
    }
  }

  private async extractAudioToWav(
    inputPath: string,
    outputPath: string,
  ): Promise<Result<void, Error>> {
    try {
      const extractResult = await this.runCommand('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-map',
        '0:a:0?',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        outputPath,
      ])

      if (extractResult.code !== 0) {
        const stderr = this.decodeOutput(extractResult.stderr)
        return {
          ok: false,
          error: new Error(
            `Failed to extract audio from MP4. ${
              stderr || 'FFmpeg exited with a non-zero status.'
            }`,
          ),
        }
      }

      return { ok: true, data: undefined }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: new Error(
          `Unable to run FFmpeg for audio extraction. Ensure FFmpeg is installed and available on PATH. ${message}`,
        ),
      }
    }
  }

  async prepareInputForTranscription(
    options: MediaPreparationOptions,
  ): Promise<Result<MediaPreparationResult, Error>> {
    const { inputPath, tempDir, mimeTypeHint } = options

    if (!this.isMp4Input(inputPath, mimeTypeHint)) {
      return {
        ok: true,
        data: {
          preparedFilePath: inputPath,
          mediaKind: 'audio',
          audioExtracted: false,
          warnings: [],
          cleanupPaths: [],
        },
      }
    }

    await ensureDir(tempDir)

    const hasAudioResult = await this.probeHasAudioStream(inputPath)
    if (!hasAudioResult.ok) {
      return hasAudioResult
    }

    if (!hasAudioResult.data) {
      return {
        ok: false,
        error: new Error(
          'Uploaded MP4 does not contain an audio stream. Please upload a video with audio or an audio file.',
        ),
      }
    }

    const extractedAudioPath = join(tempDir, `extracted_${this.idGenerator()}.wav`)
    const extractionResult = await this.extractAudioToWav(inputPath, extractedAudioPath)
    if (!extractionResult.ok) {
      return extractionResult
    }

    return {
      ok: true,
      data: {
        preparedFilePath: extractedAudioPath,
        mediaKind: 'video',
        audioExtracted: true,
        warnings: ['Audio extracted from MP4 before transcription.'],
        cleanupPaths: [extractedAudioPath],
      },
    }
  }
}
