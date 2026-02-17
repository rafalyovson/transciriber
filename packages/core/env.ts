const DEFAULT_CHUNK_DURATION_SEC = 30

export function getChunkDuration(): number {
  const envDuration = Deno.env.get('CHUNK_DURATION')
  if (!envDuration) return DEFAULT_CHUNK_DURATION_SEC

  const duration = parseInt(envDuration, 10)
  return isNaN(duration) || duration <= 0 ? DEFAULT_CHUNK_DURATION_SEC : duration
}

export function getLanguageCode(): string {
  const language = Deno.env.get('LANGUAGE')?.toLowerCase() || 'en'

  if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(language)) {
    return language.substring(0, 2).toLowerCase()
  }

  const languageMap: Record<string, string> = {
    english: 'en',
    armenian: 'hy',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    portuguese: 'pt',
    russian: 'ru',
    japanese: 'ja',
    chinese: 'zh',
  }

  return languageMap[language] || 'en'
}

export function setupEnv(): void {
  // Load .env-based config. Currently a no-op beyond ensuring
  // the env vars are read at startup (they're accessed lazily
  // by getChunkDuration/getLanguageCode). Kept as a hook for
  // future initialization needs.
}
