import { extname } from '@std/path'
import type { TranscriptionResult } from '../index.ts'
import type { TranscriptionMode } from '../../types/index.ts'
import { getChunkDuration } from '../../utils/env.ts'
import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS } from './types.ts'
import type { TranscriptionApiPayload, UploadFileDescriptor } from './types.ts'

export function normalizeTranscriptionRequestOptions(
  options: Record<string, unknown> = {},
): { modeRequested: TranscriptionMode; chunkDuration: number } {
  const modeRequested: TranscriptionMode = options.transcriptionMode === 'parts' ? 'parts' : 'whole'

  const fallbackChunkDuration = getChunkDuration()
  const chunkInput = options.chunkDuration
  const chunkDuration = typeof chunkInput === 'number' &&
      Number.isFinite(chunkInput) &&
      chunkInput > 0
    ? Math.floor(chunkInput)
    : fallbackChunkDuration

  return { modeRequested, chunkDuration }
}

export function toTranscriptionApiResponse(
  result: Partial<TranscriptionResult> & { success: boolean },
  fallbackMode: TranscriptionMode,
): TranscriptionApiPayload {
  return {
    success: result.success,
    result: result.data,
    outputPath: result.outputPath,
    error: result.error,
    modeRequested: result.modeRequested || fallbackMode,
    modeUsed: result.modeUsed || fallbackMode,
    fallbackApplied: result.fallbackApplied ?? false,
    warnings: result.warnings || [],
    mediaKind: result.mediaKind === 'video' ? 'video' : 'audio',
    audioExtracted: result.audioExtracted ?? false,
    isComplete: result.isComplete ?? false,
    totalChunks: result.totalChunks,
    successfulChunks: result.successfulChunks,
    failedChunks: result.failedChunks,
    sourceDurationSec: result.sourceDurationSec,
    transcribedDurationSec: result.transcribedDurationSec,
    coverageRatio: result.coverageRatio,
    subtitleGenerated: result.subtitleGenerated,
    subtitleFormats: result.subtitleFormats,
    subtitlePaths: result.subtitlePaths,
    subtitleCueCount: result.subtitleCueCount,
    subtitleViolationCount: result.subtitleViolationCount,
    subtitleQualityReportPath: result.subtitleQualityReportPath,
    subtitleQuality: result.subtitleQuality,
    subtitleContents: result.subtitleContents,
    subtitleTrackLanguageTag: result.subtitleTrackLanguageTag,
  }
}

export function isSupportedUploadFile(file: UploadFileDescriptor): boolean {
  const extension = extname(file.name).toLowerCase()
  const mimeType = (file.type || '').trim().toLowerCase()

  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) return true
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) return true
  if (mimeType.startsWith('audio/')) return true
  if (mimeType === 'video/mp4') return true

  return false
}

export async function isPathWithinDirectory(
  targetPath: string,
  directoryPath: string,
): Promise<boolean> {
  try {
    const resolvedTargetPath = (await Deno.realPath(targetPath)).replaceAll(
      '\\',
      '/',
    )
    const resolvedDirectoryPath = (
      await Deno.realPath(directoryPath)
    ).replaceAll('\\', '/')

    if (resolvedTargetPath === resolvedDirectoryPath) return false

    const directoryPrefix = resolvedDirectoryPath.endsWith('/')
      ? resolvedDirectoryPath
      : `${resolvedDirectoryPath}/`
    return resolvedTargetPath.startsWith(directoryPrefix)
  } catch {
    return false
  }
}
