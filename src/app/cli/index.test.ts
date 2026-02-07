import { assertEquals, assertThrows } from '@std/assert'
import { parseCLIArgs } from './index.ts'

Deno.test('parseCLIArgs defaults to whole mode', () => {
  const parsed = parseCLIArgs(['./audio.mp3'], 30)

  assertEquals(parsed.filePath, './audio.mp3')
  assertEquals(parsed.mode, 'whole')
  assertEquals(parsed.chunkDuration, 30)
})

Deno.test('parseCLIArgs reads parts mode and chunk duration', () => {
  const parsed = parseCLIArgs(
    ['--mode=parts', '--chunk-duration=45', './audio.mp3'],
    30,
  )

  assertEquals(parsed.filePath, './audio.mp3')
  assertEquals(parsed.mode, 'parts')
  assertEquals(parsed.chunkDuration, 45)
})

Deno.test('parseCLIArgs throws on invalid mode', () => {
  assertThrows(() => parseCLIArgs(['--mode=invalid', './audio.mp3'], 30))
})

Deno.test('parseCLIArgs throws when file is missing', () => {
  assertThrows(() => parseCLIArgs(['--mode=whole'], 30))
})
