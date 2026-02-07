import { assertEquals } from '@std/assert'
import {
  isPathWithinDirectory,
  isSupportedUploadFile,
  normalizeTranscriptionRequestOptions,
  toTranscriptionApiResponse,
} from './index.ts'
import { join } from '@std/path'
import { ensureDir } from '@std/fs/ensure-dir'

Deno.test('normalizeTranscriptionRequestOptions defaults to whole mode', () => {
  const options = normalizeTranscriptionRequestOptions({})

  assertEquals(options.modeRequested, 'whole')
  assertEquals(options.chunkDuration > 0, true)
})

Deno.test('normalizeTranscriptionRequestOptions supports parts mode and explicit chunk size', () => {
  const options = normalizeTranscriptionRequestOptions({
    transcriptionMode: 'parts',
    chunkDuration: 42,
  })

  assertEquals(options.modeRequested, 'parts')
  assertEquals(options.chunkDuration, 42)
})

Deno.test('normalizeTranscriptionRequestOptions guards invalid chunk size', () => {
  const options = normalizeTranscriptionRequestOptions({
    transcriptionMode: 'parts',
    chunkDuration: -20,
  })

  assertEquals(options.modeRequested, 'parts')
  assertEquals(options.chunkDuration > 0, true)
})

Deno.test('isSupportedUploadFile accepts audio and mp4 video', () => {
  assertEquals(isSupportedUploadFile({ name: 'clip.mp3', type: 'audio/mpeg' }), true)
  assertEquals(isSupportedUploadFile({ name: 'meeting.mp4', type: '' }), true)
  assertEquals(isSupportedUploadFile({ name: 'notes.txt', type: 'text/plain' }), false)
})

Deno.test('isPathWithinDirectory validates child paths only', async () => {
  const baseDir = join(Deno.cwd(), 'test-ui-path-check')
  const nestedDir = join(baseDir, 'nested')
  const nestedFile = join(nestedDir, 'inside.txt')
  const outsideFile = join(Deno.cwd(), 'outside-ui-path-check.txt')

  await ensureDir(nestedDir)
  await Deno.writeTextFile(nestedFile, 'inside')
  await Deno.writeTextFile(outsideFile, 'outside')

  try {
    assertEquals(await isPathWithinDirectory(nestedFile, baseDir), true)
    assertEquals(await isPathWithinDirectory(outsideFile, baseDir), false)
  } finally {
    await Deno.remove(baseDir, { recursive: true })
    await Deno.remove(outsideFile)
  }
})

Deno.test('toTranscriptionApiResponse defaults completeness fields for incomplete payloads', () => {
  const response = toTranscriptionApiResponse({
    success: false,
    error: 'failed',
  }, 'whole')

  assertEquals(response.success, false)
  assertEquals(response.modeRequested, 'whole')
  assertEquals(response.modeUsed, 'whole')
  assertEquals(response.isComplete, false)
  assertEquals(response.mediaKind, 'audio')
  assertEquals(response.audioExtracted, false)
})

Deno.test('toTranscriptionApiResponse preserves completeness metrics', () => {
  const response = toTranscriptionApiResponse({
    success: true,
    data: 'ok',
    modeRequested: 'whole',
    modeUsed: 'parts',
    isComplete: true,
    totalChunks: 5,
    successfulChunks: 5,
    failedChunks: 0,
    sourceDurationSec: 120,
    transcribedDurationSec: 120,
    coverageRatio: 1,
    mediaKind: 'video',
    audioExtracted: true,
    subtitleGenerated: true,
    subtitleFormats: ['srt', 'vtt'],
    subtitlePaths: { srt: '/tmp/a.srt', vtt: '/tmp/a.vtt' },
    subtitleCueCount: 12,
    subtitleViolationCount: 3,
    subtitleQualityReportPath: '/tmp/a.subtitle-quality.json',
    subtitleQuality: { status: 'pass', violations: [], metrics: { cueCount: 12 } },
    subtitleTrackLanguageTag: 'hy',
  }, 'whole')

  assertEquals(response.success, true)
  assertEquals(response.modeUsed, 'parts')
  assertEquals(response.isComplete, true)
  assertEquals(response.totalChunks, 5)
  assertEquals(response.coverageRatio, 1)
  assertEquals(response.mediaKind, 'video')
  assertEquals(response.audioExtracted, true)
  assertEquals(response.subtitleGenerated, true)
  assertEquals(response.subtitleFormats?.length, 2)
  assertEquals(response.subtitlePaths?.srt, '/tmp/a.srt')
  assertEquals(response.subtitleCueCount, 12)
  assertEquals(response.subtitleViolationCount, 3)
  assertEquals(response.subtitleQualityReportPath, '/tmp/a.subtitle-quality.json')
  assertEquals(response.subtitleQuality?.status, 'pass')
  assertEquals(response.subtitleTrackLanguageTag, 'hy')
})
