import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type {
  AdditionalTranscriptFormat,
  Result,
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionWord,
} from '@transcriber/core'

// Both snake_case and camelCase fields for defensive API response parsing —
// the ElevenLabs SDK may return either depending on version.
type ConvertResponse = {
  text?: string
  transcript?: string
  transcripts?: Array<{ text?: string }>
  words?: unknown[]
  word_timestamps?: unknown[]
  wordTimestamps?: unknown[]
  additional_formats?: unknown[]
  additionalFormats?: unknown[]
  language_code?: string
  languageCode?: string
  srt?: string
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function extractText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeWordTimings(words: TranscriptionWord[]): TranscriptionWord[] {
  if (words.length === 0) {
    return words
  }

  const maxTimestamp = words.reduce(
    (max, word) => Math.max(max, word.endSec),
    0,
  )
  // Heuristic: timestamps above 24h are likely in milliseconds.
  const looksLikeMilliseconds = maxTimestamp > 24 * 60 * 60
  const scale = looksLikeMilliseconds ? 1 / 1000 : 1

  return words
    .map((word) => ({
      ...word,
      startSec: word.startSec * scale,
      endSec: word.endSec * scale,
    }))
    .filter(
      (word) =>
        Number.isFinite(word.startSec) &&
        Number.isFinite(word.endSec) &&
        word.endSec > word.startSec,
    )
}

function parseWords(rawWords: unknown[]): TranscriptionWord[] {
  const words: TranscriptionWord[] = []

  for (const rawWord of rawWords) {
    if (!rawWord || typeof rawWord !== 'object') {
      continue
    }

    const candidate = rawWord as Record<string, unknown>
    const text = extractText(candidate.word) || extractText(candidate.text)
    const startSec = toNumber(candidate.start) ??
      toNumber(candidate.start_time) ??
      toNumber(candidate.startTime) ??
      toNumber(candidate.start_ms) ??
      toNumber(candidate.startMs)
    const endSec = toNumber(candidate.end) ??
      toNumber(candidate.end_time) ??
      toNumber(candidate.endTime) ??
      toNumber(candidate.end_ms) ??
      toNumber(candidate.endMs)

    if (!text || startSec === null || endSec === null || endSec <= startSec) {
      continue
    }

    words.push({
      text,
      startSec,
      endSec,
      type: extractText(candidate.type) || undefined,
      speakerId: extractText(candidate.speaker) ||
        extractText(candidate.speaker_id) ||
        extractText(candidate.speakerId) ||
        undefined,
    })
  }

  return normalizeWordTimings(words)
}

function parseAdditionalFormats(
  response: ConvertResponse,
): AdditionalTranscriptFormat[] {
  const additionalFormats = response.additionalFormats || response.additional_formats || []
  const parsed: AdditionalTranscriptFormat[] = []

  if (Array.isArray(additionalFormats)) {
    for (const item of additionalFormats) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const candidate = item as Record<string, unknown>
      const format = extractText(candidate.format).toLowerCase()
      const content = extractText(candidate.content) ||
        extractText(candidate.text) ||
        extractText(candidate.value)

      if (format && content) {
        parsed.push({ format, content })
      }
    }
  }

  const hasSrt = parsed.some((f) => f.format === 'srt')
  if (
    !hasSrt &&
    typeof response.srt === 'string' &&
    response.srt.trim().length > 0
  ) {
    parsed.push({ format: 'srt', content: response.srt.trim() })
  }

  return parsed
}

/**
 * Service for handling transcription operations
 */
export class TranscriptionService {
  private client: ElevenLabsClient
  private config: TranscriptionConfig

  /**
   * Creates a new TranscriptionService instance
   * @param config - Configuration for the transcription service
   */
  constructor(config: Partial<TranscriptionConfig> = {}) {
    const apiKey = config.apiKey || Deno.env.get('ELEVENLABS_API_KEY')

    this.config = {
      modelId: config.modelId || 'scribe_v2',
      tagAudioEvents: config.tagAudioEvents ?? false,
      languageCode: config.languageCode || 'en',
      diarize: config.diarize ?? false,
      keyterms: config.keyterms || [],
      apiKey,
    }

    this.client = this.createClient(apiKey)
  }

  private createClient(apiKey?: string): ElevenLabsClient {
    return new ElevenLabsClient({
      apiKey,
    })
  }

  private extractTextFromResponse(response: ConvertResponse): string | null {
    if (typeof response.text === 'string' && response.text.length > 0) {
      return response.text
    }

    if (
      typeof response.transcript === 'string' &&
      response.transcript.length > 0
    ) {
      return response.transcript
    }

    if (
      Array.isArray(response.transcripts) &&
      response.transcripts.length > 0
    ) {
      const combined = response.transcripts
        .map((item) => item.text)
        .filter((text) => typeof text === 'string' && text.length > 0)
        .join(' ')
        .trim()

      if (combined.length > 0) {
        return combined
      }
    }

    return null
  }

