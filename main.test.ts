import { assertEquals, assertExists } from '@std/assert'
import { join } from '@std/path'
import { ensureDir } from '@std/fs/ensure-dir'
import { ensureFile } from '@std/fs/ensure-file'

// Define test constants
const TEST_DIR = join(Deno.cwd(), 'test')
const TEST_INPUT_DIR = join(TEST_DIR, 'inputs')
const TEST_OUTPUT_DIR = join(TEST_DIR, 'outputs')

Deno.test('Directory structure setup', async () => {
  // Setup test directories
  await ensureDir(TEST_INPUT_DIR)
  await ensureDir(TEST_OUTPUT_DIR)

  // Verify directories exist
  const inputInfo = await Deno.stat(TEST_INPUT_DIR)
  const outputInfo = await Deno.stat(TEST_OUTPUT_DIR)

  assertEquals(inputInfo.isDirectory, true, 'Input directory should exist')
  assertEquals(outputInfo.isDirectory, true, 'Output directory should exist')
})

Deno.test('Audio file type detection', () => {
  const testFiles = [
    'audio.mp3',
    'recording.wav',
    'voice.m4a',
    'sound.ogg',
    'music.flac',
    'document.pdf',
    'image.jpg',
  ]

  const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac']

  const audioFiles = testFiles.filter((file) => {
    const ext = '.' + file.split('.').pop()?.toLowerCase()
    return audioExtensions.includes(ext)
  })

  assertEquals(audioFiles.length, 5, 'Should detect 5 audio files')
  assertEquals(
    audioFiles.includes('document.pdf'),
    false,
    'Should not include PDF',
  )
  assertEquals(
    audioFiles.includes('image.jpg'),
    false,
    'Should not include JPG',
  )
})

Deno.test('Blob creation from buffer', async () => {
  // Create a test file
  const testFilePath = join(TEST_INPUT_DIR, 'test.mp3')
  await ensureFile(testFilePath)

  // Write some dummy data
  const encoder = new TextEncoder()
  const data = encoder.encode('test audio data')
  await Deno.writeFile(testFilePath, data)

  // Read the file
  const buffer = await Deno.readFile(testFilePath)

  // Create a blob
  const blob = new Blob([buffer], { type: 'audio/mp3' })

  assertExists(blob, 'Blob should be created')
  assertEquals(blob.type, 'audio/mp3', 'Blob should have correct MIME type')
  assertEquals(blob.size, data.length, 'Blob should have correct size')

  // Clean up
  await Deno.remove(testFilePath)
})

// Clean up test directory after all tests
Deno.test({
  name: 'Clean up test directory',
  fn: async () => {
    try {
      await Deno.remove(TEST_DIR, { recursive: true })
    } catch (error) {
      console.error('Error cleaning up test directory:', error)
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
})
