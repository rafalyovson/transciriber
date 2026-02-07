import { assertEquals, assertStringIncludes } from '@std/assert'
import { TranscriptionApp } from './index.ts'

function setPrivateField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
  })
}

function structuredResult(text: string, overrides: Record<string, unknown> = {}) {
  return {
    text,
    words: [
      { text: 'hello', startSec: 0, endSec: 0.4 },
      { text: 'world.', startSec: 0.45, endSec: 1.0 },
    ],
    additionalFormats: [],
    languageCode: 'en',
    ...overrides,
  }
}

function baseFileService() {
  return {
    fileExists: () => Promise.resolve(true),
    setOutputDir: () => undefined,
    readAudioFileFromPath: () => Promise.resolve({ ok: true as const, data: new Blob(['audio']) }),
    getTempDir: () => '/tmp',
    combineChunkTranscriptions: (chunks: string[]) => chunks.join(' '),
    saveTranscription: () => Promise.resolve('/tmp/output.md'),
    saveSubtitle: (_content: string, _fileName: string, format: 'srt' | 'vtt') =>
      Promise.resolve(`/tmp/output.${format}`),
    saveSubtitleQualityReport: () => Promise.resolve('/tmp/output.subtitle-quality.json'),
    cleanupTempFiles: () => Promise.resolve(undefined),
  }
}

function baseMediaPreprocessorService() {
  return {
    prepareInputForTranscription: () =>
      Promise.resolve({
        ok: true as const,
        data: {
          preparedFilePath: '/tmp/input.wav',
          mediaKind: 'audio' as const,
          audioExtracted: false,
          warnings: [],
          cleanupPaths: [],
        },
      }),
  }
}

function baseMediaInspectorService(overrides: {
  mediaKind?: 'audio' | 'video'
  sizeBytes?: number
  durationSec?: number
  hasAudio?: boolean
} = {}) {
  return {
    inspectMedia: () =>
      Promise.resolve({
        ok: true as const,
        data: {
          filePath: '/tmp/input.wav',
          mediaKind: overrides.mediaKind || 'audio',
          sizeBytes: overrides.sizeBytes ?? 1024,
          durationSec: overrides.durationSec ?? 60,
          hasAudio: overrides.hasAudio ?? true,
        },
      }),
  }
}

Deno.test('TranscriptionApp forces video input to parts mode and reports coverage summary', async () => {
  const app = new TranscriptionApp({}, 30)
  let segmentDuration = 0
  let splitCalls = 0

  const splitterService = {
    splitAudio: (options: { segmentDuration: number }) => {
      splitCalls += 1
      segmentDuration = options.segmentDuration
      return Promise.resolve({
        ok: true as const,
        data: [
          { path: '/tmp/chunk_00000.wav', index: 0, startSec: 0, endSec: 60, durationSec: 60 },
          { path: '/tmp/chunk_00001.wav', index: 1, startSec: 60, endSec: 120, durationSec: 60 },
        ],
      })
    },
  }

  const transcriptionService = {
    transcribe: () =>
      Promise.resolve({
        ok: true as const,
        data: structuredResult('chunk text', {
          words: [],
          additionalFormats: [
            {
              format: 'srt',
              content:
                '1\n00:00:00,000 --> 00:00:05,000\nchunk text\n\n2\n00:00:05,200 --> 00:00:09,500\nnext line\n',
            },
          ],
        }),
      }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'hy' }),
  }

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'audioSplitterService', splitterService)
  setPrivateField(app, 'transcriptionService', transcriptionService)
  setPrivateField(app, 'mediaPreprocessorService', {
    prepareInputForTranscription: () =>
      Promise.resolve({
        ok: true as const,
        data: {
          preparedFilePath: '/tmp/video.wav',
          mediaKind: 'video' as const,
          audioExtracted: true,
          warnings: ['Audio extracted from MP4 before transcription.'],
          cleanupPaths: [],
        },
      }),
  })
  setPrivateField(
    app,
    'mediaInspectorService',
    baseMediaInspectorService({ mediaKind: 'video', durationSec: 20 }),
  )

  const result = await app.run('/tmp/input.mp4', undefined, { mode: 'whole' })
  assertEquals(result.success, true)
  assertEquals(result.modeRequested, 'whole')
  assertEquals(result.modeUsed, 'parts')
  assertEquals(result.isComplete, true)
  assertEquals(result.totalChunks, 2)
  assertEquals(result.successfulChunks, 2)
  assertEquals(result.failedChunks, 0)
  assertEquals((result.coverageRatio || 0) >= 0.99, true)
  assertEquals(result.audioExtracted, true)
  assertEquals(result.subtitleGenerated, true)
  assertEquals(result.subtitleFormats?.includes('srt'), true)
  assertEquals(result.subtitleFormats?.includes('vtt'), true)
  assertEquals(Boolean(result.subtitlePaths?.srt), true)
  assertEquals(Boolean(result.subtitleQualityReportPath), true)
  assertEquals(splitCalls, 1)
  assertEquals(segmentDuration, 120)
})

