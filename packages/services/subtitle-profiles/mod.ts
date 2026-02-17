import type { LanguageSubtitleProfile } from '@transcriber/core'

const DEFAULT_PROFILE: LanguageSubtitleProfile = {
  id: 'default',
  name: 'Default',
  sttLanguageCode: 'en',
  defaultTrackLanguageTag: 'en',
  maxLinesPerCue: 2,
  maxCharsPerLine: 42,
  cpsTarget: 17,
  cpsHardLimit: 21,
  minCueDurationSec: 1,
  maxCueDurationSec: 7,
  keyterms: [],
}

const ARMENIAN_PROFILE: LanguageSubtitleProfile = {
  id: 'armenian',
  name: 'Armenian',
  sttLanguageCode: 'hye',
  defaultTrackLanguageTag: 'hy',
  maxLinesPerCue: 2,
  maxCharsPerLine: 42,
  cpsTarget: 17,
  cpsHardLimit: 21,
  minCueDurationSec: 1,
  maxCueDurationSec: 7,
  keyterms: [],
}

const WESTERN_ARMENIAN_PROFILE: LanguageSubtitleProfile = {
  ...ARMENIAN_PROFILE,
  id: 'western-armenian',
  name: 'Western Armenian',
  defaultTrackLanguageTag: 'hyw',
}

const PROFILE_REGISTRY: Record<string, LanguageSubtitleProfile> = {
  default: DEFAULT_PROFILE,
  armenian: ARMENIAN_PROFILE,
  'western-armenian': WESTERN_ARMENIAN_PROFILE,
}

type ProfileSelection = {
  profile: LanguageSubtitleProfile
  trackLanguageTag: string
  warnings: string[]
}

function parseKeyterms(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)]
}

export function normalizeSubtitleText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC')
}

export function resolveSubtitleProfile(options: {
  languageCode?: string
  profileId?: string
  trackLanguageTag?: string
} = {}): ProfileSelection {
  const languageCode = (options.languageCode || '').trim().toLowerCase()
  const profileId = (options.profileId || '').trim().toLowerCase()
  const warnings: string[] = []

  let profile: LanguageSubtitleProfile = DEFAULT_PROFILE

  if (profileId && PROFILE_REGISTRY[profileId]) {
    profile = PROFILE_REGISTRY[profileId]
  } else if (profileId) {
    warnings.push(
      `Unknown subtitle profile "${profileId}". Falling back to language-based defaults.`,
    )
  }

  if (!profileId) {
    if (languageCode === 'hy' || languageCode === 'hye') {
      profile = ARMENIAN_PROFILE
    } else if (languageCode === 'hyw') {
      profile = WESTERN_ARMENIAN_PROFILE
    }
  }

  let trackLanguageTag = (options.trackLanguageTag || '').trim().toLowerCase()
  if (!trackLanguageTag) {
    trackLanguageTag = profile.defaultTrackLanguageTag
  }

  if (trackLanguageTag !== 'hy' && trackLanguageTag !== 'hyw') {
    if (profile.id === 'armenian' || profile.id === 'western-armenian') {
      warnings.push(
        `Unexpected Armenian subtitle track tag "${trackLanguageTag}". Keeping value as requested.`,
      )
    }
  }

  return {
    profile,
    trackLanguageTag,
    warnings,
  }
}

export function resolveSttLanguageCode(languageCode: string | undefined): string {
  const normalized = (languageCode || '').trim().toLowerCase()
  if (normalized === 'hy' || normalized === 'hye' || normalized === 'hyw') {
    return 'hye'
  }

  if (!normalized) {
    return 'en'
  }

  if (/^[a-z]{2,3}$/i.test(normalized)) {
    return normalized
  }

  return normalized.slice(0, 2) || 'en'
}

export function resolveSubtitleKeyterms(
  profile: LanguageSubtitleProfile,
  additionalKeyterms: string[] = [],
): string[] {
  const globalEnvTerms = parseKeyterms(Deno.env.get('SUBTITLE_KEYTERMS'))
  const profileEnvKey = profile.sttLanguageCode.toUpperCase()
  const profileEnvTerms = parseKeyterms(Deno.env.get(`SUBTITLE_KEYTERMS_${profileEnvKey}`))

  return uniqueValues([
    ...profile.keyterms,
    ...globalEnvTerms,
    ...profileEnvTerms,
    ...additionalKeyterms.map((value) => value.trim()).filter((value) => value.length > 0),
  ])
}

export function detectMixedScriptWarnings(
  text: string,
  profile: LanguageSubtitleProfile,
): string[] {
  if (profile.id !== 'armenian' && profile.id !== 'western-armenian') {
    return []
  }

  const armenianMatches = text.match(/\p{Script=Armenian}/gu) || []
  const latinMatches = text.match(/[A-Za-z]/g) || []

  if (armenianMatches.length < 20 || latinMatches.length === 0) {
    return []
  }

  const ratio = latinMatches.length / armenianMatches.length
  const warnings: string[] = []

  if (ratio > 0.15) {
    warnings.push(
      `Mixed-script anomaly detected: ${
        (ratio * 100).toFixed(1)
      }% Latin letters in Armenian-heavy subtitles.`,
    )
  }

  if (/(?:\p{Script=Armenian}[A-Za-z]|[A-Za-z]\p{Script=Armenian})/u.test(text)) {
    warnings.push(
      'Potential script-mixing artifacts found near Armenian words. Review names and lookalike letters.',
    )
  }

  return warnings
}
