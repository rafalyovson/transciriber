import type {
  InputMediaKind,
  SubtitleArtifacts,
  SubtitleQualityReport,
  TranscriptionMode,
} from '../types.ts'
import type { Result } from '../result.ts'
import { FileService } from '@transcriber/file-service'

export type PersistInput = {
  text: string
  outputFileName: string
  outputDir?: string
  artifacts?: SubtitleArtifacts
  quality?: SubtitleQualityReport
  qualityWarnings?: string[]
  modeRequested: TranscriptionMode
  modeUsed: TranscriptionMode
  mediaKind: InputMediaKind
}

export type PersistOutput = {
  outputPath: string
  subtitlePaths?: { srt?: string; vtt?: string }
  qualityReportPath?: string
}

export async function persistOutput(
  input: PersistInput,
): Promise<Result<PersistOutput, Error>> {
  try {
    const fileService = new FileService()

    if (input.outputDir) {
      fileService.setOutputDir(input.outputDir)
    }

    const outputPath = await fileService.saveTranscription(
      input.text,
      input.outputFileName,
      'md',
    )

    let subtitlePaths: { srt?: string; vtt?: string } | undefined
    if (input.artifacts?.contents) {
      const paths: { srt?: string; vtt?: string } = {}
      if (input.artifacts.contents.srt) {
        paths.srt = await fileService.saveSubtitle(
          input.artifacts.contents.srt,
          input.outputFileName,
          'srt',
        )
      }
      if (input.artifacts.contents.vtt) {
        paths.vtt = await fileService.saveSubtitle(
          input.artifacts.contents.vtt,
          input.outputFileName,
          'vtt',
        )
      }
      subtitlePaths = paths
    }

    let qualityReportPath: string | undefined
    if (input.quality) {
      qualityReportPath = await fileService.saveSubtitleQualityReport(
        {
          createdAt: new Date().toISOString(),
          quality: input.quality,
          warnings: input.qualityWarnings || [],
          artifacts: input.artifacts
            ? {
              generated: input.artifacts.generated,
              formats: input.artifacts.formats,
              cueCount: input.artifacts.cueCount,
              source: input.artifacts.source,
              trackLanguageTag: input.artifacts.trackLanguageTag,
              paths: subtitlePaths,
            }
            : undefined,
          modeRequested: input.modeRequested,
          modeUsed: input.modeUsed,
          mediaKind: input.mediaKind,
        },
        input.outputFileName,
      )
    }

    return { ok: true, data: { outputPath, subtitlePaths, qualityReportPath } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new Error(message) }
  }
}
