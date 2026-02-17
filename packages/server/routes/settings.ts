import { Hono } from '@hono/hono'
import { vValidator } from '@hono/valibot-validator'
import { join } from '@std/path'
import { exists } from '@std/fs/exists'
import { SetOutputFolderSchema } from '../schemas.ts'
import type { ServerDeps } from '../mod.ts'

const SUPPORTED_LANGUAGES: Record<string, string> = {
  hy: 'Armenian',
  ru: 'Russian',
  en: 'English',
}

export function settingRoutes(deps: ServerDeps) {
  const app = new Hono()

  app.get('/languages', (c) => {
    return c.json(Object.keys(SUPPORTED_LANGUAGES))
  })

  app.get('/languages/:code', (c) => {
    const code = c.req.param('code')
    return c.json({ name: SUPPORTED_LANGUAGES[code] || code })
  })

  // Get output folders
  app.get('/outputFolder', (c) => {
    return c.json({ folders: deps.outputFolders, success: true })
  })

  // Set output folder
  app.post(
    '/outputFolder',
    vValidator('json', SetOutputFolderSchema, (result, c) => {
      if (!result.success) {
        return c.json({ success: false, error: 'Invalid folder path.' }, 400)
      }
    }),
    async (c) => {
      try {
        const { folder } = c.req.valid('json')

        if (!(await exists(folder))) {
          return c.json(
            { success: false, error: 'Folder does not exist' },
            400,
          )
        }

        if (!deps.outputFolders.includes(folder)) {
          deps.outputFolders.unshift(folder)
        }

        return c.json({ success: true, folder })
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

  // Native folder picker
  app.get('/selectOutputFolder', async (c) => {
    try {
      let selectedFolder = ''

      if (Deno.build.os === 'darwin') {
        const command = new Deno.Command('osascript', {
          args: [
            '-e',
            'POSIX path of (choose folder with prompt "Select Output Folder")',
          ],
        })
        const { stdout } = await command.output()
        selectedFolder = new TextDecoder().decode(stdout).trim()
      } else if (Deno.build.os === 'linux') {
        const command = new Deno.Command('zenity', {
          args: [
            '--file-selection',
            '--directory',
            '--title=Select Output Folder',
          ],
        })
        const { stdout } = await command.output()
        selectedFolder = new TextDecoder().decode(stdout).trim()
      } else if (Deno.build.os === 'windows') {
        const command = new Deno.Command('powershell', {
          args: [
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms; $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.Description = 'Select Output Folder'; $fb.ShowDialog() | Out-Null; $fb.SelectedPath`,
          ],
        })
        const { stdout } = await command.output()
        selectedFolder = new TextDecoder().decode(stdout).trim()
      }

      if (selectedFolder && (await exists(selectedFolder))) {
        if (!deps.outputFolders.includes(selectedFolder)) {
          deps.outputFolders.unshift(selectedFolder)
        }
        return c.json({
          success: true,
          folder: selectedFolder,
          current: selectedFolder,
          folders: deps.outputFolders,
        })
      }

      return c.json({
        success: false,
        error: 'No folder selected',
        current: Deno.cwd(),
        folders: deps.outputFolders,
      })
    } catch (error) {
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        current: Deno.cwd(),
        folders: deps.outputFolders,
      })
    }
  })

  // Get default folder (Downloads)
  app.get('/defaultFolder', async (c) => {
    let defaultFolder = Deno.cwd()
    try {
      const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')
      if (homeDir) {
        const downloadsPath = join(homeDir, 'Downloads')
        if (await exists(downloadsPath)) {
          defaultFolder = downloadsPath
        }
      }
    } catch {
      // fallback to cwd
    }
    return c.json({ folder: defaultFolder, success: true })
  })

  return app
}
