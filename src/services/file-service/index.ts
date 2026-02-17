import { ensureDir } from '@std/fs/ensure-dir'
import { contentType } from '@std/media-types'
import { extname, join, parse } from '@std/path'
import { Result } from 'types'

/**
 * Service for handling file operations
 */
export class FileService {
  private readonly inputDir: string
  private outputDir: string
  private tempDir: string
  private combinedOutputFile: string

  /**
   * Creates a new FileService instance
   * Uses environment variables INPUT_DIR and OUTPUT_DIR if available
   */
  constructor() {
    // Use environment variables with fallbacks
    this.inputDir = Deno.env.get('INPUT_DIR') || join(Deno.cwd(), 'inputs')
    this.outputDir = Deno.env.get('OUTPUT_DIR') || join(Deno.cwd(), 'outputs')
    // Keep temp directory in the application directory, not in the output directory
    this.tempDir = join(Deno.cwd(), 'temp')
    this.combinedOutputFile = join(this.outputDir, 'combined_transcription.md')
  }

  /**
   * Ensures the input, output, and temp directories exist
   */
  async ensureDirectories(): Promise<void> {
    await ensureDir(this.inputDir)
    await ensureDir(this.outputDir)
    await ensureDir(this.tempDir)
  }

  /**
   * Checks if a file exists at the given path
   * @param filePath - Path to check
   * @returns True if the file exists, false otherwise
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await Deno.stat(filePath)
      return stat.isFile
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false
      }
      throw error
    }
  }

  /**
   * Sets a custom output directory
   * @param dir - New output directory path
   */
  setOutputDir(dir: string): void {
    console.log(`Setting output directory to: ${dir}`)
    this.outputDir = dir
    // Update dependent paths
    this.combinedOutputFile = join(this.outputDir, 'combined_transcription.md')
    // Don't change the temp directory location as it could cause permission issues
    // this.tempDir = join(this.outputDir, 'temp')
    // Ensure the new directory exists
    ensureDir(this.outputDir).catch((error) => {
      console.error(`Error creating output directory: ${error}`)
    })
  }

