# Auto-updater (Tauri v2)

Cliply Exporter ships with `tauri-plugin-updater` + `tauri-plugin-process`
already wired up. What's left is generating a signing keypair and telling
GitHub Actions about it — both one-time steps.

## One-time setup

### 1. Generate the signing keypair

```bash
npm run tauri signer generate -- -w ~/.tauri/cliply-exporter.key
```

You'll be prompted for a password (empty is allowed, but a real one is
recommended). This writes:

- `~/.tauri/cliply-exporter.key` — the **private** key. Never commit this.
- `~/.tauri/cliply-exporter.key.pub` — the public key (also printed to stdout).

### 2. Add the public key to `tauri.conf.json`

Copy the printed public key into `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY"
  }
}
```

Replace `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY` with the real key and commit
it — the public key is safe to check in.

### 3. Add GitHub repo secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
| ------ | ----- |
| `TAURI_SIGNING_PRIVATE_KEY` | full contents of `~/.tauri/cliply-exporter.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password from step 1 (blank if none) |

Or via CLI:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R cliply-video/cliply-exporter < ~/.tauri/cliply-exporter.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R cliply-video/cliply-exporter
```

Once these three things are done, releases are self-updating from then on.

## Cutting a release

1. Push a tag: `git tag -a v0.2.5 -m … && git push origin v0.2.5`.
2. `.github/workflows/release.yml` builds each platform, signs the update
   artifacts with the minisign key, and `tauri-action` generates
   `latest.json` + uploads it and the signed bundles to a GitHub Release.
3. **Publish the draft release.** The workflow creates the release as a
   **draft** (`releaseDraft: true`). The updater endpoint
   (`releases/latest/download/latest.json`) only resolves for a
   **published**, non-prerelease release — a draft is invisible to it. Go to
   the repo's Releases page and hit **Publish** once you're happy with it.

Until you publish, existing installs won't see the update at all (the check
just silently finds nothing).

## How it works

- On launch, the app calls the updater's `check()`
  (`src/components/update-banner.tsx`).
- If a newer **signed** version is published, it shows a toast: download
  with progress, then relaunch.
- Failures — dev build, offline, placeholder pubkey, no published release —
  are silently ignored. No error UI, no crash.
- Update artifacts per platform (from the existing bundle targets):
  - macOS: `.app.tar.gz` + `.sig`
  - Windows: `.nsis.zip` + `.sig`
  - Linux: `.AppImage.tar.gz` + `.sig`

## Notes / caveats

- **Local builds will fail** with `createUpdaterArtifacts: true` unless
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are set
  in your shell. `npm run app:build` / `tauri build` are meant to run in CI;
  export those two vars locally only if you need a signed build outside CI.
- **Updater signing is separate from Apple code-signing.** The minisign
  keypair here only proves an update came from you and wasn't tampered with —
  it's unrelated to the Apple Developer certificate. Apple
  signing/notarization is currently off in CI (gated behind the
  `ENABLE_APPLE_SIGNING` repo variable — see `docs/signing.md`). Auto-update
  works fine without Apple signing; Gatekeeper may still warn on first launch
  of a fresh install.
- Update endpoint:
  `https://github.com/cliply-video/cliply-exporter/releases/latest/download/latest.json`.
