# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
deno task start <file-or-url>    # CLI mode
deno task start:ui               # UI server at http://localhost:8000
deno task dev                    # CLI with --watch
deno task dev:ui                 # UI with --watch
deno task test                   # Run all tests
deno task test --filter "name"   # Run tests matching filter
deno task lint                   # Lint TypeScript files
deno task fmt                    # Format TypeScript files
deno task build                  # Compile executables for all platforms
```

Run `deno task test` and `deno lint` after each iteration. Run `deno task fmt` at the end.

## Architecture

**Transcriber Studio** is a Deno/TypeScript audio/video transcription app using the ElevenLabs Scribe v2 API. It uses Deno workspaces with two modes dispatched from `main.ts`: CLI (`@transcriber/cli`) and UI (`@transcriber/server` + `packages/ui/`).

### Project structure

```
packages/
  core/           — @transcriber/core: types, Result<T,E>, EventBus, pipeline, orchestrator, steps
  server/         — @transcriber/server: Hono HTTP server, routes, JobManager, Valibot schemas
  cli/            — @transcriber/cli: CLI argument parsing and console output
  ui/             — Static frontend: Preact + HTM + Signals (served by Hono)
  services/
    transcription/       — ElevenLabs API wrapper
    audio-splitter/      — FFmpeg-based chunking for parts mode
    media-preprocessor/  — MP4 → WAV extraction
    media-inspector/     — FFprobe metadata (duration, streams)
    file-service/        — File I/O and directory management
    subtitle-builder/    — Word timestamps → SRT/VTT cues
    subtitle-quality/    — Structural/readability validation
    subtitle-profiles/   — Language-specific subtitle rules
    youtube-downloader/  — yt-dlp wrapper
```

### Core flow

`main.ts` checks for `--ui` flag → dynamically imports CLI or server module. Both use `runTranscription()` from `@transcriber/core` (orchestrator) which composes pipeline steps:

1. **inspectMedia** → detect audio/video, get duration
2. **resolveStrategy** → decide whole vs parts mode
3. **preprocessMedia** → extract audio from MP4 via FFmpeg
4. **transcribeWhole / transcribeParts** → ElevenLabs API call(s)
5. **buildSubtitles** → build SRT/VTT from word timestamps, validate quality
6. **persistOutput** → save markdown transcript + subtitle sidecars

### EventBus

Pipeline steps emit events via `EventBus<PipelineEvents>`. CLI subscribes for console output; server subscribes to push SSE events. Steps don't know who's listening.

### Server (`@transcriber/server`)

Hono HTTP server with route modules:
- `routes/jobs.ts` — `POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events` (SSE)
- `routes/files.ts` — `POST /api/files/upload`, `POST /api/files/youtube`
- `routes/settings.ts` — Languages, output folder management

Request validation via `@hono/valibot-validator` with schemas in `schemas.ts`.

### Frontend (`packages/ui/`)

Preact + HTM (no build step), loaded via import map from esm.sh CDN. State management with `@preact/signals`. Components: upload-panel, controls-panel, progress-panel, output-panel, settings-modal.

### Transcription modes

- **whole** — single API call for entire file
- **parts** — FFmpeg splits audio into chunks, transcribes each, combines results
- Video inputs are automatically routed to parts mode; whole-to-parts fallback on failure

## Code Conventions

- **Error handling**: `Result<T, E>` discriminated unions (`{ ok: true, data } | { ok: false, error }`), not thrown exceptions
- **Types**: use `type` over `interface`; shared types in `packages/core/types.ts`
- **Formatting**: single quotes, no semicolons, 2-space indent, 100-char line width
- **File naming**: kebab-case for files and directories
- **Imports**: workspace packages imported by name (e.g. `@transcriber/core`), no relative cross-package imports
- **External commands** (FFmpeg, yt-dlp): wrapped via injectable `CommandRunner` type for testability
- **Testing**: Deno built-in `Deno.test()` with `@std/assert`; services mock `CommandRunner`
- **Validation**: Valibot schemas at API boundaries (server request bodies, external API responses)

## Dependencies

- **Deno v2.0+** — runtime
- **Hono** — HTTP framework (server)
- **Valibot** — schema validation
- **Preact + HTM + Signals** — frontend (CDN, no build step)
- **FFmpeg + ffprobe** — required for MP4 extraction, parts mode, audio splitting
- **ElevenLabs API key** — required; set via `.env` (`ELEVENLABS_API_KEY`) or UI settings
- **yt-dlp** — optional; required only for YouTube URL transcription
