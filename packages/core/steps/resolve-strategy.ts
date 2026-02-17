import type { MediaInspection, TranscriptionMode, TranscriptionStrategy } from '../types.ts'
import { exceedsElevenLabsHardLimits } from '@transcriber/media-inspector'

const FORCED_VIDEO_CHUNK_DURATION_SEC = 120

export type StrategyInput = {
  inspection: MediaInspection
  requestedMode: TranscriptionMode
  chunkDuration: number
  chunkDurationProvided: boolean
}

export type StrategyOutput = {
  strategy: TranscriptionStrategy
  warnings: string[]
}

export function resolveStrategy(input: StrategyInput): StrategyOutput {
  const { inspection, requestedMode, chunkDuration, chunkDurationProvided } = input
  const warnings: string[] = []
  let mode: TranscriptionMode = requestedMode
  let resolvedChunkDuration = chunkDuration

  if (inspection.mediaKind === 'video' && mode !== 'parts') {
    mode = 'parts'
    warnings.push(
      'Video inputs are always transcribed in parts mode to guarantee full coverage.',
    )
  }

  if (exceedsElevenLabsHardLimits(inspection) && mode !== 'parts') {
    mode = 'parts'
    warnings.push(
      'Input exceeds single-request hard limits (3GB or 10h). Automatically switching to parts mode.',
    )
  }

  if (mode === 'parts' && inspection.mediaKind === 'video' && !chunkDurationProvided) {
    resolvedChunkDuration = FORCED_VIDEO_CHUNK_DURATION_SEC
  }

  if (mode === 'whole') {
    return { strategy: { kind: 'whole' }, warnings }
  }

  return {
    strategy: { kind: 'parts', chunkDuration: resolvedChunkDuration },
    warnings,
  }
}
