import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { serveStatic } from '@hono/hono/deno'
import { ensureDir } from '@std/fs/ensure-dir'
import { join } from '@std/path'
import { jobRoutes } from './routes/jobs.ts'
import { fileRoutes } from './routes/files.ts'
import { settingRoutes } from './routes/settings.ts'
import { JobManager } from './jobs.ts'

export type ServerDeps = {
  tempDir: string
  outputFolders: string[]
  activeJobId: string | null
  jobs: JobManager
  generateId: () => string
}

export function createApp(deps: ServerDeps) {
  const app = new Hono()

  app.use('*', logger())

  app.route('/api/jobs', jobRoutes(deps))
  app.route('/api/files', fileRoutes(deps))
  app.route('/api/settings', settingRoutes(deps))

  app.get('*', serveStatic({ root: './packages/ui' }))

  return app
}

async function discoverOutputFolders(): Promise<string[]> {
  const folders: string[] = []
  const homeDir = Deno.env.get('HOME') || Deno.env.get('USERPROFILE')

  if (homeDir) {
    for (const name of ['Downloads', 'Documents', 'Desktop']) {
      const path = join(homeDir, name)
      try {
        const stat = await Deno.stat(path)
        if (stat.isDirectory) folders.push(path)
      } catch {
        // skip
      }
    }
  }

  folders.push(Deno.cwd())
  return folders
}

export async function startServer(port = 8000): Promise<void> {
  const tempDir = join(Deno.cwd(), 'temp')
  await ensureDir(tempDir)

  const outputFolders = await discoverOutputFolders()

  const deps: ServerDeps = {
    tempDir,
    outputFolders,
    activeJobId: null,
    jobs: new JobManager(),
    generateId: () => crypto.randomUUID().replaceAll('-', ''),
  }

  const app = createApp(deps)

  console.log(`Transcriber Studio UI running at http://localhost:${port}`)
  Deno.serve({ port }, app.fetch)
}
