import type { MediaInspection } from '../types.ts'
import type { Result } from '../result.ts'
import type { EventBus, PipelineEvents } from '../events.ts'
import { MediaInspectorService } from '@transcriber/media-inspector'

export type InspectInput = {
  filePath: string
  mimeTypeHint?: string
}

export async function inspectMedia(
  input: InspectInput,
  _bus: EventBus<PipelineEvents>,
): Promise<Result<MediaInspection, Error>> {
  const inspector = new MediaInspectorService()
  return await inspector.inspectMedia({
    filePath: input.filePath,
    mimeTypeHint: input.mimeTypeHint,
  })
}
