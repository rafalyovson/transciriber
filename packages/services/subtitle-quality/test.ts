import { assertEquals } from '@std/assert'
import { SubtitleQualityService } from './mod.ts'
import { resolveSubtitleProfile } from '@transcriber/subtitle-profiles'

const profile = resolveSubtitleProfile({ languageCode: 'en' }).profile

Deno.test('SubtitleQualityService passes valid subtitle cues', () => {
  const service = new SubtitleQualityService()
  const result = service.evaluate({
    profile,
    strict: true,
    sourceDurationSec: 5.8,
    cues: [
      { index: 1, startSec: 0, endSec: 2.5, text: 'Hello world', lines: ['Hello world'] },
      {
        index: 2,
        startSec: 2.7,
        endSec: 5.8,
        text: 'Second subtitle line',
        lines: ['Second subtitle line'],
      },
    ],
  })

  assertEquals(result.status, 'pass')
  assertEquals(result.violations.length, 0)
})

Deno.test('SubtitleQualityService fails strict mode on structural issues', () => {
  const service = new SubtitleQualityService()
  const result = service.evaluate({
    profile,
    strict: true,
    sourceDurationSec: 4,
    cues: [
      { index: 1, startSec: 0, endSec: 2, text: 'First cue', lines: ['First cue'] },
      { index: 2, startSec: 1.8, endSec: 3.5, text: 'Overlapping cue', lines: ['Overlapping cue'] },
    ],
  })

  assertEquals(result.status, 'fail')
  assertEquals(result.violations.length > 0, true)
})

Deno.test('SubtitleQualityService fails on structural issues even when strict is false', () => {
  const service = new SubtitleQualityService()
  const result = service.evaluate({
    profile,
    strict: false,
    sourceDurationSec: 4,
    cues: [
      { index: 1, startSec: 0, endSec: 2, text: 'First cue', lines: ['First cue'] },
      { index: 2, startSec: 1.7, endSec: 3.5, text: 'Overlapping cue', lines: ['Overlapping cue'] },
    ],
  })

  assertEquals(result.status, 'fail')
  assertEquals(result.metrics.structuralViolationCount > 0, true)
})

Deno.test('SubtitleQualityService marks review_required in non-strict mode', () => {
  const service = new SubtitleQualityService()
  const result = service.evaluate({
    profile,
    strict: false,
    sourceDurationSec: 0.5,
    cues: [
      {
        index: 1,
        startSec: 0,
        endSec: 0.5,
        text:
          'A very long subtitle line that should exceed the preferred characters-per-second target by far',
        lines: [
          'A very long subtitle line that should exceed the preferred characters-per-second target by far',
        ],
      },
    ],
  })

  assertEquals(result.status, 'review_required')
  assertEquals(result.metrics.hardViolationCount > 0, true)
})

Deno.test('SubtitleQualityService applies epsilon-safe gap checks on ms-aligned cues', () => {
  const service = new SubtitleQualityService()
  const result = service.evaluate({
    profile,
    strict: true,
    sourceDurationSec: 6,
    cues: [
      { index: 1, startSec: 0, endSec: 2, text: 'Cue one', lines: ['Cue one'] },
      { index: 2, startSec: 2.0005, endSec: 4, text: 'Cue two', lines: ['Cue two'] },
      { index: 3, startSec: 4.001, endSec: 6, text: 'Cue three', lines: ['Cue three'] },
    ],
  })

  assertEquals(result.status, 'pass')
  assertEquals(result.metrics.structuralViolationCount, 0)
})
