import { Hono } from '@hono/hono'
import { vValidator } from '@hono/valibot-validator'
import { extname, join, parse } from '@std/path'
import { exists } from '@std/fs/exists'
import { YouTubeDownloaderService } from '@transcriber/youtube-downloader'
import { MediaPreprocessorService } from '@transcriber/media-preprocessor'
import { DownloadYouTubeSchema, ExtractAudioSchema } from '../schemas.ts'
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

  // Extract audio to MP3
  app.post(
    '/extract-audio',
    vValidator('json', ExtractAudioSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { success: false, error: 'Invalid request. filePath is required.' },
          400,
        )
      }
    }),
    async (c) => {
      try {
        const { filePath, originalFileName, outputFolder, youtubeUrl } = c.req.valid('json')

        const targetFolder = outputFolder || deps.outputFolders[0] || Deno.cwd()
        if (!(await exists(targetFolder))) {
          return c.json(
            { success: false, error: 'Output folder does not exist.' },
            400,
          )
        }

        const baseName = originalFileName
          ? parse(originalFileName).name
          : filePath
          ? parse(filePath).name
          : ''

        // YouTube source: download directly as MP3 via yt-dlp (no intermediate WAV)
        if (youtubeUrl && YouTubeDownloaderService.isYouTubeUrl(youtubeUrl)) {
          const ytService = new YouTubeDownloaderService()
          const availCheck = await ytService.checkAvailability()
          if (!availCheck.ok) {
            return c.json(
              { success: false, error: availCheck.error.message },
              500,
            )
          }

          const downloadResult = await ytService.downloadAudio({
            url: youtubeUrl,
            outputDir: targetFolder,
            format: 'mp3',
          })

          if (!downloadResult.ok) {
            return c.json(
              { success: false, error: downloadResult.error.message },
              500,
            )
          }

          // Use original name, or video title from yt-dlp
          const ytBaseName = baseName || downloadResult.data.title || 'youtube-audio'
          const finalPath = join(targetFolder, `${ytBaseName}.mp3`)
          if (downloadResult.data.filePath !== finalPath) {
            try {
              await Deno.rename(downloadResult.data.filePath, finalPath)
            } catch {
              // If rename fails (e.g. cross-device), keep the yt-dlp output as-is
              return c.json({
                success: true,
                outputPath: downloadResult.data.filePath,
                fileName: downloadResult.data.filePath.split('/').pop(),
              })
            }
          }

          return c.json({
            success: true,
            outputPath: finalPath,
            fileName: `${ytBaseName}.mp3`,
          })
        }

        // Local file: extract audio via FFmpeg
        if (!(await exists(filePath))) {
          return c.json(
            {
              success: false,
              error: 'Source file not found. Please upload a file first.',
            },
            400,
          )
        }

        const outputPath = join(targetFolder, `${baseName}.mp3`)
        const preprocessor = new MediaPreprocessorService()
        const result = await preprocessor.extractAudioToMp3(
          filePath,
          outputPath,
        )

        if (!result.ok) {
          return c.json({ success: false, error: result.error.message }, 500)
        }

        return c.json({
          success: true,
          outputPath: result.data.outputPath,
          fileName: `${baseName}.mp3`,
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
