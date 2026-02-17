import type { TranscriptionConfig, TranscriptionResult } from '../types.ts'
import type { Result } from '../result.ts'
import type { EventBus, PipelineEvents } from '../events.ts'
import { TranscriptionService } from '@transcriber/transcription'
import { FileService } from '@transcriber/file-service'

export type TranscribeWholeInput = {
  filePath: string
  config: Partial<TranscriptionConfig>
}

export async function transcribeWhole(
  input: TranscribeWholeInput,
  _bus: EventBus<PipelineEvents>,
): Promise<Result<TranscriptionResult, Error>> {
  const fileService = new FileService()
  const service = new TranscriptionService(input.config)

  const audioResult = await fileService.readAudioFileFromPath(input.filePath)
  if (!audioResult.ok) {
    return {
      ok: false,
      error: new Error(`Failed to read audio: ${audioResult.error.message}`),
    }
  }

  return await service.transcribe(audioResult.data)
}