Deno.test(
  'TranscriptionApp succeeds with review_required subtitle quality for readability-only issues',
  async () => {
    const app = new TranscriptionApp({}, 30)

    setPrivateField(app, 'fileService', baseFileService())
    setPrivateField(app, 'mediaPreprocessorService', {
      prepareInputForTranscription: () =>
        Promise.resolve({
          ok: true as const,
          data: {
            preparedFilePath: '/tmp/video.wav',
            mediaKind: 'video' as const,
            audioExtracted: true,
            warnings: [],
            cleanupPaths: [],
          },
        }),
    })
    setPrivateField(
      app,
      'mediaInspectorService',
      baseMediaInspectorService({ mediaKind: 'video', durationSec: 20 }),
    )
    setPrivateField(app, 'audioSplitterService', {
      splitAudio: () =>
        Promise.resolve({
          ok: true as const,
          data: [{
            path: '/tmp/chunk_00000.wav',
            index: 0,
            startSec: 0,
            endSec: 20,
            durationSec: 20,
          }],
        }),
    })
    setPrivateField(app, 'transcriptionService', {
      transcribe: () =>
        Promise.resolve({
          ok: true as const,
          data: structuredResult('chunk text', {
            words: [],
            additionalFormats: [
              {
                format: 'srt',
                content:
                  '1\n00:00:00,000 --> 00:00:10,000\nThis line is intentionally very long to force readability warnings in strict mode.\n\n2\n00:00:10,000 --> 00:00:20,000\nThis line is intentionally very long to force readability warnings in strict mode.\n',
              },
            ],
          }),
        }),
      updateConfig: () => undefined,
      getConfig: () => ({ languageCode: 'hy' }),
    })

    const result = await app.run('/tmp/input.mp4', undefined, { mode: 'whole' })
    assertEquals(result.success, true)
    assertEquals(result.subtitleGenerated, true)
    assertEquals(result.subtitleQuality?.status, 'review_required')
    assertEquals((result.subtitleViolationCount || 0) > 0, true)
    assertEquals(Boolean(result.subtitleQualityReportPath), true)
  },
)

Deno.test('TranscriptionApp fails when subtitle structural checks fail', async () => {
  const app = new TranscriptionApp({}, 30)

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', {
    prepareInputForTranscription: () =>
      Promise.resolve({
        ok: true as const,
        data: {
          preparedFilePath: '/tmp/video.wav',
          mediaKind: 'video' as const,
          audioExtracted: true,
          warnings: [],
          cleanupPaths: [],
        },
      }),
  })
  setPrivateField(
    app,
    'mediaInspectorService',
    baseMediaInspectorService({ mediaKind: 'video', durationSec: 20 }),
  )
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [{
          path: '/tmp/chunk_00000.wav',
          index: 0,
          startSec: 0,
          endSec: 20,
          durationSec: 20,
        }],
      }),
  })
  setPrivateField(app, 'transcriptionService', {
    transcribe: () =>
      Promise.resolve({
        ok: true as const,
        data: structuredResult('chunk text', {
          words: [],
          additionalFormats: [
            {
              format: 'srt',
              content: '1\n00:00:00,000 --> 00:00:02,000\nVery short provider subtitle coverage.\n',
            },
          ],
        }),
      }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'hy' }),
  })

  const result = await app.run('/tmp/input.mp4', undefined, { mode: 'whole' })
  assertEquals(result.success, false)
  assertStringIncludes(result.error || '', 'Subtitle quality checks failed in strict mode')
  assertEquals(Boolean(result.subtitleQualityReportPath), true)
})

Deno.test('TranscriptionApp retries chunk transcription and succeeds when retry recovers', async () => {
  const app = new TranscriptionApp({}, 30)
  let transcribeCalls = 0

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 30 }))
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [{
          path: '/tmp/chunk_00000.wav',
          index: 0,
          startSec: 0,
          endSec: 30,
          durationSec: 30,
        }],
      }),
  })
  setPrivateField(app, 'waitForRetry', () => Promise.resolve())
  setPrivateField(app, 'transcriptionService', {
    transcribe: () => {
      transcribeCalls += 1
      if (transcribeCalls === 1) {
        return Promise.resolve({ ok: false as const, error: new Error('temporary failure') })
      }
      return Promise.resolve({ ok: true as const, data: structuredResult('recovered chunk') })
    },
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, { mode: 'parts', chunkDuration: 30 })
  assertEquals(result.success, true)
  assertEquals(result.isComplete, true)
  assertEquals(result.totalChunks, 1)
  assertEquals(transcribeCalls, 2)
})

