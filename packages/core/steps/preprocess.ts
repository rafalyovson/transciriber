import type { InputMediaKind } from '../types.ts'
import type { Result } from '../result.ts'
import type { EventBus, PipelineEvents } from '../events.ts'
import { MediaPreprocessorService } from '@transcriber/media-preprocessor'

export type PreprocessInput = {
  inputPath: string
  tempDir: string
  mimeTypeHint?: string
}

export type PreprocessOutput = {
  preparedFilePath: string
  mediaKind: InputMediaKind
  audioExtracted: boolean
  warnings: string[]
  cleanupPaths: string[]
}

export async function preprocessMedia(
  input: PreprocessInput,
  _bus: EventBus<PipelineEvents>,
): Promise<Result<PreprocessOutput, Error>> {
  const preprocessor = new MediaPreprocessorService()
  const result = await preprocessor.prepareInputForTranscription({
    inputPath: input.inputPath,
    tempDir: input.tempDir,
    mimeTypeHint: input.mimeTypeHint,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data }
}
