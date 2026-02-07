import { assertEquals } from '@std/assert'
import { ensureDir } from '@std/fs/ensure-dir'
import { join } from '@std/path'
import { AudioSplitterService } from './index.ts'

const originalCommand = Deno.Command

Deno.test('AudioSplitterService uses re-encode segmentation and parses timing manifest', async () => {
  const testDir = join(Deno.cwd(), 'test-audio-splitter')
  await ensureDir(testDir)

  const inputPath = join(testDir, 'input.wav')
  await Deno.writeFile(inputPath, new Uint8Array([0, 1, 2, 3]))

  const capturedCalls: Array<{ command: string; args: string[] }> = []

  Deno.Command = function (command: string, options?: Deno.CommandOptions) {
    capturedCalls.push({ command, args: [...(options?.args || [])] })

    return {
      output: async () => {
        const args = options?.args || []
        const segmentListIndex = args.findIndex((arg) => arg === '-segment_list')
        const segmentListPath = segmentListIndex >= 0 ? String(args[segmentListIndex + 1]) : ''

        if (segmentListPath) {
          const chunkPathA = join(testDir, 'chunk_00000.wav')
          const chunkPathB = join(testDir, 'chunk_00001.wav')
          await Deno.writeFile(chunkPathA, new Uint8Array([1]))
          await Deno.writeFile(chunkPathB, new Uint8Array([2]))
          await Deno.writeTextFile(
            segmentListPath,
            `${chunkPathA},0.000000,30.000000\n${chunkPathB},30.000000,61.250000\n`,
          )
        }

        return {
          code: 0,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        }
      },
    } as unknown as Deno.Command
  } as unknown as typeof Deno.Command

  try {
    const service = new AudioSplitterService()
    const result = await service.splitAudio({
      inputFile: inputPath,
      outputDir: testDir,
      segmentDuration: 30,
      filePrefix: 'chunk',
    })

    assertEquals(result.ok, true)
    if (!result.ok) return

    assertEquals(result.data.length, 2)
    assertEquals(result.data[0].index, 0)
    assertEquals(result.data[0].durationSec, 30)
    assertEquals(result.data[1].index, 1)
    assertEquals(result.data[1].durationSec, 31.25)

    assertEquals(capturedCalls.length, 1)
    assertEquals(capturedCalls[0].command, 'ffmpeg')
    assertEquals(capturedCalls[0].args.includes('-c:a'), true)
    assertEquals(capturedCalls[0].args.includes('pcm_s16le'), true)
    assertEquals(capturedCalls[0].args.includes('-segment_list'), true)
    assertEquals(capturedCalls[0].args.includes('-segment_list_type'), true)
    assertEquals(capturedCalls[0].args.includes('csv'), true)
    assertEquals(capturedCalls[0].args.includes('-c'), false)
    assertEquals(capturedCalls[0].args.includes('copy'), false)
  } finally {
    Deno.Command = originalCommand
    await Deno.remove(testDir, { recursive: true })
  }
})
