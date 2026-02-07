# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Transcription mode selection (`whole` or `parts`) in UI and CLI
- Automatic fallback from `whole` to `parts` mode on recoverable size/process failures
- CLI flags: `--mode=whole|parts` and `--chunk-duration=<seconds>`
- API response metadata for mode handling (`modeRequested`, `modeUsed`, `fallbackApplied`, `warnings`)
- New tests for mode routing, fallback behavior, CLI parsing, and UI request normalization
- MP4 input support in UI and CLI via audio extraction pre-processing (`mediaKind`, `audioExtracted`)
- Media inspection service with duration/size/audio-stream detection for limit-aware routing
- Full-coverage metadata (`isComplete`, chunk counts, duration coverage, `coverageRatio`) in app/UI responses
- Live transcription job APIs with SSE streaming:
  - `POST /api/transcriptionJobs`
  - `GET /api/transcriptionJobs/:jobId/events`
  - `GET /api/transcriptionJobs/:jobId`
- Real-time stage/chunk progress events and partial transcript streaming for parts mode
- CLI live progress output with stage, percent, chunk counters, and partial chunk snippets
- Business-critical subtitle sidecar generation for video runs (`.srt` + `.vtt`)
- Subtitle metadata in app/API/SSE/CLI responses (`subtitleGenerated`, `subtitlePaths`, `subtitleCueCount`, `subtitleQuality`)
- Armenian/niche subtitle profile support with track language tags and mixed-script anomaly warnings
- New subtitle services:
  - subtitle builder with provider-first timing and deterministic local fallback
  - subtitle quality gate engine with strict/review policies
  - subtitle profile resolver for language-aware defaults and keyterm injection

### Changed
- Migrated ElevenLabs SDK from deprecated `elevenlabs` to `@elevenlabs/elevenlabs-js`
- Updated default transcription model to `scribe_v2`
- Migrated `deno.land/std` imports to `jsr:@std/*`
- Reworked frontend UI/UX into a studio dashboard with clearer workflow and status feedback
- Simplified settings to supported ElevenLabs options (removed stale local/OpenAI model controls)
- Updated README and `.env.example` to match current runtime behavior and mode options
- Added upload validation and temp-directory path hardening for `/api/transcribeAudio`
- Replaced chunk splitting strategy from `-c copy` to deterministic re-encoded WAV segmentation with CSV timing manifests
- Video inputs are now always transcribed in parts mode with default 120s chunk duration when unspecified
- Chunk processing now retries failures and aborts on exhausted retries instead of silently skipping chunks
- Web UI now uses async job + SSE flow for live progress, with fallback polling if SSE disconnects
- `/api/transcribeAudio` remains as backward-compatible synchronous wrapper
- Added subtitle generation stage to live progress events (`generating_subtitles`)
- Browser export now uses backend subtitle artifacts when available and marks fallback timing as approximate

### Fixed
- Fixed API key resolution flow between environment and UI settings
- Fixed stale dependency lock state to remove deprecated `elevenlabs` package references
- Fixed partial-transcript false positives by enforcing coverage threshold validation before success
- Fixed ElevenLabs `additional_formats` validation failures by using compatibility fallback (`diarize` + timestamps enabled, then no-additional-format fallback when required)
- Fixed subtitle strict-mode behavior to fail only on structural issues; readability-only violations now produce `review_required` with full diagnostics in `<base>.subtitle-quality.json`

## [0.2.0] - 2024-07-28

### Added
- Initial project setup with Deno 2
- TypeScript implementation of audio transcription functionality
- File service for handling audio files
- Transcription service for processing audio content
- Type definitions for project components
- Environment variable utilities
- Test suite for core functionality
- GitHub Actions workflow for CI/CD
- Project documentation (README, LICENSE, CHANGELOG)

### Changed
- Migrated from JavaScript to TypeScript
- Improved code organization with modular structure
- Enhanced error handling with functional approach
- Updated configuration for Deno 2 compatibility
- Renamed entry point from `transcribe.ts` to `main.ts` following Deno conventions
- Updated task name from `transcribe` to `start` in deno.json

### Fixed
- Removed unsupported compiler options from deno.json
- Added proper permissions for test execution

## [0.1.0] - 2024-07-25

### Added
- Initial project setup with Deno and TypeScript
- Modular architecture with separate services
- Audio file transcription using ElevenLabs API
- Combined output of all transcriptions
- Support for multiple audio formats (MP3, WAV, M4A, OGG, FLAC)
- Armenian language transcription support
- Comprehensive test suite
- GitHub Actions workflow for CI
- Project documentation
