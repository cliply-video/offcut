# OSS Clip Cutter — Implementation Plan

*Note: this product has since been renamed **Offcut** (repo and bundle id unchanged). This doc is kept as historical record.*

> Status: Draft · 2026-06-15

---

## 1. Overview & Goals

**What it is:** A standalone, fully offline, open-source desktop app for sports analysts. Paste a YouTube URL → download → import a SportsCode/Nacsport XML → get a colored clip list → export MP4s (individual clips, folder-per-tag, per-tag reels).

**What it is not (v1 non-goals):**

- No SaaS, auth, organizations, or cloud sync of any kind
- No telestration / drawing tools
- No manual clip creation or trim editing (clips come from XML only)
- No manual tagging UI (tag types and colors come from XML `<ROWS>`)
- No telemetry or analytics
- No local-file video import (YouTube-only v1; deferred to v2)

**Why a shared extraction, not a fork:** The core Rust logic (ffmpeg cut/reel/poster, yt-dlp download, binary resolution) and the TS XML parser are already battle-tested in cliply. Duplicating them creates two maintenance surfaces. Instead, extract into shared packages that both cliply desktop and the new OSS app consume. cliply gets cleaner internals; OSS app gets proven code on day one.

**Repo layout (LOCKED — layout B):** The OSS app lives in its **own new public repo** (`~/Development/clip-cutter`), separate from the private `cliply` repo, from day one — clean OSS history, no later split. The shared code (`clip-core` crate + `@cliply/xml` package) is **extracted within the cliply repo** (so cliply keeps consuming it via in-repo **path dep**). The OSS app consumes the shared code as a **git dependency** (Cargo `git=`, npm git/tarball) until the packages are published (P4). This is the develop-clean path; we explicitly rejected develop-in-cliply-then-split.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  cliply-clip-core  (Rust workspace crate, MIT/Apache-2.0)            │
│  ─────────────────────────────────────────────────────               │
│  ffmpeg_cut()  ffmpeg_reel()  ffmpeg_poster()                        │
│  yt_dlp_download()  resolve_ffmpeg()  resolve_ytdlp()                │
│  SHA256 verify, cache-dir, progress channel                          │
│  NO SaaS coupling (no HTTP calls to cliply API, no auth)             │
└────────────────┬─────────────────────────────┬───────────────────────┘
        cargo PATH dep (in-repo)        cargo GIT dep (cross-repo)
     ┌───────────▼────────────┐   ┌────────────▼───────────────────────┐
     │  cliply desktop        │   │  clip-cutter (NEW, OWN REPO)       │
     │  [cliply repo]         │   │  ~/Development/clip-cutter         │
     │  desktop/src-tauri/    │   │  src-tauri/                        │
     │  (existing, refactored)│   │  Tauri v2, SQLite (local only)     │
     │  SaaS sync, stream,    │   │  No org/auth/sync                  │
     │  capture, etc.         │   │                                    │
     └───────────┬────────────┘   └────────────┬───────────────────────┘
        npm WORKSPACE (in-repo)         npm GIT/tarball dep (cross-repo)
     ┌───────────▼────────────────────────────▼───────────────────────┐
     │  @cliply/xml  (TS package, MIT/Apache-2.0)                      │
     │  ───────────────────────────────────────────────────────────    │
     │  parseSportXml()  readXmlFile()  ClipRow  TagType  TagVariant  │
     │  colorFromXml() (R,G,B 0-65535 → CSS hex)                      │
     └────────────────────────────────────────────────────────────────┘
