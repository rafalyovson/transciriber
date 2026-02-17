import * as v from '@valibot/valibot'

export const CreateJobSchema = v.object({
  filePath: v.string(),
  language: v.optional(v.string(), 'en'),
  mode: v.optional(v.picklist(['whole', 'parts']), 'whole'),
  chunkDuration: v.optional(v.pipe(v.number(), v.integer(), v.minValue(10)), 30),
  outputFileName: v.optional(v.string()),
  apiKey: v.optional(v.string()),
  subtitleOptions: v.optional(v.object({
    enabled: v.optional(v.boolean()),
    strictQuality: v.optional(v.boolean()),
    profile: v.optional(v.string()),
    trackLanguageTag: v.optional(v.string()),
    maxHardViolationRatio: v.optional(v.number()),
    keyterms: v.optional(v.array(v.string())),
  })),
})

export type CreateJobInput = v.InferOutput<typeof CreateJobSchema>

export const DownloadYouTubeSchema = v.object({
  url: v.pipe(v.string(), v.url()),
})

export const SetOutputFolderSchema = v.object({
  folder: v.string(),
})
