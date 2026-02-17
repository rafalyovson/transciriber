import { assertEquals } from '@std/assert'
import { TranscriptionService } from './mod.ts'

Deno.test('TranscriptionService', async (t) => {
  await t.step('defaults to scribe_v2 model', () => {
    const service = new TranscriptionService({ apiKey: 'test-key' })
    assertEquals(service.getConfig().modelId, 'scribe_v2')
  })

  await t.step('transcribe returns structured output', async () => {
    const service = new TranscriptionService({ apiKey: 'test-key' })

    Object.defineProperty(service, 'client', {
      value: {
        speechToText: {
          convert: () => {
            return {
              text: 'This is a mock transcription',
              words: [
                { text: 'This', start: 0.0, end: 0.2 },
                { text: 'is', start: 0.21, end: 0.3 },
              ],
              additional_formats: [
                {
                  format: 'srt',
                  content: '1\n00:00:00,000 --> 00:00:01,000\nThis is a mock transcription\n',
                },
              ],
              language_code: 'en',
            }
          },
        },
      },
      writable: true,
    })

    const audioBlob = new Blob(['mock audio data'], { type: 'audio/mp3' })
    const result = await service.transcribe(audioBlob)

    assertEquals(result.ok, true)
    if (!result.ok) {
      return
    }

    assertEquals(result.data.text, 'This is a mock transcription')
    assertEquals(result.data.words.length, 2)
    assertEquals(result.data.additionalFormats.length, 1)
    assertEquals(result.data.languageCode, 'en')
  })

  await t.step(
    'transcribe retries when additional_formats requires diarization/timestamps',
    async () => {
      const service = new TranscriptionService({ apiKey: 'test-key', diarize: false })
      let callCount = 0

      Object.defineProperty(service, 'client', {
        value: {
          speechToText: {
            convert: () => {
              callCount += 1
              if (callCount === 1) {
                throw new Error(
                  'Status code: 400 Body: {"detail":{"code":"invalid_parameters","message":"Requesting additional formats must have diarization and timestamps enabled.","param":"additional_formats"}}',
                )
              }

              return {
                text: 'Recovered transcription',
                words: [{ text: 'Recovered', start: 0, end: 0.6 }],
              }
            },
          },
        },
        writable: true,
      })

      const audioBlob = new Blob(['mock audio data'], { type: 'audio/mp3' })
      const result = await service.transcribe(audioBlob)

      assertEquals(result.ok, true)
      if (!result.ok) return

      assertEquals(callCount >= 2, true)
      assertEquals(result.data.text, 'Recovered transcription')
      assertEquals(result.data.words.length, 1)
    },
  )
})
