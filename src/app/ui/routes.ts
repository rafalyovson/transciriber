import { extname, join } from '@std/path'
import { exists } from '@std/fs/exists'
import { YouTubeDownloaderService } from '../../services/youtube-downloader/index.ts'
import { isSupportedUploadFile } from './utils.ts'
import type { ActiveTranscriptionRequest, RouterContext, TranscriptionApiPayload } from './types.ts'

export async function handleCreateJob(
  ctx: RouterContext,
  request: Request,
): Promise<Response> {
  try {
    if (ctx.activeJobId) {
      const active = ctx.jobs.get(ctx.activeJobId)
      if (
        active &&
        (active.snapshot.status === 'queued' ||
          active.snapshot.status === 'running')
      ) {
        return ctx.jsonResponse(
          {
            success: false,
            error: 'A transcription job is already running. Please wait for it to complete.',
            activeJobId: ctx.activeJobId,
          },
          409,
        )
      }
    }

    const requestBody = (await request.json()) as ActiveTranscriptionRequest
    const validation = await ctx.validateAndPrepareRequest(requestBody)
    if (!validation.ok) return validation.response

    const jobId = ctx.generateId()
    const record = ctx.createJobRecord(jobId)
    ctx.setActiveJobId(jobId)
    ctx.updateJobStatus(record, 'running')
    ctx.publishJobEvent(jobId, {
      jobId,
      stage: 'queued',
      message: 'Job queued. Starting transcription...',
      percent: 0,
      modeRequested: validation.modeRequested,
      modeUsed: validation.modeRequested,
      timestamp: new Date().toISOString(),
    })

    queueMicrotask(async () => {
      try {
        const apiResult = await ctx.executeTranscription(
          jobId,
          validation.filePath,
          validation.options,
          validation.modeRequested,
          validation.chunkDuration,
        )

        ctx.completeJob(
          jobId,
          apiResult,
          apiResult.success && apiResult.isComplete ? 'completed' : 'failed',
          apiResult.success && apiResult.isComplete
            ? 'Transcription completed.'
            : apiResult.error || 'Transcription failed.',
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failedPayload: TranscriptionApiPayload = {
          success: false,
          error: message,
          modeRequested: validation.modeRequested,
          modeUsed: validation.modeRequested,
          fallbackApplied: false,
          warnings: [],
          mediaKind: 'audio',
          audioExtracted: false,
          isComplete: false,
        }
        ctx.completeJob(jobId, failedPayload, 'failed', message)
      }
    })

    return ctx.jsonResponse({ success: true, jobId })
  } catch (error) {
    return ctx.jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

export async function handleDownloadYouTube(
  ctx: RouterContext,
  request: Request,
): Promise<Response> {
  try {
    const body = (await request.json()) as { url?: string }
    const url = typeof body.url === 'string' ? body.url.trim() : ''

    if (!url || !YouTubeDownloaderService.isYouTubeUrl(url)) {
      return ctx.jsonResponse(
        { success: false, error: 'Invalid or missing YouTube URL.' },
        400,
      )
    }

    const ytService = new YouTubeDownloaderService()

    const availCheck = await ytService.checkAvailability()
    if (!availCheck.ok) {
      return ctx.jsonResponse(
        { success: false, error: availCheck.error.message },
        500,
      )
    }

    const downloadResult = await ytService.downloadAudio({
      url,
      outputDir: ctx.tempDir,
    })

    if (!downloadResult.ok) {
      return ctx.jsonResponse(
        { success: false, error: downloadResult.error.message },
        500,
      )
    }

    return ctx.jsonResponse({
      success: true,
      filePath: downloadResult.data.filePath,
      originalName: `${downloadResult.data.title}.wav`,
      mimeType: 'audio/wav',
      youtubeTitle: downloadResult.data.title,
      durationSec: downloadResult.data.durationSec,
    })
  } catch (error) {
    return ctx.jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

export async function handleUploadFile(
  ctx: RouterContext,
  request: Request,
): Promise<Response> {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return ctx.jsonResponse(
        { success: false, error: 'No file found in form data' },
        400,
      )
    }

    if (!isSupportedUploadFile({ name: file.name, type: file.type })) {
      return ctx.jsonResponse(
        {
          success: false,
          error: 'Unsupported file type. Upload an audio file or an MP4 video.',
        },
        400,
      )
    }

    const originalName = file.name
    let ext = extname(originalName).toLowerCase()
    if (!ext && file.type.toLowerCase() === 'video/mp4') {
      ext = '.mp4'
    }
    const uniqueFilename = `${ctx.generateId()}${ext}`
    const filePath = join(ctx.tempDir, uniqueFilename)

    const arrayBuffer = await file.arrayBuffer()
    await Deno.writeFile(filePath, new Uint8Array(arrayBuffer))

    return ctx.jsonResponse({
      success: true,
      filePath,
      originalName,
      mimeType: file.type || '',
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    return ctx.jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

export async function handleSelectOutputFolder(
  ctx: RouterContext,
): Promise<Response> {
  try {
    let selectedFolder = ''

    if (Deno.build.os === 'darwin' || Deno.build.os === 'linux') {
      try {
        if (Deno.build.os === 'darwin') {
          const command = new Deno.Command('osascript', {
            args: [
              '-e',
              'POSIX path of (choose folder with prompt "Select Output Folder")',
            ],
          })
          const { stdout } = await command.output()
          selectedFolder = new TextDecoder().decode(stdout).trim()

          if (selectedFolder && (await exists(selectedFolder))) {
            console.log(`Selected folder: ${selectedFolder}`)
          } else {
            console.error('Selected folder does not exist or was not selected')
            selectedFolder = ''
          }
        } else {
          const command = new Deno.Command('zenity', {
            args: [
              '--file-selection',
              '--directory',
              '--title=Select Output Folder',
            ],
          })
          const { stdout } = await command.output()
          selectedFolder = new TextDecoder().decode(stdout).trim()
        }
      } catch (error) {
        console.error('Error using native dialog:', error)
        selectedFolder = Deno.cwd()
      }
    } else if (Deno.build.os === 'windows') {
      try {
        const command = new Deno.Command('powershell', {
          args: [
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms; $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog; $folderBrowser.Description = 'Select Output Folder'; $folderBrowser.ShowDialog() | Out-Null; $folderBrowser.SelectedPath`,
          ],
        })
        const { stdout } = await command.output()
        selectedFolder = new TextDecoder().decode(stdout).trim()
      } catch (error) {
        console.error('Error using native dialog:', error)
        selectedFolder = Deno.cwd()
      }
    } else {
      selectedFolder = Deno.cwd()
    }

    if (selectedFolder && (await exists(selectedFolder))) {
      if (!ctx.outputFolders.includes(selectedFolder)) {
        ctx.outputFolders.unshift(selectedFolder)
      }

      return ctx.jsonResponse({
        success: true,
        folder: selectedFolder,
        current: selectedFolder,
        folders: ctx.outputFolders,
      })
    } else {
      return ctx.jsonResponse({
        success: false,
        error: 'No folder selected',
        current: Deno.cwd(),
        folders: ctx.outputFolders,
      })
    }
  } catch (error) {
    console.error('Error selecting folder:', error)
    return ctx.jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      current: Deno.cwd(),
      folders: ctx.outputFolders,
    })
  }
}

export async function handleSetOutputFolder(
  ctx: RouterContext,
  request: Request,
): Promise<Response> {
  try {
    const data = await request.json()
    const { folder } = data

    if (await exists(folder)) {
      if (!ctx.outputFolders.includes(folder)) {
        ctx.outputFolders.unshift(folder)
      }

      if (ctx.app) {
        await ctx.app.updateOutputDir(folder)
        console.log(`Updated app output directory to: ${folder}`)
      }

      return ctx.jsonResponse({ success: true, folder })
    } else {
      return ctx.jsonResponse(
        { success: false, error: 'Folder does not exist' },
        400,
      )
    }
  } catch (error) {
    return ctx.jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

export function handleGetLanguages(ctx: RouterContext): Response {
  const languages = [
    'hy', // Armenian (default)
    'ru', // Russian
    'en', // English
  ]
  return ctx.jsonResponse(languages)
}

export function handleGetLanguageName(ctx: RouterContext, url: URL): Response {
  const params = new URLSearchParams(url.search)
  const code = params.get('code') || 'hy'

  const languageMap: Record<string, string> = {
    hy: 'Armenian',
    ru: 'Russian',
    en: 'English',
  }

  return ctx.jsonResponse({ name: languageMap[code] || code })
}

export async function handleTranscribeAudio(
  ctx: RouterContext,
  request: Request,
): Promise<Response> {
  try {
    const requestBody = (await request.json()) as ActiveTranscriptionRequest
    const validation = await ctx.validateAndPrepareRequest(requestBody)
    if (!validation.ok) return validation.response

    const result = await ctx.executeTranscription(
      undefined,
      validation.filePath,
      validation.options,
      validation.modeRequested,
      validation.chunkDuration,
    )
    return ctx.jsonResponse(result)
  } catch (error) {
    console.error('Error transcribing audio:', error)
    return ctx.jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        modeRequested: 'whole',
        modeUsed: 'whole',
        fallbackApplied: false,
        warnings: [],
        mediaKind: 'audio',
        audioExtracted: false,
        isComplete: false,
      },
      500,
    )
  }
}

export async function handleGetDefaultFolder(
  ctx: RouterContext,
): Promise<Response> {
  let defaultFolder = Deno.cwd()

  try {
    const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
    if (homeDir) {
      const downloadsPath = join(homeDir, 'Downloads')
      if (await exists(downloadsPath)) {
        defaultFolder = downloadsPath

        if (ctx.app) {
          await ctx.app.updateOutputDir(downloadsPath)
          console.log(
            `Set default output directory to Downloads: ${downloadsPath}`,
          )
        }
      }
    }
  } catch (error) {
    console.error('Error getting Downloads folder:', error)
  }

  return ctx.jsonResponse({ folder: defaultFolder, success: true })
}