  /**
   * Gets all audio files from the input directory
   * @returns Array of audio file names
   */
  async getAudioFiles(): Promise<string[]> {
    try {
      const files: string[] = []

      for await (const entry of Deno.readDir(this.inputDir)) {
        if (entry.isFile) files.push(entry.name)
      }

      // Filter for audio files (mp3, wav, etc.)
      return files.filter((file) => {
        const ext = extname(file).toLowerCase()
        return ['.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(ext)
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error reading input directory: ${errorMessage}`)
      await this.ensureDirectories()
      return []
    }
  }

  /**
   * Reads an audio file and converts it to a Blob
   * @param fileName - Name of the audio file
   * @returns Audio blob
   */
  async readAudioFile(fileName: string): Promise<Blob> {
    const filePath = join(this.inputDir, fileName)
    const audioBuffer = await Deno.readFile(filePath)
    const mimeType = contentType(extname(filePath)) || 'application/octet-stream'

    return new Blob([audioBuffer], {
      type: mimeType,
    })
  }

  /**
   * Reads an audio file from a specific path and converts it to a Blob
   * @param filePath - Full path to the audio file
   * @returns Audio blob
   */
  async readAudioFileFromPath(filePath: string): Promise<Result<Blob, Error>> {
    try {
      const audioBuffer = await Deno.readFile(filePath)
      const mimeType = contentType(extname(filePath)) || 'application/octet-stream'

      return {
        ok: true,
        data: new Blob([audioBuffer], { type: mimeType }),
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  /**
   * Saves the transcription to a file
   * @param text - Transcription text
   * @param fileName - Original audio file name
   * @param format - Output format (txt or md)
   * @returns Path to the saved file
   */
  async saveTranscription(
    text: string,
    fileName: string,
    format = 'txt',
  ): Promise<string> {
    const baseName = parse(fileName).name
    const outputFileName = `${baseName}.${format}`
    const outputPath = join(this.outputDir, outputFileName)

    // Format the text based on the requested format
    let formattedText = text

    if (format === 'md') {
      // Format as Markdown
      formattedText = this.formatAsMarkdown(text, baseName)
    }

    await Deno.writeTextFile(outputPath, formattedText)
    console.log(`Transcription saved to: ${outputPath}`)

    return outputPath
  }

  /**
   * Saves subtitle sidecar content to the output directory.
   * @param content - Subtitle content
   * @param fileName - Original media file name
   * @param format - Subtitle format extension
   * @returns Path to the saved subtitle file
   */
  async saveSubtitle(
    content: string,
    fileName: string,
    format: 'srt' | 'vtt',
  ): Promise<string> {
    const baseName = parse(fileName).name
    const outputFileName = `${baseName}.${format}`
    const outputPath = join(this.outputDir, outputFileName)
    await Deno.writeTextFile(outputPath, content)
    return outputPath
  }

  /**
   * Saves subtitle quality diagnostics as JSON.
   * @param report - Quality diagnostics payload
   * @param fileName - Original media file name
   * @returns Path to the saved quality report
   */
  async saveSubtitleQualityReport(
    report: Record<string, unknown>,
    fileName: string,
  ): Promise<string> {
    const baseName = parse(fileName).name
    const outputFileName = `${baseName}.subtitle-quality.json`
    const outputPath = join(this.outputDir, outputFileName)
    await Deno.writeTextFile(outputPath, JSON.stringify(report, null, 2))
    return outputPath
  }

  /**
   * Formats transcription text as Markdown
   * @param text - Raw transcription text
   * @param title - Title for the Markdown document
   * @returns Formatted Markdown text
   */
  private formatAsMarkdown(text: string, title: string): string {
    // Create a title from the filename
    const formattedTitle = title
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())

    // Format the text as Markdown
    let markdown = `# Transcription: ${formattedTitle}\n\n`

    // Add timestamp
    const now = new Date()
    markdown += `*Transcribed on ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}*\n\n`

    // Add the transcription text, ensuring paragraphs are properly formatted
    const paragraphs = text.split('\n\n')

    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        markdown += `${paragraph.trim()}\n\n`
      }
    }

    return markdown
  }

  /**
   * Combines all individual transcriptions into a single markdown file
   * @param transcriptions - Map of filename to transcription text
   */
  async combineTranscriptions(
    transcriptions: Map<string, string>,
  ): Promise<void> {
    if (transcriptions.size === 0) {
      console.log('No transcriptions to combine')
      return
    }

    // Sort the transcriptions by filename to maintain order
    const sortedEntries = [...transcriptions.entries()].sort()

    // Create markdown content
    let markdownContent = '# Transcription\n\n'

    for (const [fileName, text] of sortedEntries) {
      markdownContent += `## ${fileName}\n\n${text}\n\n`
    }

    // Write the combined file
    await Deno.writeTextFile(this.combinedOutputFile, markdownContent)
    console.log(`Combined transcription saved to: ${this.combinedOutputFile}`)
  }

  /**
   * Combines chunk transcriptions into a single text
   * @param chunkTranscriptions - Array of chunk transcriptions in order
   * @returns Combined transcription text
   */
  combineChunkTranscriptions(chunkTranscriptions: string[]): string {
    return chunkTranscriptions.join(' ')
  }

  /**
   * Gets the full path to the input file
   * @param fileName - Name of the input file
   * @returns Full path to the input file
   */
  getInputFilePath(fileName: string): string {
    return join(this.inputDir, fileName)
  }

  /**
   * Gets the temp directory path
   * @returns Path to the temp directory
   */
  getTempDir(): string {
    return this.tempDir
  }

  /**
   * Cleans up temporary files
   */
  async cleanupTempFiles(): Promise<void> {
    try {
      for await (const entry of Deno.readDir(this.tempDir)) {
        if (entry.isFile) {
          await Deno.remove(join(this.tempDir, entry.name))
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error)
    }
  }
}
