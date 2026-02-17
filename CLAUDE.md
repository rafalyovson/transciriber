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

**Transcriber Studio** is a Deno/TypeScript audio/video transcription app using the ElevenLabs Scribe v2 API. It has two modes dispatched from `main.ts`: CLI (`src/app/cli/`) and UI (`src/app/ui/`).

### Core flow

`main.ts` checks for `--ui` flag → dynamically imports CLI or UI module. Both modes use `TranscriptionApp` (`src/app/index.ts`) which orchestrates the pipeline:

1. **Media inspection** → detect audio/video, get duration
2. **Preprocessing** → extract audio from MP4 via FFmpeg (or download from YouTube via yt-dlp)
3. **Transcription** → ElevenLabs API call (whole file or chunked)
4. **Subtitle generation** → build SRT/VTT from word timestamps, validate quality
5. **Output** → save markdown transcript + subtitle sidecars

### Service layer (`src/services/`)

Each service is a self-contained module with its own `index.ts` and `test.ts`. Services do not depend on each other — all composition happens in `TranscriptionApp`.

- **transcription/** — ElevenLabs API wrapper
- **audio-splitter/** — FFmpeg-based chunking for parts mode
- **media-preprocessor/** — MP4 → WAV extraction (uses `CommandRunner` type for testability)
- **media-inspector/** — FFprobe metadata (duration, streams)
- **file-service/** — file I/O and directory management
- **subtitle-builder/** — word timestamps → SRT/VTT cues
- **subtitle-quality/** — structural/readability validation (pass/review_required/fail)
- **subtitle-profiles/** — language-specific subtitle rules (Armenian, Russian, English)
- **youtube-downloader/** — yt-dlp wrapper, follows same `CommandRunner` pattern

### UI architecture

Backend (`src/app/ui/index.ts`): HTTP server with REST API + SSE for live progress. Key endpoints: `POST /api/uploadFile`, `POST /api/downloadYouTube`, `POST /api/transcriptionJobs`, `GET /api/transcriptionJobs/:id/events`.

Frontend (`src/ui/`): vanilla JS with ES modules. State management in `scripts/state.js`, backend communication via `scripts/bridge.js`, DOM refs in `scripts/dom-elements.js`.

### Transcription modes

- **whole** — single API call for entire file
- **parts** — FFmpeg splits audio into chunks, transcribes each, combines results
- Video inputs are automatically routed to parts mode; whole-to-parts fallback on failure

## Code Conventions

- **Error handling**: `Result<T, E>` discriminated unions (`{ ok: true, data } | { ok: false, error }`), not thrown exceptions
- **Types**: use `type` over `interface`; shared types in `src/types/index.ts` (import alias: `types`)
- **Formatting**: single quotes, no semicolons, 2-space indent, 100-char line width
- **File naming**: kebab-case for files and directories
- **External commands** (FFmpeg, yt-dlp): wrapped via injectable `CommandRunner` type for testability
- **Testing**: Deno built-in `Deno.test()` with `@std/assert`; services mock `CommandRunner`

## Dependencies

- **Deno v2.0+** — runtime
- **FFmpeg + ffprobe** — required for MP4 extraction, parts mode, audio splitting
- **ElevenLabs API key** — required; set via `.env` (`ELEVENLABS_API_KEY`) or UI settings
- **yt-dlp** — optional; required only for YouTube URL transcription