```

### What moves where

#### `cliply-clip-core` (Rust crate)

Extracted from `desktop/src-tauri/src/`:

| Source file | Functions to extract |
|---|---|
| `ffmpeg.rs` | `resolve_ffmpeg()`, SHA verify, cache-dir, managed-download (replacing private S3 with public URLs) |
| `download.rs` | `yt_dlp_download()`, progress parsing, `resolve_ytdlp()` |
| `export.rs` | `ffmpeg_cut()`, `ffmpeg_reel()`, `ffmpeg_poster()`, export dir layout logic |

Stays in cliply desktop only (not extracted):
- `capture.rs` (screen capture — cliply-specific)
- `sync.rs` (cloud sync — SaaS-specific)
- `stream.rs` (Cloudflare Stream — SaaS-specific)
- `optimize.rs` (cliply-specific optimize flow)
- `logs.rs` (can stay per-app)

The crate is a pure Rust library (no Tauri types). It lives in the cliply repo at `crates/clip-core/`. cliply desktop depends on it via **path** (`../../crates/clip-core`); the OSS app depends on it via **git** until it's published to crates.io.

> ⚠️ **Catch with layout B:** a git dep pointing at the **private** cliply repo only resolves for maintainers with repo access — external OSS contributors can't `cargo build`. Resolve one of two ways: **(a) publish `clip-core` to crates.io and `@cliply/xml` to npm early (by end of P1)** so the OSS app pins published versions — cleanest; or **(b)** host the shared packages in their own **public** repo that both cliply and OSS consume. Recommendation: **(a)** — publish early, treat the shared packages as the first OSS deliverable. See §7.

#### `@cliply/xml` (TypeScript package)

Extracted from `components/analytics/xml.ts`:

- `parseSportXml(xmlString): ParsedXml` — instances → clips, rows → tag types
- `readXmlFile(path): Promise<string>` — BOM sniffing (UTF-8, UTF-16 LE/BE)
- Type exports: `ClipRow`, `TagType`, `TagVariant`, color mapping util

It lives in the cliply repo at `packages/xml/`. cliply imports it as an in-repo **npm workspace**; the OSS app consumes it via **git/tarball** until published to npm as `@cliply/xml` (same publish-early caveat as the Rust crate — see §7).

---

## 3. Data Model

**Recommendation: SQLite with Tauri sql plugin (same as cliply desktop), single local DB per session, no migrations on first run needed — just CREATE TABLE IF NOT EXISTS.**

Rationale: in-memory/JSON would lose state on crash and makes poster/thumbnail caching harder. SQLite is already wired in Tauri v2.

### Tables

```sql
-- one row per downloaded/imported video
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,   -- uuid
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,      -- original YouTube URL
  local_path  TEXT NOT NULL,      -- absolute path to downloaded .mp4
  created_at  INTEGER NOT NULL    -- unix ms
);

-- tag types parsed from <ROWS>
CREATE TABLE IF NOT EXISTS tag_types (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,      -- <code> value
  label       TEXT NOT NULL,      -- display name (same as key in XML)
  color       TEXT NOT NULL,      -- CSS hex, converted from R/G/B 0-65535
  pre_sec     REAL NOT NULL DEFAULT 3.0,
  post_sec    REAL NOT NULL DEFAULT 5.0,
  row_top     INTEGER NOT NULL DEFAULT 0  -- 0=bottom, 1=top (from <row> position)
);

