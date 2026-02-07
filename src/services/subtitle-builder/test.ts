import { assertEquals, assertMatch } from '@std/assert'
import { parseSrt, SubtitleBuilderService } from './index.ts'
import { resolveSubtitleProfile } from '../subtitle-profiles/index.ts'

Deno.test('SubtitleBuilderService uses provider SRT when available', () => {
  const service = new SubtitleBuilderService()
  const profile = resolveSubtitleProfile({ languageCode: 'hy' }).profile

  const result = service.buildSubtitles({
    text: 'Barev ashkharh',
    words: [],
    additionalFormats: [{
      format: 'srt',
      content:
        '1\n00:00:00,000 --> 00:00:01,500\nԲարև աշխարհ\n\n2\n00:00:01,600 --> 00:00:03,000\nԻնչպե՞ս ես\n',
    }],
    profile,
    trackLanguageTag: 'hy',
    sourceDurationSec: 3,
  })

  assertEquals(result.artifacts.source, 'provider')
  assertEquals(result.cues.length, 2)
  assertEquals(result.artifacts.generated, true)
  assertMatch(result.artifacts.contents?.srt || '', /Բարև աշխարհ/)
  assertMatch(result.artifacts.contents?.vtt || '', /WEBVTT/)
})

Deno.test('SubtitleBuilderService falls back to word timing synthesis', () => {
  const service = new SubtitleBuilderService()
  const profile = resolveSubtitleProfile({ languageCode: 'en' }).profile

  const result = service.buildSubtitles({
    text: 'Hello world',
    words: [
      { text: 'Hello', startSec: 0.0, endSec: 0.5 },
      { text: 'world.', startSec: 0.6, endSec: 1.2 },
      { text: 'Another', startSec: 1.4, endSec: 1.9 },
      { text: 'sentence.', startSec: 2.0, endSec: 2.8 },
    ],
    additionalFormats: [],
    profile,
    trackLanguageTag: 'en',
    sourceDurationSec: 3,
  })

  assertEquals(result.artifacts.source, 'local')
  assertEquals(result.cues.length >= 1, true)
  assertEquals(result.artifacts.generated, true)
  assertEquals(result.warnings.length > 0, true)
})

Deno.test('SubtitleBuilderService offsets and merges chunk cues in parts mode', () => {
  const service = new SubtitleBuilderService()
  const profile = resolveSubtitleProfile({ languageCode: 'en' }).profile

  const result = service.buildSubtitles({
    text: 'chunk one chunk two',
    words: [],
    additionalFormats: [],
    profile,
    trackLanguageTag: 'en',
    sourceDurationSec: 25,
    chunks: [
      {
        startSec: 0,
        durationSec: 10,
        text: 'chunk one',
        words: [{ text: 'chunk', startSec: 0, endSec: 0.4 }, {
          text: 'one.',
          startSec: 0.5,
          endSec: 1,
        }],
        additionalFormats: [],
      },
      {
        startSec: 10,
        durationSec: 10,
        text: 'chunk two',
        words: [{ text: 'chunk', startSec: 0, endSec: 0.4 }, {
          text: 'two.',
          startSec: 0.5,
          endSec: 1,
        }],
        additionalFormats: [],
      },
    ],
  })

  assertEquals(result.cues.length >= 2, true)
  assertEquals(result.cues[1].startSec >= 10, true)

  const reparsed = parseSrt(result.artifacts.contents?.srt || '')
  assertEquals(reparsed.length, result.cues.length)
})

Deno.test('SubtitleBuilderService repairs long provider cues by splitting and reflowing', () => {
  const service = new SubtitleBuilderService()
  const profile = resolveSubtitleProfile({ languageCode: 'hy' }).profile

  const result = service.buildSubtitles({
    text: 'placeholder',
    words: [],
    additionalFormats: [{
      format: 'srt',
      content:
        '1\n00:00:00,000 --> 00:00:10,000\nԱյս նախադասությունը դիտավորյալ երկար է, որպեսզի համակարգը կատարի վերափոխում և բաժանի ենթագրի տողերը համապատասխան սահմանաչափերով։\n',
    }],
    profile,
    trackLanguageTag: 'hy',
    sourceDurationSec: 10,
  })

  assertEquals(result.cues.length >= 2, true)
  assertEquals(result.cues.every((cue) => cue.lines.length <= 2), true)
  assertEquals(result.cues.every((cue) => cue.lines.every((line) => line.length <= 42)), true)

  const reparsed = parseSrt(result.artifacts.contents?.srt || '')
  assertEquals(reparsed.length, result.cues.length)
})
