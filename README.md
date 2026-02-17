# Transcriber Studio

Audio and MP4 video transcription app built with Deno and ElevenLabs Speech-to-Text.

## What Changed In This Iteration

- Migrated ElevenLabs SDK to `@elevenlabs/elevenlabs-js`.
- Default transcription model is now `scribe_v2`.
- Added transcription mode choice:
  - `whole`: transcribe entire file in one request.
  - `parts`: split with FFmpeg and transcribe chunk-by-chunk.
- Added automatic fallback from `whole` -> `parts` when whole-file transcription fails due size/process constraints.
- Reworked frontend UI/UX into a studio dashboard flow.
- Added MP4 upload support with local audio extraction before transcription.
- Added limit-aware, full-coverage enforcement for long media transcription.
- Added live web progress streaming with Server-Sent Events (SSE) and partial transcript updates for `parts` mode.
- Added production subtitle sidecar generation for video jobs (`.srt` + `.vtt`) with structural strict validation by default.
- Added Armenian-aware subtitle profile behavior (`hy`/`hyw` track tags, Unicode-safe normalization, mixed-script warnings).

## Features

- Drag-and-drop audio upload and MP4 video upload
- Language selection
- Mode selection: whole file or in parts
- Configurable chunk duration for parts mode
- Video inputs are automatically routed to parts mode for full coverage
- Output folder selection from UI
- Markdown output saved to disk
- Copy and export transcript (`.txt`) and subtitle sidecars (`.srt`, `.vtt`)
- CLI and browser UI modes
- Live web progress stages/chunk counters with polling fallback if SSE disconnects
- Subtitle quality reporting (`pass`, `review_required`, `fail`) and artifact metadata in API/CLI/UI

## Requirements

- [Deno](https://deno.com/) v2.0+
- FFmpeg + ffprobe (required for MP4 extraction, `parts` mode, and fallback mode)
- ElevenLabs API key
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (optional, required for YouTube URL transcription)

## Installation

1. Clone the repo:

```bash
git clone https://github.com/yourusername/transcriber.git
cd transcriber
```

2. Install FFmpeg:

- macOS: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`
- Windows: install from [ffmpeg.org](https://ffmpeg.org/download.html) or `choco install ffmpeg`

3. Install yt-dlp (optional, for YouTube URL support):

- pip: `pip install yt-dlp`
- macOS: `brew install yt-dlp`
- Linux: `sudo apt install yt-dlp` or `pip install yt-dlp`
- Windows: `choco install yt-dlp` or `pip install yt-dlp`

4. Create `.env` (optional but recommended):

```env
ELEVENLABS_API_KEY=your_api_key_here
INPUT_DIR=inputs
OUTPUT_DIR=outputs
LANGUAGE=hy
CHUNK_DURATION=30
```

## Usage

### Deno Tasks

```bash
# CLI
deno task start

# UI server
deno task start:ui

# Dev (watch mode)
deno task dev
deno task dev:ui
```

### CLI

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --env-file=.env main.ts [options] <media-file-or-youtube-url>
```

Options:

- `--mode=whole|parts` (default: `whole`)
- `--chunk-duration=<seconds>` (used when mode is `parts`; defaults to `CHUNK_DURATION` or `30`)

Examples:

```bash
# Whole-file transcription
deno run -A --env-file=.env main.ts ./inputs/meeting.mp3 --mode=whole

# Chunked transcription (45s chunks)
deno run -A --env-file=.env main.ts ./inputs/meeting.mp3 --mode=parts --chunk-duration=45

# MP4 video transcription (audio extracted first)
deno run -A --env-file=.env main.ts ./inputs/interview.mp4 --mode=whole

# YouTube URL transcription (requires yt-dlp)
deno run -A --env-file=.env main.ts https://www.youtube.com/watch?v=VIDEO_ID
```

### UI

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --env-file=.env main.ts --ui
```

Open <http://localhost:8000>.

Live web job endpoints:

- `POST /api/transcriptionJobs`
- `GET /api/transcriptionJobs/:jobId/events` (SSE)
- `GET /api/transcriptionJobs/:jobId`
- `POST /api/transcribeAudio` remains available as a synchronous compatibility endpoint

## API Key Behavior

The app resolves API keys in this order:

1. API key entered in UI settings
2. `ELEVENLABS_API_KEY` from environment

## Output

- Transcript is saved as Markdown in the selected output folder.
- Successful video runs also save subtitle sidecars: `<base>.srt` and `<base>.vtt`.
- The UI export menu prefers backend-generated subtitle content and only uses approximate timing when backend subtitles are unavailable.
- MP4 inputs are converted to mono 16kHz WAV before transcription, then processed with the selected mode.
- Runs include completeness metadata (`isComplete`, chunk summary, coverage ratio) and subtitle metadata (`subtitleGenerated`, `subtitlePaths`, `subtitleQuality`).

### Subtitle Quality Policy

- Video jobs must produce subtitle artifacts (`.srt` and `.vtt`) to be considered successful.
- Structural subtitle issues fail the run (invalid timings, overlap/order issues, insufficient coverage).
- Readability issues are auto-repaired when possible; remaining readability issues are reported as `review_required` and do not fail the run.
- Full diagnostics are saved to a subtitle quality report sidecar file (`<base>.subtitle-quality.json`).

## Development

### Tests

```bash
deno task test
```

### Lint and Format

```bash
deno task lint
deno task fmt
```

### Build Executables

```bash
deno task build
deno task build:macos
deno task build:macos-arm
deno task build:windows
deno task build:linux
```

## License

MIT
