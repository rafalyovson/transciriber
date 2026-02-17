import type { TranscriptionStage } from './types.ts'
import type { Result } from './result.ts'
import { err } from './result.ts'
import type { EventBus, PipelineEvents } from './events.ts'

export type PipelineStep<In, Out> = {
  name: string
  stage: TranscriptionStage
  run: (input: In, bus: EventBus<PipelineEvents>) => Promise<Result<Out, Error>>
}

export async function runStep<In, Out>(
  step: PipelineStep<In, Out>,
  input: In,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Promise<Result<Out, Error>> {
  bus.emit('progress', {
    jobId,
    stage: step.stage,
    message: `Starting ${step.name}...`,
    timestamp: new Date().toISOString(),
  })

  const result = await step.run(input, bus)

  if (!result.ok) {
    bus.emit('progress', {
      jobId,
      stage: 'failed',
      message: result.error.message,
      timestamp: new Date().toISOString(),
    })
  }

  return result
}

export async function runPipeline<A, B, C>(
  steps: [PipelineStep<A, B>, PipelineStep<B, C>],
  input: A,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Promise<Result<C, Error>>
export async function runPipeline<A, B, C, D>(
  steps: [PipelineStep<A, B>, PipelineStep<B, C>, PipelineStep<C, D>],
  input: A,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Promise<Result<D, Error>>
export async function runPipeline(
  steps: PipelineStep<unknown, unknown>[],
  input: unknown,
  bus: EventBus<PipelineEvents>,
  jobId?: string,
): Promise<Result<unknown, Error>> {
  let current = input
  for (const step of steps) {
    const result = await runStep(step, current, bus, jobId)
    if (!result.ok) return err(result.error)
    current = result.data
  }
  return { ok: true, data: current }
}
