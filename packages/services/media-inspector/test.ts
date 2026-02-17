import { assertEquals } from '@std/assert'
import type { CommandRunner } from '@transcriber/core'
import { exceedsElevenLabsHardLimits, MediaInspectorService } from './mod.ts'
import { ELEVENLABS_MAX_REQUEST_BYTES, ELEVENLABS_MAX_REQUEST_DURATION_SEC } from './mod.ts'
import { join } from '@std/path'

function createMockRunner(stdout: string): CommandRunner {
  const encoder = new TextEncoder()
  return () =>
    Promise.resolve({
      code: 0,
      stdout: encoder.encode(stdout),
      stderr: encoder.encode(''),
    })
}

Deno.test('MediaInspectorService reads duration and audio stream presence', async () => {
  const filePath = join(Deno.cwd(), 'test-media-inspector-audio.wav')
  await Deno.writeFile(filePath, new Uint8Array([1, 2, 3]))

  const service = new MediaInspectorService({
    runCommand: createMockRunner(
      JSON.stringify({
        format: { duration: '125.5' },
        streams: [
          { codec_type: 'audio', duration: '125.5' },
        ],
      }),
    ),
  })

  try {
    const result = await service.inspectMedia({ filePath })
    assertEquals(result.ok, true)
    if (!result.ok) return

    assertEquals(result.data.mediaKind, 'audio')
    assertEquals(result.data.hasAudio, true)
    assertEquals(result.data.durationSec, 125.5)
    assertEquals(result.data.sizeBytes > 0, true)
  } finally {
    await Deno.remove(filePath)
  }
})

Deno.test('MediaInspectorService detects missing audio stream', async () => {
  const filePath = join(Deno.cwd(), 'test-media-inspector-video.mp4')
  await Deno.writeFile(filePath, new Uint8Array([1, 2, 3]))

  const service = new MediaInspectorService({
    runCommand: createMockRunner(
      JSON.stringify({
        format: { duration: '300' },
        streams: [
          { codec_type: 'video', duration: '300' },
        ],
      }),
    ),
  })

  try {
    const result = await service.inspectMedia({ filePath, mimeTypeHint: 'video/mp4' })
    assertEquals(result.ok, true)
    if (!result.ok) return

    assertEquals(result.data.mediaKind, 'video')
    assertEquals(result.data.hasAudio, false)
    assertEquals(result.data.durationSec, 300)
  } finally {
    await Deno.remove(filePath)
  }
})

Deno.test('exceedsElevenLabsHardLimits returns true for oversized media', () => {
  assertEquals(
    exceedsElevenLabsHardLimits({
      filePath: '/tmp/a.wav',
      mediaKind: 'audio',
      sizeBytes: ELEVENLABS_MAX_REQUEST_BYTES + 1,
      durationSec: 100,
      hasAudio: true,
    }),
    true,
  )

  assertEquals(
    exceedsElevenLabsHardLimits({
      filePath: '/tmp/b.wav',
      mediaKind: 'audio',
      sizeBytes: 100,
      durationSec: ELEVENLABS_MAX_REQUEST_DURATION_SEC + 1,
      hasAudio: true,
    }),
    true,
  )

  assertEquals(
    exceedsElevenLabsHardLimits({
      filePath: '/tmp/c.wav',
      mediaKind: 'audio',
      sizeBytes: 100,
      durationSec: 100,
      hasAudio: true,
    }),
    false,
  )
})
