import { assertEquals, assertMatch } from '@std/assert'
import { parseSrt, SubtitleBuilderService } from './mod.ts'
import { resolveSubtitleProfile } from '@transcriber/subtitle-profiles'

Deno.test('SubtitleBuilderService uses provider SRT when available', () => {
  const service = new SubtitleBuilderService()
  const profile = resolveSubtitleProfile({ languageCode: 'hy' }).profile

  const result = service.buildSubtitles({
    text: 'Barev ashkharh',
    words: [],
    additionalFormats: [{
      format: 'srt',
      content:
        '1\n00:00:00,000 --> 00:00:01,500\n\u0532\u0561\u0580\u0587 \u0561\u0577\u056D\u0561\u0580\u0570\n\n2\n00:00:01,600 --> 00:00:03,000\n\u053B\u0576\u0579\u057A\u0565\u0301\u057D \u0565\u057D\n',
    }],
    profile,
    trackLanguageTag: 'hy',
    sourceDurationSec: 3,
  })

  assertEquals(result.artifacts.source, 'provider')
  assertEquals(result.cues.length, 2)
  assertEquals(result.artifacts.generated, true)
  assertMatch(
    result.artifacts.contents?.srt || '',
    /\u0532\u0561\u0580\u0587 \u0561\u0577\u056D\u0561\u0580\u0570/,
  )
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
        '1\n00:00:00,000 --> 00:00:10,000\n\u0531\u0575\u057D \u0576\u0561\u056D\u0561\u0564\u0561\u057D\u0578\u0582\u0569\u0575\u0578\u0582\u0576\u0568 \u0564\u056B\u057F\u0561\u057E\u0578\u0580\u0575\u0561\u056C \u0565\u0580\u056F\u0561\u0580 \u0567, \u0578\u0580\u057A\u0565\u057D\u0566\u056B \u0570\u0561\u0574\u0561\u056F\u0561\u0580\u0563\u0568 \u056F\u0561\u057F\u0561\u0580\u056B \u057E\u0565\u0580\u0561\u0583\u0578\u056D\u0578\u0582\u0574 \u0587 \u0562\u0561\u056A\u0561\u0576\u056B \u0565\u0576\u0569\u0561\u0563\u0580\u056B \u057F\u0578\u0572\u0565\u0580\u0568 \u0570\u0561\u0574\u0561\u057A\u0561\u057F\u0561\u057D\u056D\u0561\u0576 \u057D\u0561\u0570\u0574\u0561\u0576\u0561\u0579\u0561\u0583\u0565\u0580\u0578\u057E\u0589\n',
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
