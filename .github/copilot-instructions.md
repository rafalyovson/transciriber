# Copilot Instructions for AI Agents

## Project Overview
- **Transcriber** is a Deno-based audio transcription app with both CLI and UI modes.
- Core features: audio splitting (FFmpeg), transcription (ElevenLabs API), export in multiple formats, and modular architecture.
- Main entry: `main.ts` (dispatches to CLI or UI based on args).
- UI frontend: modular JS in `src/ui/scripts/`, HTML in `src/ui/index.html`, styles in `src/ui/styles/`.
- Services: `src/services/` (audio-splitter, file-service, transcription).
- Types: `src/types/`.
- Utilities: `src/utils/`.

## Developer Workflows
- **Run CLI**: `deno task start` or `deno task start:cli`
- **Run UI**: `deno task start:ui` (then open http://localhost:8000)
- **Dev mode (auto-reload)**: `deno task dev`, `deno task dev:ui`, or `deno task dev:cli`
- **Test**: `deno task test`
- **Format/Lint**: `deno task fmt`, `deno task lint`
- **Build executables**: `deno task build` (see README for platform-specific tasks)

## Key Patterns & Conventions
- **Service boundaries**: Each service in `src/services/` is self-contained and exposes a clear API via its `index.ts`.
- **UI/Backend bridge**: `src/ui/scripts/bridge.js` handles communication between frontend and backend.
- **State management**: Centralized in `src/ui/scripts/state.js`.
- **Settings**: API keys and config can be set via `.env` or through the UI (see `settings.js`).
- **Audio splitting**: Uses FFmpeg, invoked from Deno (see `audio-splitter`).
- **Transcription**: Integrates with ElevenLabs API (see `transcription` service).
- **Exports**: Handled in `export.js` (TXT, SRT, VTT formats).
- **Type safety**: Shared types in `src/types/`.

## Integration & Dependencies
- **Deno**: All scripts/tasks use Deno (see `deno.json`).
- **FFmpeg**: Required for audio splitting; must be installed on host.
- **ElevenLabs API**: Used for transcription; API key required.

## Examples
- To add a new export format, extend `src/ui/scripts/export.js` and update UI as needed.
- To add a new backend service, create a folder in `src/services/` and expose its API via `index.ts`.
- To add a new UI feature, add a module in `src/ui/scripts/` and wire it up in `main.js`.

## References
- See `README.md` for full usage, structure, and build/test instructions.
- See `src/app/`, `src/services/`, and `src/ui/scripts/` for main logic and extension points.
