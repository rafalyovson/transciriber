import { Hono } from '@hono/hono'
import { streamSSE } from '@hono/hono/streaming'
import { vValidator } from '@hono/valibot-validator'
import { createEventBus, runTranscription, type TranscriptionOutput } from '@transcriber/core'
import { CreateJobSchema } from '../schemas.ts'
import type { ServerDeps } from '../mod.ts'

export function jobRoutes(deps: ServerDeps) {
  const app = new Hono()

  // Create a new transcription job
  app.post(
    '/',
    vValidator('json', CreateJobSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { success: false, errors: result.issues.map((i) => i.message) },
          400,
        )
      }
    }),
    (c) => {
      const body = c.req.valid('json')

      if (deps.activeJobId) {
        const active = deps.jobs.get(deps.activeJobId)
        if (
          active &&
          (active.snapshot.status === 'queued' ||
            active.snapshot.status === 'running')
        ) {
          return c.json(
            {
              success: false,
              error: 'A transcription job is already running.',
              activeJobId: deps.activeJobId,
            },
            409,
          )
        }
      }

      const jobId = deps.generateId()
      deps.jobs.create(jobId)
      deps.activeJobId = jobId
      deps.jobs.updateStatus(jobId, 'running')

      // Publish initial event
      deps.jobs.publish(jobId, {
        jobId,
        stage: 'queued',
        message: 'Job queued. Starting transcription...',
        percent: 0,
        modeRequested: body.mode,
        modeUsed: body.mode,
        timestamp: new Date().toISOString(),
      })

      // Run transcription asynchronously
      queueMicrotask(async () => {
        try {
          const bus = createEventBus()

          // Forward events to job subscribers
          bus.on('progress', (event) => {
            deps.jobs.publish(jobId, { ...event, jobId })
          })

          const config = {
            languageCode: body.language,
            apiKey: body.apiKey,
          }

          const result = await runTranscription(
            body.filePath,
            config,
            {
              mode: body.mode,
              chunkDuration: body.chunkDuration,
              outputFileName: body.outputFileName,
              subtitleOptions: body.subtitleOptions,
              jobId,
            },
            bus,
          )

          deps.jobs.complete(
            jobId,
            result,
            result.success && result.isComplete ? 'completed' : 'failed',
            result.success && result.isComplete
              ? 'Transcription completed.'
              : result.error || 'Transcription failed.',
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const failedResult: TranscriptionOutput = {
            success: false,
            error: message,
            modeRequested: body.mode,
            modeUsed: body.mode,
            fallbackApplied: false,
            warnings: [],
            mediaKind: 'audio',
            audioExtracted: false,
            isComplete: false,
          }
          deps.jobs.complete(jobId, failedResult, 'failed', message)
        } finally {
          deps.activeJobId = null
        }
      })

      return c.json({ success: true, jobId })
    },
  )

  // Get job snapshot
  app.get('/:id', (c) => {
    const job = deps.jobs.get(c.req.param('id'))
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json(job.snapshot)
  })

  // SSE event stream
  app.get('/:id/events', (c) => {
    const jobId = c.req.param('id')
    const job = deps.jobs.get(jobId)
    if (!job) return c.json({ error: 'Job not found' }, 404)

    return streamSSE(c, async (stream) => {
      // Send current snapshot
      await stream.writeSSE({
        data: JSON.stringify(job.snapshot),
        event: 'snapshot',
      })

      const unsubscribe = deps.jobs.subscribe(jobId, (event) => {
        stream.writeSSE({
          data: JSON.stringify(event),
          event: 'progress',
        })
      })

      try {
        // Heartbeat loop
        while (true) {
          await stream.sleep(15_000)
          await stream.writeSSE({ data: '', event: 'heartbeat' })
        }
      } finally {
        unsubscribe()
      }
    })
  })

  return app
}