Deno.test('TranscriptionApp fails when chunk transcription retries are exhausted', async () => {
  const app = new TranscriptionApp({}, 30)
  let transcribeCalls = 0

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 30 }))
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [{
          path: '/tmp/chunk_00000.wav',
          index: 0,
          startSec: 0,
          endSec: 30,
          durationSec: 30,
        }],
      }),
  })
  setPrivateField(app, 'waitForRetry', () => Promise.resolve())
  setPrivateField(app, 'transcriptionService', {
    transcribe: () => {
      transcribeCalls += 1
      return Promise.resolve({ ok: false as const, error: new Error('fatal chunk error') })
    },
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, { mode: 'parts', chunkDuration: 30 })
  assertEquals(result.success, false)
  assertEquals(result.isComplete, false)
  assertStringIncludes(result.error || '', 'Failed after retries at chunk 1/1')
  assertEquals(transcribeCalls, 3)
})

Deno.test('TranscriptionApp fails when coverage ratio is below threshold', async () => {
  const app = new TranscriptionApp({}, 30)

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 100 }))
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [{
          path: '/tmp/chunk_00000.wav',
          index: 0,
          startSec: 0,
          endSec: 50,
          durationSec: 50,
        }],
      }),
  })
  setPrivateField(app, 'transcriptionService', {
    transcribe: () => Promise.resolve({ ok: true as const, data: structuredResult('half text') }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, { mode: 'parts', chunkDuration: 30 })
  assertEquals(result.success, false)
  assertEquals(result.isComplete, false)
  assertEquals(result.coverageRatio, 0.5)
  assertStringIncludes(result.error || '', 'coverage below threshold')
})

Deno.test('TranscriptionApp reports complete coverage when all chunks succeed', async () => {
  const app = new TranscriptionApp({}, 30)

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 100 }))
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [
          { path: '/tmp/chunk_00000.wav', index: 0, startSec: 0, endSec: 40, durationSec: 40 },
          { path: '/tmp/chunk_00001.wav', index: 1, startSec: 40, endSec: 100, durationSec: 60 },
        ],
      }),
  })
  setPrivateField(app, 'transcriptionService', {
    transcribe: () => Promise.resolve({ ok: true as const, data: structuredResult('chunk text') }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, { mode: 'parts', chunkDuration: 30 })
  assertEquals(result.success, true)
  assertEquals(result.isComplete, true)
  assertEquals(result.totalChunks, 2)
  assertEquals(result.successfulChunks, 2)
  assertEquals(result.failedChunks, 0)
  assertEquals(result.sourceDurationSec, 100)
  assertEquals(result.transcribedDurationSec, 100)
  assertEquals(result.coverageRatio, 1)
})

Deno.test('TranscriptionApp emits live stage progress for whole mode', async () => {
  const app = new TranscriptionApp({}, 30)
  const events: string[] = []

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 30 }))
  setPrivateField(app, 'transcriptionService', {
    transcribe: () => Promise.resolve({ ok: true as const, data: structuredResult('whole text') }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, {
    mode: 'whole',
    onProgress: (event) => events.push(event.stage),
  })

  assertEquals(result.success, true)
  assertEquals(events.includes('preparing_input'), true)
  assertEquals(events.includes('transcribing_whole'), true)
  assertEquals(events.includes('saving_output'), true)
  assertEquals(events.at(-1), 'completed')
})

Deno.test('TranscriptionApp emits chunk progress events and partial text for parts mode', async () => {
  const app = new TranscriptionApp({}, 30)
  const events: Array<{ stage: string; partialText?: string }> = []

  setPrivateField(app, 'fileService', baseFileService())
  setPrivateField(app, 'mediaPreprocessorService', baseMediaPreprocessorService())
  setPrivateField(app, 'mediaInspectorService', baseMediaInspectorService({ durationSec: 60 }))
  setPrivateField(app, 'audioSplitterService', {
    splitAudio: () =>
      Promise.resolve({
        ok: true as const,
        data: [{
          path: '/tmp/chunk_00000.wav',
          index: 0,
          startSec: 0,
          endSec: 60,
          durationSec: 60,
        }],
      }),
  })
  setPrivateField(app, 'transcriptionService', {
    transcribe: () =>
      Promise.resolve({ ok: true as const, data: structuredResult('chunk-progress-text') }),
    updateConfig: () => undefined,
    getConfig: () => ({ languageCode: 'en' }),
  })

  const result = await app.run('/tmp/input.wav', undefined, {
    mode: 'parts',
    chunkDuration: 30,
    onProgress: (event) => events.push({ stage: event.stage, partialText: event.partialText }),
  })

  assertEquals(result.success, true)
  assertEquals(events.some((event) => event.stage === 'splitting'), true)
  assertEquals(events.some((event) => event.stage === 'transcribing_chunk'), true)
  assertEquals(events.some((event) => event.partialText === 'chunk-progress-text'), true)
  assertEquals(events.at(-1)?.stage, 'completed')
})
