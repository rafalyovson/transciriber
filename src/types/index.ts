export type SubtitleFormat = 'srt' | 'vtt'

export type TranscriptionWord = {
  text: string
  startSec: number
  endSec: number
  type?: string
  speakerId?: string
}

export type AdditionalTranscriptFormat = {
  format: string
  content: string
}

/**
 * Result from the ElevenLabs transcription API
 */
export type TranscriptionResult = {
  text: string
  words: TranscriptionWord[]
  additionalFormats: AdditionalTranscriptFormat[]
  languageCode?: string
}

/**
 * Configuration for the transcription service
 */
export type TranscriptionConfig = {
  modelId: 'scribe_v1' | 'scribe_v2'
  tagAudioEvents: boolean
  languageCode: string
  diarize: boolean
  keyterms?: string[]
  apiKey?: string
}

/**
 * Supported transcription modes
 */
export type TranscriptionMode = 'whole' | 'parts'

/**
 * Supported input media kinds
 */
export type InputMediaKind = 'audio' | 'video'

export type TranscriptionStage =
  | 'queued'
  | 'preparing_input'
  | 'extracting_audio'
  | 'transcribing_whole'
  | 'splitting'
  | 'transcribing_chunk'
  | 'combining_chunks'
  | 'generating_subtitles'
  | 'saving_output'
  | 'completed'
  | 'failed'

export type SubtitleCue = {
  index: number
  startSec: number
  endSec: number
  text: string
  lines: string[]
}

export type SubtitleQualityStatus = 'pass' | 'review_required' | 'fail'

export type SubtitleQualityReport = {
  status: SubtitleQualityStatus
  violations: string[]
  metrics: Record<string, number>
}

export type SubtitlePolicy = {
  enabled?: boolean
  strictQuality?: boolean
  profile?: string
  trackLanguageTag?: string
  maxHardViolationRatio?: number
}

export type SubtitleArtifacts = {
  generated: boolean
  formats: SubtitleFormat[]
  cueCount: number
  paths?: {
    srt?: string
    vtt?: string
  }
  contents?: {
    srt?: string
    vtt?: string
  }
  source?: 'provider' | 'local' | 'mixed'
  trackLanguageTag?: string
}

export type LanguageSubtitleProfile = {
  id: string
  name: string
  sttLanguageCode: string
  defaultTrackLanguageTag: string
  maxLinesPerCue: number
  maxCharsPerLine: number
  cpsTarget: number
  cpsHardLimit: number
  minCueDurationSec: number
  maxCueDurationSec: number
  keyterms: string[]
}

export type TranscriptionProgressEvent = {
  jobId?: string
  stage: TranscriptionStage
  message: string
  percent?: number
  modeRequested?: TranscriptionMode
  modeUsed?: TranscriptionMode
  chunkIndex?: number
  chunkTotal?: number
  partialText?: string
  timestamp: string
}

export type TranscriptionJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export type TranscriptionJobSnapshot = {
  jobId: string
  status: TranscriptionJobStatus
  progress: TranscriptionProgressEvent | null
  result?: string
  outputPath?: string
  error?: string
  modeRequested?: TranscriptionMode
  modeUsed?: TranscriptionMode
  fallbackApplied?: boolean
  warnings?: string[]
  mediaKind?: InputMediaKind
  audioExtracted?: boolean
  isComplete?: boolean
  totalChunks?: number
  successfulChunks?: number
  failedChunks?: number
  sourceDurationSec?: number
  transcribedDurationSec?: number
  coverageRatio?: number
  subtitleGenerated?: boolean
  subtitleFormats?: SubtitleFormat[]
  subtitlePaths?: { srt?: string; vtt?: string }
  subtitleCueCount?: number
  subtitleQuality?: SubtitleQualityReport
  subtitleViolationCount?: number
  subtitleQualityReportPath?: string
  subtitleContents?: { srt?: string; vtt?: string }
  subtitleTrackLanguageTag?: string
}

/**
 * Metadata about an inspected media file.
 */
export type MediaInspection = {
  filePath: string
  mediaKind: InputMediaKind
  sizeBytes: number
  durationSec: number
  hasAudio: boolean
}

/**
 * Per-chunk timing information used to verify coverage.
 */
export type AudioChunkSegment = {
  path: string
  index: number
  startSec: number
  endSec: number
  durationSec: number
}

/**
 * Environment variables structure
 */
export type EnvVars = {
  ELEVENLABS_API_KEY: string
  CHUNK_DURATION?: string
  INPUT_DIR?: string
  OUTPUT_DIR?: string
  LANGUAGE?: string
}

/**
 * Generic Result type for functional error handling
 */
export type Result<T, E = Error> =
  | { ok: true; data: T }
  | { ok: false; error: E }