-- tag qualifiers from <label group="Flags">
CREATE TABLE IF NOT EXISTS tag_variants (
  id          TEXT PRIMARY KEY,
  tag_type_id TEXT NOT NULL REFERENCES tag_types(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  color       TEXT,               -- optional override
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- clips parsed from <ALL_INSTANCES>
CREATE TABLE IF NOT EXISTS clips (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_type_id TEXT REFERENCES tag_types(id),
  name        TEXT,               -- optional, from <label> text
  t_sec       REAL NOT NULL,      -- trigger time (start of instance)
  start_sec   REAL NOT NULL,      -- t_sec - pre_sec
  end_sec     REAL NOT NULL,      -- t_sec + post_sec (or <end> from XML)
  is_manual   INTEGER NOT NULL DEFAULT 0,
  is_open     INTEGER NOT NULL DEFAULT 0,
  poster_path TEXT                -- cached frame, filled post-export
);

-- many-to-many clip ↔ variant
CREATE TABLE IF NOT EXISTS clip_variants (
  clip_id    TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES tag_variants(id) ON DELETE CASCADE,
  PRIMARY KEY (clip_id, variant_id)
);
```

Constraint enforced in Rust before insert: `end_sec > start_sec`.

**No org_id, no user_id, no session tokens anywhere in this schema.**

---

## 4. Binary Management

### Strategy

Auto-download on first run from official public sources, SHA256-verify, cache in Tauri `app_data_dir()/bins/`. Expose env override (`FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH`) for power users. No bundling — avoids GPL-linked redistribution of ffmpeg and avoids DMG bloat (~70 MB for ffmpeg).

### Platform matrix

| Platform | ffmpeg source | yt-dlp source |
|---|---|---|
| macOS arm64 | [evermeet.cx](https://evermeet.cx/ffmpeg/) static builds | [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases) `yt-dlp_macos` |
| macOS x64 | evermeet.cx (x64 build) | same, `yt-dlp_macos` (universal binary) |
| Windows x64 | [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) `ffmpeg-release-essentials.zip` | `yt-dlp.exe` |
| Linux x64 | [johnvansickle.com](https://johnvansickle.com/ffmpeg/) static build | `yt-dlp_linux` |

> evermeet and gyan are the most widely used community-maintained static build sources. For a more reproducible CI pipeline, BtbN GitHub Actions releases (`https://github.com/BtbN/FFmpeg-Builds/releases`) are an alternative with tagged versions.

### SHA verification

Pin SHA256 of each binary per release version in a `bins.toml` file shipped with the app. On upgrade, bump the file and re-release. The `resolve_ffmpeg()` / `resolve_ytdlp()` functions in `cliply-clip-core`:

1. Check env override — if set and binary exists, use it (no verify, user's responsibility)
2. Check cache dir — if present, verify SHA256 against pinned value; if match, return path
3. Download from URL with progress events → temp file → verify SHA256 → rename to cache path
4. Return error if verify fails (never use an unverified binary)

```rust
// pseudocode for resolve_ffmpeg in cliply-clip-core
pub async fn resolve_ffmpeg(app_data_dir: &Path) -> Result<PathBuf> {
    if let Ok(p) = env::var("FFMPEG_PATH") { return Ok(PathBuf::from(p)); }
    let cache = app_data_dir.join("bins").join(FFMPEG_FILENAME);
    if cache.exists() && sha256_file(&cache)? == FFMPEG_SHA256 { return Ok(cache); }
    download_with_progress(FFMPEG_URL, &cache, FFMPEG_SHA256).await?;
    Ok(cache)
}
```

### First-run UX

- On app launch, show a "Setting up" screen (not blocking the main window) that downloads both binaries with individual progress bars.
- Download is ~30–60 MB total. Show combined progress.
- If download fails (no internet), show error with manual path option (power-user escape hatch).
- Once verified, both binaries are chmod +x (macOS/Linux) and cached permanently. Subsequent launches skip download (SHA re-verify is fast).

### WKWebView / AV1 constraint

macOS plays video via WKWebView which cannot decode AV1 on M1/M2 (no hardware decoder exposed). yt-dlp format selector must prefer h264:

```
bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b
```

Fallback when ffmpeg not yet available: `-f b[ext=mp4]` (best single-file mp4, usually h264).

### Licensing note

- The app's own code (Rust crate + TS package + Tauri app) can be MIT or Apache-2.0 — permissive.
- ffmpeg is LGPL 2.1+ (static essentials build avoids GPL codecs). Auto-downloading a separate binary at runtime is NOT linking; the app does not distribute GPL code. Still: surface this clearly in README ("this app downloads ffmpeg at runtime; see ffmpeg.org/legal.html").
- yt-dlp is Unlicense. No restrictions.
- Do NOT bundle either binary in the repo or the release artifact.

---

## 5. Feature Build-Out

### Screen 1 — URL Input + Download

**Route:** `/` (home, shown when no video loaded)

- Single input: "Paste YouTube URL"
- Validate with a simple regex (`/youtube\.com|youtu\.be/`) on blur
- "Download" button → calls Tauri command `download_video(url)`
- Progress: Tauri event stream `download://progress` → `{ percent: f32, speed: String, eta: String }` parsed from yt-dlp stdout `[download] X.X%`
- On complete: store row in `videos` table, navigate to `/video/:id`
- Error states: invalid URL, download failure, disk-full (surface yt-dlp stderr)

yt-dlp args (from `download.rs`, unchanged):
```
["--no-playlist","--newline","--continue","-o",<path>,"--ffmpeg-location",<ffmpegDir>,
 "-f","bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
 "--merge-output-format","mp4",<url>]
```

Output path: `app_data_dir()/downloads/<sanitized_title>.mp4`

### Screen 2 — XML Import

**Route:** `/video/:id` (shown after download, before XML import)

- Video title shown at top; native `<video>` preview at 30% height (autoplay=false)
- "Import XML" button → `dialog::open` with filter `.xml`
- Parse with `parseSportXml()` from `@cliply/xml`
- Color mapping: `R, G, B` in 0–65535 range → divide by 257 → CSS hex
- Insert tag_types, tag_variants, clips rows — all scoped to this video_id
- Navigate to `/video/:id/clips` on success
- Error states: malformed XML, no instances found (show count), encoding issues

### Screen 3 — Clip List

**Route:** `/video/:id/clips`

**Layout:** left panel (tag group accordion) + main area (clip cards)

Tag group accordion (left):
- One entry per `tag_type`, colored dot using `tag_type.color`
- Click group → scroll main to that group's section
- "Select all in group" checkbox per group

Clip card (main):
- Poster image (loaded from `poster_path` if available, else generated on hover via Tauri `generate_poster(clip_id)`)
- Tag color bar (left border, `tag_type.color`)
- Clip name, start–end times, duration
- Variant badges (colored pills from `tag_variants`)
- Checkbox (individual select)
- Click → mini-player modal (native `<video>` seeking to `start_sec`, stopping at `end_sec`)

Global toolbar:
- "Select all" / "Deselect all"
- Selected count badge
- "Export selected" → opens export config drawer

Poster generation (lazy, on first view):
```
["-y","-ss",<t_sec>,"-i",<local_path>,"-frames:v","1","-q:v","2",<poster_path>]
```

### Screen 4 — Export Config

**Drawer/modal over clip list**

Options:

| Option | Default | Notes |
|---|---|---|
| Output folder | OS Downloads dir | Native folder picker |
| Codec | Copy (fast) | Copy = `-c copy`; Reencode = h264+aac |
| Export individual clips | ✓ on | Folder-per-tag layout |
| Export per-tag reels | ✓ on | Concat all clips per tag |
| Export combined reel | ✗ off | All selected clips in one reel |

On macOS, reencode uses VideoToolbox:
```
["-c:v","h264_videotoolbox","-b:v","8M","-allow_sw","1","-c:a","aac","-movflags","+faststart"]
```

On other platforms (Linux/Windows), reencode uses:
```
["-c:v","libx264","-preset","veryfast","-c:a","aac","-movflags","+faststart"]
```

### Screen 5 — Export Progress + Result

- Progress list: one row per operation (clip cut or reel), with status (pending / running / done / error)
- Overall progress bar
- Individual clip ffmpeg args (cut):
  ```
  ["-y","-ss",<start(3dp)>,"-i",<local_path>,"-t",<duration(3dp)>,<codec_args>,<out_path>]
  ```
- Reel args:
  ```
  ["-y","-f","concat","-safe","0","-i",<listFile>,"-c","copy","-movflags","+faststart",<out_path>]
  ```
  where listFile contains `file '<abs_path_to_clip>'` lines
- Export dir layout:
  ```
  <Output Folder>/<Video Title>/<Tag Name>/01 clip name.mp4
  <Output Folder>/<Video Title>/Reels/Reel - <Tag Name>.mp4
  <Output Folder>/<Video Title>/<Video Title> - all clips.mp4
  ```
- On complete: "Open folder" button → `opener::reveal(<output_dir>)`
- Error per clip is non-fatal: mark as failed, continue, report summary at end

---

## 6. Phased Milestones

### P0 — Extract shared crate + package (2–3 weeks)

**Goal:** Pull shared code out of cliply; cliply desktop must pass all existing tests after refactor.

| Deliverable | Acceptance criteria |
|---|---|
| `packages/xml/` TS package with `parseSportXml`, `readXmlFile`, types | cliply's XML tests pass via the package |
| `crates/clip-core/` Rust crate with `ffmpeg_cut`, `ffmpeg_reel`, `ffmpeg_poster`, `yt_dlp_download`, `resolve_ffmpeg`, `resolve_ytdlp` | Unit tests for each function; SHA verify logic tested with fixture |
| cliply `desktop/src-tauri/Cargo.toml` updated to depend on `../../../crates/clip-core` | `cargo build` passes; existing cliply desktop E2E (download + export) still works |
| cliply `package.json` workspace updated to include `@cliply/xml` | `npm run build` passes; existing XML import in cliply dashboard still works |
| Private S3 mirror references in `ffmpeg.rs` replaced by env-driven URLs (cliply keeps its own URL config, OSS uses public) | cliply desktop still resolves ffmpeg via its own config; OSS can point at public URLs |

### P1 — OSS app skeleton + binary auto-download (1 week)

| Deliverable | Acceptance criteria |
|---|---|
| **New standalone public repo** `~/Development/clip-cutter` with Tauri v2 scaffold (NOT a cliply subdir) | `cargo tauri dev` opens a window; repo has its own git history, LICENSE, README |
| Publish `clip-core` → crates.io and `@cliply/xml` → npm (first public versions); OSS app pins them | External contributor can `git clone` + `cargo build` with no cliply-repo access |
| `bins.toml` with pinned URLs + SHA256 for macOS arm64/x64, Windows x64, Linux x64 | All values documented; at least macOS arm64 verified |
| First-run setup screen: downloads ffmpeg + yt-dlp, shows progress, verifies SHA | On a clean machine (no ffmpeg in PATH) the app downloads and caches binaries; second launch skips download |
| Env override path (`FFMPEG_PATH`, `YTDLP_PATH`) respected | Setting env var skips download for that binary |

### P2 — Download + XML import + clip list (2–3 weeks)

| Deliverable | Acceptance criteria |
|---|---|
| URL input screen with yt-dlp download + progress | Pasting a YouTube URL downloads an h264 mp4; progress shown; file stored in app-data |
| SQLite schema initialized on first launch | All tables exist; FK constraints work |
| XML import via file dialog + `parseSportXml` | Importing a SportsCode XML produces correct clip/tag rows; UTF-16 files handled |
| Clip list screen: tag accordion + clip cards + colored badges | All clips visible; grouped by tag; tag colors from XML `<ROWS>` |
| Lazy poster generation | Posters generate on hover/first-view; cached to `poster_path` in DB |
| Individual clip preview modal | Click clip → video plays from `start_sec` to `end_sec` |

### P3 — Export (2 weeks)

| Deliverable | Acceptance criteria |
|---|---|
| Export config drawer (folder picker, codec, options) | All options save to local state |
| Individual clip export (folder-per-tag layout) | Selected clips exported to correct directory structure; filenames match `01 name.mp4` pattern |
| Per-tag reel export (concat) | One reel per tag containing selected clips in that tag |
| Combined reel (all selected) | Single MP4 of all selected clips |
| Export progress list per operation | Non-fatal errors per clip surfaced; "open folder" works |
| reencode path (VideoToolbox on macOS, libx264 elsewhere) | Reencode option produces playable MP4 with faststart |

### P4 — Polish + cross-platform + packaging (2–3 weeks)

| Deliverable | Acceptance criteria |
|---|---|
| Windows x64 build passing CI | Tauri build succeeds; binary download uses gyan.dev URL; export works |
| Linux x64 build passing CI | johnvansickle static build resolves; export works |
| GitHub Actions cross-platform matrix build | `.github/workflows/release.yml` builds all 4 targets on tag push |
| Tauri updater configured (GitHub Releases endpoint) | Existing install checks for updates; update flow works |
| README with install instructions + ffmpeg/yt-dlp notice | Clear one-liner install, GPL notice, contributing guide |
| App icon, About screen with version + license links | Not placeholder |

---

## 7. Extraction Risks

### Keeping cliply desktop working during extraction

**Risk:** Refactoring `ffmpeg.rs`, `download.rs`, `export.rs` while cliply is in active development.

**Mitigation:**
- Do the extraction in a dedicated branch. Freeze feature work on those three files for the duration of P0.
- Write unit tests for each function before extracting (if not already present). Those tests move with the code into the crate.
- The crate exposes the same public API as the current module. cliply's `main.rs` Tauri command handlers become thin wrappers calling `cliply_clip_core::*`.
- Run `cargo test` and the existing E2E suite before merging P0 back.

### Keeping the shared crate free of SaaS coupling

**Risk:** cliply's export code may reference cliply-specific types (org_id, worker URLs, Cloudflare Stream).

**Mitigation:**
- The crate accepts only primitive types (`&Path`, `&str`, `f64`, channels). No `serde` types from cliply's schema. No HTTP clients.
- Cloudflare Stream export (`stream.rs`) stays in cliply — it is not extracted.
- cliply's worker HTTP calls stay in cliply. The crate does only local ffmpeg invocation.

### Versioning the shared packages (LOCKED — layout B)

The shared code lives in the **cliply repo** (`crates/clip-core/`, `packages/xml/`). cliply consumes it in-repo (cargo path dep / npm workspace). The OSS app is a **separate public repo** and consumes the shared code as an external dependency.

Because the cliply repo is **private**, an external git dep doesn't resolve for outside contributors. So the rule is:

- **P0:** extract shared code in cliply, cliply consumes via path/workspace. OSS app may temporarily git-dep the private repo (maintainers only) to get moving.
- **P1 (gate):** **publish `clip-core` → crates.io and `@cliply/xml` → npm**. The OSS app switches to pinned published versions. From here, anyone can build the OSS app with no cliply access.
- Ongoing: bump shared-package versions on change; cliply tracks the same versions (or stays on path dep — it has repo access either way).

We explicitly rejected "develop inside cliply, split to public repo later" — it leaks private history and forces a painful extraction. New repo is clean from commit 1.

---

## 8. OSS Concerns

### License

**Recommendation: Apache-2.0** for both `cliply-clip-core` and `@cliply/xml` and the OSS app itself.
- Permissive; compatible with most downstream use.
- Patent clause is useful for a tool dealing with media processing.
- ffmpeg and yt-dlp are downloaded separately at runtime — the app does not link or distribute them, so the app code is not derivative of LGPL/GPL.
- Add `NOTICE` file documenting that the app downloads ffmpeg (LGPL) and yt-dlp (Unlicense) at runtime.

### Repo name suggestions

- `clip-cutter` — generic, descriptive
- `xmlclip` — highlights the XML→clips flow
- `sportclip` — sports-specific
- `clipcut` — short

Avoid "cliply" in the name to keep the OSS identity distinct from the SaaS product.

### README / contributor setup

Minimum for day-one OSS:
1. What it does (one paragraph + screenshot/GIF)
2. Install (GitHub Releases link + macOS `curl` one-liner via install.sh)
3. Usage (5 steps matching the user flow)
4. Build from source (`cargo tauri build`, prereqs: Rust stable, Node 20+)
5. Runtime dependencies notice (ffmpeg, yt-dlp — downloaded automatically)
6. License section with Apache-2.0 + runtime dep licenses
7. `CONTRIBUTING.md`: issue templates, PR process, how to add a new XML variant

### CI (GitHub Actions)

```
.github/workflows/
  ci.yml       # on push: cargo test, npm test, biome lint, tsc
  release.yml  # on tag v*: matrix build (macos-14 arm64, macos-13 x64,
               #             windows-latest, ubuntu-22.04), upload to GH Release
```

Matrix strategy:
```yaml
strategy:
  matrix:
    include:
      - os: macos-14
        target: aarch64-apple-darwin
      - os: macos-13
        target: x86_64-apple-darwin
      - os: windows-latest
        target: x86_64-pc-windows-msvc
      - os: ubuntu-22.04
        target: x86_64-unknown-linux-gnu
```

### Tauri updater

Use Tauri v2's built-in updater plugin pointing at GitHub Releases. Endpoint URL:
```
https://github.com/<org>/clip-cutter/releases/latest/download/latest.json
```

The `release.yml` workflow generates `latest.json` as a release artifact. On launch, the app checks and prompts the user if an update is available. No auto-install without confirmation.

### Code signing / notarization

- macOS: requires Apple Developer account + notarization for Gatekeeper. Store `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` in GitHub Actions secrets. Tauri handles the `codesign` + `xcrun altool` calls.
- Windows: optional for v1; unsigned shows SmartScreen warning. Deferred unless a code-signing cert is available.
- Linux: no signing required; distribute as `.AppImage` and `.deb`.

---

## 9. Open Questions / Deferred

| Item | Status | Notes |
|---|---|---|
| Windows ffmpeg exact URL | Open | gyan.dev `ffmpeg-release-essentials.zip` — need to confirm current stable URL + SHA before P1 ships |
| Linux ffmpeg sourcing | Open | johnvansickle is community-maintained; BtbN is CI-built and more reproducible — decide before P1 |
| macOS code signing for OSS | Deferred | Requires paid Apple Dev account; can ship unsigned (with README warning) until v1.1 |
| Windows code signing | Deferred | Self-signed or unsigned for v1 |
| Local file import (non-YouTube) | Deferred v2 | User points at a local .mp4; skips download screen; rest of flow identical |
| Telestration / drawing overlay | Deferred v2+ | Requires canvas layer over video player; significant scope |
| Trim / clip editor | Deferred v2+ | Manual `startSec`/`endSec` adjustment per clip |
| Multiple video sessions | Deferred v2 | v1 = one video at a time; multi-video workspace is a P5+ concern |
| XML round-trip export | Deferred | OSS app ignores `<cliply_key>`/`<cliply_scope>` for now; can add in v2 |
| yt-dlp cookies / age-restricted videos | Deferred | yt-dlp supports `--cookies-from-browser`; UX to expose this is v2 |
| Linux WKWebView / AV1 | Research needed | Linux uses WebKitGTK; AV1 support varies by distro. May need same h264-first format selector or additional codec flags |
| Tauri updater for Linux | Open | AppImage updater needs custom endpoint; verify Tauri v2 plugin supports it |
