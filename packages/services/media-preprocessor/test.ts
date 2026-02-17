import { assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import type { CommandRunner } from '@transcriber/core'
import { MediaPreprocessorService } from './mod.ts'

type MockResponse = {
  command: string
  code: number
  stdout?: string
  stderr?: string
}

function createMockRunner(responses: MockResponse[]): {
  runCommand: CommandRunner
  calls: Array<{ command: string; args: string[] }>
} {
  const encoder = new TextEncoder()
  let cursor = 0
  const calls: Array<{ command: string; args: string[] }> = []

  const runCommand: CommandRunner = (command, args) => {
    calls.push({ command, args })

    const response = responses[cursor]
    cursor += 1

    if (!response) {
      throw new Error(`Unexpected command call: ${command}`)
    }
    if (response.command !== command) {
      throw new Error(
        `Expected command ${response.command} but got ${command}`,
      )
    }

    return Promise.resolve({
      code: response.code,
      stdout: encoder.encode(response.stdout || ''),
      stderr: encoder.encode(response.stderr || ''),
    })
  }

  return { runCommand, calls }
}

Deno.test(
  'MediaPreprocessorService bypasses extraction for audio input',
  async () => {
    const { runCommand, calls } = createMockRunner([])
    const service = new MediaPreprocessorService({ runCommand })

    const result = await service.prepareInputForTranscription({
      inputPath: '/tmp/audio.mp3',
      tempDir: '/tmp',
      mimeTypeHint: 'audio/mpeg',
    })

    assertEquals(result.ok, true)
    if (!result.ok) {
      return
    }

    assertEquals(result.data.preparedFilePath, '/tmp/audio.mp3')
    assertEquals(result.data.mediaKind, 'audio')
    assertEquals(result.data.audioExtracted, false)
    assertEquals(result.data.cleanupPaths.length, 0)
    assertEquals(calls.length, 0)
  },
)

Deno.test('MediaPreprocessorService extracts MP4 audio to wav', async () => {
  const { runCommand, calls } = createMockRunner([
    {
      command: 'ffprobe',
      code: 0,
      stdout: '[STREAM]\ncodec_type=audio\n[/STREAM]\n',
    },
    {
      command: 'ffmpeg',
      code: 0,
    },
  ])
  const service = new MediaPreprocessorService({
    runCommand,
    idGenerator: () => 'abc123',
  })

  const tempDir = join(Deno.cwd(), 'temp')
  const result = await service.prepareInputForTranscription({
    inputPath: '/tmp/video.mp4',
    tempDir,
    mimeTypeHint: 'video/mp4',
  })

  assertEquals(result.ok, true)
  if (!result.ok) {
    return
  }

  assertEquals(result.data.mediaKind, 'video')
  assertEquals(result.data.audioExtracted, true)
  assertStringIncludes(result.data.preparedFilePath, 'extracted_abc123.wav')
  assertEquals(result.data.cleanupPaths[0], result.data.preparedFilePath)
  assertEquals(result.data.warnings.length, 1)
  assertEquals(calls.length, 2)
  assertEquals(calls[0].command, 'ffprobe')
  assertEquals(calls[1].command, 'ffmpeg')
})

Deno.test('MediaPreprocessorService extracts audio to MP3', async () => {
  const { runCommand, calls } = createMockRunner([
    {
      command: 'ffmpeg',
      code: 0,
    },
  ])
  const service = new MediaPreprocessorService({ runCommand })

  const result = await service.extractAudioToMp3(
    '/tmp/video.mp4',
    '/output/video.mp3',
  )

  assertEquals(result.ok, true)
  if (!result.ok) return

  assertEquals(result.data.outputPath, '/output/video.mp3')
  assertEquals(calls.length, 1)
  assertEquals(calls[0].command, 'ffmpeg')
  const args = calls[0].args
  assertEquals(args.includes('libmp3lame'), true)
  assertEquals(args.includes('-q:a'), true)
})

Deno.test(
  'MediaPreprocessorService handles MP3 extraction failure',
  async () => {
    const { runCommand } = createMockRunner([
      {
        command: 'ffmpeg',
        code: 1,
        stderr: 'No audio stream found',
      },
    ])
    const service = new MediaPreprocessorService({ runCommand })

    const result = await service.extractAudioToMp3(
      '/tmp/silent.mp4',
      '/output/silent.mp3',
    )

    assertEquals(result.ok, false)
    if (result.ok) return
    assertStringIncludes(
      result.error.message,
      'Failed to extract audio as MP3',
    )
  },
)

Deno.test(
  'MediaPreprocessorService handles missing FFmpeg for MP3 extraction',
  async () => {
    const runCommand: CommandRunner = () => {
      throw new Error('Command not found: ffmpeg')
    }
    const service = new MediaPreprocessorService({ runCommand })

    const result = await service.extractAudioToMp3(
      '/tmp/video.mp4',
      '/output/video.mp3',
    )

    assertEquals(result.ok, false)
    if (result.ok) return
    assertStringIncludes(
      result.error.message,
      'Unable to run FFmpeg for MP3 extraction',
    )
  },
)

Deno.test(
  'MediaPreprocessorService fails for MP4 without audio stream',
  async () => {
    const { runCommand, calls } = createMockRunner([
      {
        command: 'ffprobe',
        code: 0,
        stdout: '',
      },
    ])
    const service = new MediaPreprocessorService({ runCommand })

    const result = await service.prepareInputForTranscription({
      inputPath: '/tmp/silent-video.mp4',
      tempDir: '/tmp',
    })

    assertEquals(result.ok, false)
    if (result.ok) {
      return
    }

    assertStringIncludes(
      result.error.message,
      'does not contain an audio stream',
    )
    assertEquals(calls.length, 1)
    assertEquals(calls[0].command, 'ffprobe')
  },
)
