import { Hono } from '@hono/hono'
import { vValidator } from '@hono/valibot-validator'
import { extname, join } from '@std/path'
import { YouTubeDownloaderService } from '@transcriber/youtube-downloader'
import { DownloadYouTubeSchema } from '../schemas.ts'
import type { ServerDeps } from '../mod.ts'

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.flac',
  '.aac',
  '.webm',
])
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4'])
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024 // 3 GB (ElevenLabs hard limit)

function isSupportedFile(name: string, mimeType: string): boolean {
  const ext = extname(name).toLowerCase()
  if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) return true
  if (SUPPORTED_VIDEO_EXTENSIONS.has(ext)) return true
  if (mimeType.startsWith('audio/')) return true
  if (mimeType === 'video/mp4') return true
  return false
}

export function fileRoutes(deps: ServerDeps) {
  const app = new Hono()

  // Upload file
  app.post('/upload', async (c) => {
    try {
      const body = await c.req.parseBody()
      const file = body['file']

      if (!file || !(file instanceof File)) {
        return c.json(
          { success: false, error: 'No file found in form data' },
          400,
        )
      }

      if (!isSupportedFile(file.name, file.type || '')) {
        return c.json(
          {
            success: false,
            error: 'Unsupported file type. Upload an audio file or MP4 video.',
          },
          400,
        )
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(0)
        return c.json(
          {
            success: false,
            error: `File too large (${sizeMB} MB). Maximum is 3 GB.`,
          },
          413,
        )
      }

      let ext = extname(file.name).toLowerCase()
      if (!ext && (file.type || '').toLowerCase() === 'video/mp4') ext = '.mp4'

      const uniqueFilename = `${deps.generateId()}${ext}`
      const filePath = join(deps.tempDir, uniqueFilename)
      const arrayBuffer = await file.arrayBuffer()
      await Deno.writeFile(filePath, new Uint8Array(arrayBuffer))

      return c.json({
        success: true,
        filePath,
        originalName: file.name,
        mimeType: file.type || '',
      })
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    }
  })

  // Download from YouTube
  app.post(
    '/youtube',
    vValidator('json', DownloadYouTubeSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { success: false, error: 'Invalid or missing YouTube URL.' },
          400,
        )
      }
    }),
    async (c) => {
      try {
        const { url } = c.req.valid('json')

        if (!YouTubeDownloaderService.isYouTubeUrl(url)) {
          return c.json({ success: false, error: 'Invalid YouTube URL.' }, 400)
        }

        const ytService = new YouTubeDownloaderService()
        const availCheck = await ytService.checkAvailability()
        if (!availCheck.ok) {
          return c.json(
            { success: false, error: availCheck.error.message },
            500,
          )
        }

        const downloadResult = await ytService.downloadAudio({
          url,
          outputDir: deps.tempDir,
        })

        if (!downloadResult.ok) {
          return c.json(
            { success: false, error: downloadResult.error.message },
            500,
          )
        }

        return c.json({
          success: true,
          filePath: downloadResult.data.filePath,
          originalName: `${downloadResult.data.title}.wav`,
          mimeType: 'audio/wav',
          youtubeTitle: downloadResult.data.title,
          durationSec: downloadResult.data.durationSec,
        })
      } catch (error) {
        return c.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        )
      }
    },
  )

  return app
}
