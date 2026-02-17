const DEFAULT_CHUNK_DURATION_SEC = 30

/**
 * Gets the configured chunk duration or returns the default
 */
export function getChunkDuration(): number {
  const envDuration = Deno.env.get('CHUNK_DURATION')
  if (!envDuration) return DEFAULT_CHUNK_DURATION_SEC

  const duration = parseInt(envDuration, 10)
  return isNaN(duration) || duration <= 0 ? DEFAULT_CHUNK_DURATION_SEC : duration
}

/**
 * Gets the language code from environment or returns the default
 */
export function getLanguageCode(): string {
  const language = Deno.env.get('LANGUAGE')?.toLowerCase() || 'en'

  // If the input is already a valid ISO language code, use it directly
  if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(language)) {
    return language.substring(0, 2).toLowerCase()
  }

  // Maps full language names (from LANGUAGE env var) to ISO 639-1 codes
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

/**
 * Verifies required environment variables are set
 * Following Deno best practices for environment variable handling
 */
export function setupEnv(): boolean {
  // API key can come from environment or from the UI settings.
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
  if (!apiKey) {
    console.warn(
      'ELEVENLABS_API_KEY not found in environment variables. The UI/API can still provide it at runtime.',
    )
  }

  // Log configured directories
  const inputDir = Deno.env.get('INPUT_DIR') || 'inputs'
  const outputDir = Deno.env.get('OUTPUT_DIR') || 'outputs'
  console.log(`Using input directory: ${inputDir}`)
  console.log(`Using output directory: ${outputDir}`)

  return true
}