  private buildRequestPayload(audioBlob: Blob): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      file: audioBlob,
      modelId: this.config.modelId,
      tagAudioEvents: this.config.tagAudioEvents,
      languageCode: this.config.languageCode,
      diarize: this.config.diarize,
      timestampsGranularity: 'word',
      timestamps: true,
      additionalFormats: [{ format: 'srt' }],
    }

    if (
      Array.isArray(this.config.keyterms) &&
      this.config.keyterms.length > 0
    ) {
      payload.keyterms = this.config.keyterms
      payload.keyTerms = this.config.keyterms
    }

    return payload
  }

  private parseErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  private isAdditionalFormatsValidationError(error: unknown): boolean {
    const message = this.parseErrorMessage(error).toLowerCase()
    return (
      message.includes('additional_formats') &&
      message.includes('diarization') &&
      message.includes('timestamps')
    )
  }

  private async convertWithCompatibilityFallback(
    payload: Record<string, unknown>,
  ): Promise<ConvertResponse> {
    try {
      return (await this.client.speechToText.convert(
        payload as never,
      )) as ConvertResponse
    } catch (error) {
      if (!this.isAdditionalFormatsValidationError(error)) {
        throw error
      }

      const compatibilityPayload: Record<string, unknown> = {
        ...payload,
        diarize: true,
        timestamps: true,
        timestampsGranularity: 'word',
      }

      try {
        return (await this.client.speechToText.convert(
          compatibilityPayload as never,
        )) as ConvertResponse
      } catch (compatibilityError) {
        if (!this.isAdditionalFormatsValidationError(compatibilityError)) {
          throw compatibilityError
        }

        const noAdditionalFormatsPayload: Record<string, unknown> = {
          ...compatibilityPayload,
        }
        if (hasOwn(noAdditionalFormatsPayload, 'additionalFormats')) {
          delete noAdditionalFormatsPayload.additionalFormats
        }
        if (hasOwn(noAdditionalFormatsPayload, 'additional_formats')) {
          delete noAdditionalFormatsPayload.additional_formats
        }

        return (await this.client.speechToText.convert(
          noAdditionalFormatsPayload as never,
        )) as ConvertResponse
      }
    }
  }

  /**
   * Transcribes an audio file using ElevenLabs API
   * @param audioBlob - The audio blob to transcribe
   * @returns Structured transcription output
   */
  async transcribe(
    audioBlob: Blob,
  ): Promise<Result<TranscriptionResult, Error>> {
    try {
      const activeApiKey = this.config.apiKey || Deno.env.get('ELEVENLABS_API_KEY')

      if (!activeApiKey) {
        return {
          ok: false,
          error: new Error(
            'Missing ElevenLabs API key. Set ELEVENLABS_API_KEY or provide one in UI settings.',
          ),
        }
      }

      // Keep client in sync in case API key comes from a runtime update.
      if (this.config.apiKey !== activeApiKey) {
        this.config.apiKey = activeApiKey
        this.client = this.createClient(activeApiKey)
      }

      const payload = this.buildRequestPayload(audioBlob)
      const transcription = await this.convertWithCompatibilityFallback(payload)

      const text = this.extractTextFromResponse(transcription)

      if (!text) {
        return {
          ok: false,
          error: new Error(
            'Transcription response did not include text output.',
          ),
        }
      }

      const rawWords = Array.isArray(transcription.words)
        ? transcription.words
        : Array.isArray(transcription.word_timestamps)
        ? transcription.word_timestamps
        : Array.isArray(transcription.wordTimestamps)
        ? transcription.wordTimestamps
        : []

      const words = parseWords(rawWords)
      const additionalFormats = parseAdditionalFormats(transcription)

      return {
        ok: true,
        data: {
          text,
          words,
          additionalFormats,
          languageCode: transcription.languageCode ||
            transcription.language_code ||
            this.config.languageCode,
        },
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Error transcribing audio:', errorMessage)
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      }
    }
  }

  /**
   * Updates the transcription configuration
   * @param config - New configuration options
   */
  updateConfig(config: Partial<TranscriptionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      keyterms: config.keyterms || this.config.keyterms || [],
    }

    if (Object.prototype.hasOwnProperty.call(config, 'apiKey')) {
      const activeApiKey = this.config.apiKey || Deno.env.get('ELEVENLABS_API_KEY')
      this.client = this.createClient(activeApiKey)
    }
  }

  /**
   * Gets the current transcription configuration
   */
  getConfig(): TranscriptionConfig {
    return {
      ...this.config,
      keyterms: [...(this.config.keyterms || [])],
    }
  }
}
