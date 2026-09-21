# Changelog

All notable changes to this project are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/); releases before 0.6.0 are listed on the [GitHub Releases page](https://github.com/cliply-video/cliply-exporter/releases).

## [0.6.0] - 2026-09-21

Offcut is no longer just a clip cutter. This release keeps the original video-to-clips workflow and adds three new tools — Download, Join, and Convert — all reachable from one home screen.

### Added

- **Tool hub** — the home screen shows four tools (Download, Clips, Join, Convert) with a tab rail under the title bar to switch between them; a running download, join, or convert keeps going when you switch tabs, and its tab shows an activity dot.
- **Download** — paste a YouTube link, an 11-character video ID, or a direct media URL; shows live progress and can be canceled.
  - "Save to…" moves the finished file to a folder you choose, so no large duplicate is left behind and the library keeps working from the new location.
  - "Cut clips" and "Convert" hand the downloaded video straight to those tools.
- **Join** — add two or more videos, from a file picker, drag and drop, or your recent library, reorder them, and get one file.
  - Videos that share the same codec, encoder settings, resolution, rotation, and audio are joined with a stream copy: instant and lossless.
  - Otherwise every part is re-encoded to a common H.264/AAC shape at the largest resolution in the list, and parts without sound get a silent track so audio stays in sync.
  - The plan — fast copy or re-encode, and what differs — is shown before anything runs.
  - A re-encode can use a fixed frame rate (24, 25, 30, 50, 60); in fast-copy mode, differing frame rates show a warning that the result will have a variable frame rate.
- **Convert** — batch convert to MP4, MOV, MKV, WebM, or audio-only MP3, M4A, WAV.
  - Presets: Compatible (MP4, H.264, AAC), Light (720p, medium quality), Audio only, and Custom.
  - Custom shows every option directly, with no dropdowns: container, video codec (H.264, H.265, VP9), audio codec, max height, frame rate, and compression by quality level, target size per file, or exact bitrate.
  - Each preset reads back the output it will produce as you change options.
  - Each file shows a verdict before you run it: fast copy, audio re-encode, or full re-encode; "Remove audio" mutes any video output and on its own is still a fast copy.
  - Output goes next to each original or to a folder you pick, existing files are never overwritten, and a failed file is reported while the rest of the batch continues.
- **Recent videos as a source** — Join, Convert, and the first step of Clips list videos already in your library, so a downloaded video can be added without a file dialog; library downloads are shown by title, and unless you pick an output folder their converted files go to Downloads rather than inside the app's data folder.
- **Remove audio in Clips** — a new switch in the export drawer produces clips and reels without sound, without forcing a re-encode.
- **One-line macOS install** — offcut.cliply.video now has a single Terminal command that downloads the latest release into Applications and opens it, skipping the Gatekeeper "Open Anyway" steps.

### Changed

- **Clips** — the original three-step flow (Video → XML → Clips) is now the Clips tool; it works as before and keeps its step rail. The Clips card on the home screen starts a new video, and the Clips tab returns to the one in progress.
- **Setup** — ffprobe is now required during first-run setup, since it plans every join and convert; it downloads together with ffmpeg on macOS and Windows, and comes with the system ffmpeg package on Linux.
- **Website and README** — now describe the four tools, with an updated home screenshot.

### Fixed

- **Save full video** no longer freezes the window while a large file is copying.
- **Quitting during an export** no longer leaves ffmpeg running in the background.
- **Segmented controls** (e.g. the reel mode selector in the export drawer) no longer show a just-clicked segment as unselected until the pointer leaves it.
- **macOS Terminal installer** now resolves the download from the updater manifest, so it no longer fails with a 404 when GitHub's unauthenticated API rate limit is exhausted.

[0.6.0]: https://github.com/cliply-video/cliply-exporter/compare/v0.5.1...v0.6.0
