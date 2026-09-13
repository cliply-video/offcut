# Code signing & notarization (macOS)

The release workflow is **already wired** to sign + notarize macOS builds. It
stays **off** — shipping unsigned `.dmg`s — until you add the secrets below
**and** flip the repo variable `ENABLE_APPLE_SIGNING` to `true` (step 5). Until
then every `v*` tag builds unsigned and CI stays green; no half-configured cert
can break the release.

> Requires an **Apple Developer account** ($99/yr). Only steps 1–4 are manual
> (they need your Apple account); the workflow does the rest.

## 1. Create a "Developer ID Application" certificate

- developer.apple.com → Certificates → **+** → **Developer ID Application** →
  follow the CSR steps (or let Xcode → Settings → Accounts → Manage Certificates
  create it).
- Download it, double-click to add to **Keychain Access** (login keychain).

## 2. Export it as a `.p12`

In Keychain Access, find **Developer ID Application: <Name> (TEAMID)**, expand
it, select **both** the cert and its private key → right-click → **Export** →
`.p12`, set a password.

```bash
base64 -i certificate.p12 | pbcopy   # base64, copied to clipboard
```

## 3. App-specific password (for notarization)

appleid.apple.com → Sign-In & Security → **App-Specific Passwords** → generate
one (label it "cliply-exporter-notary"). Copy it.

Find your **Team ID** at developer.apple.com → Membership (10 chars, e.g. `AB12CD34EF`).

## 4. Add GitHub repo secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
| ------ | ----- |
| `APPLE_CERTIFICATE` | the base64 from step 2 |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (TEAMID)` (exact string from Keychain) |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from step 3 |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Or via CLI:

```bash
gh secret set APPLE_CERTIFICATE -R cliply-video/cliply-exporter < <(base64 -i certificate.p12)
gh secret set APPLE_CERTIFICATE_PASSWORD -R cliply-video/cliply-exporter
gh secret set APPLE_SIGNING_IDENTITY -R cliply-video/cliply-exporter
gh secret set APPLE_ID -R cliply-video/cliply-exporter
gh secret set APPLE_PASSWORD -R cliply-video/cliply-exporter
gh secret set APPLE_TEAM_ID -R cliply-video/cliply-exporter
```

## 5. Turn signing on

Repo → Settings → Secrets and variables → Actions → **Variables** → set
`ENABLE_APPLE_SIGNING` = `true` (or `gh variable set ENABLE_APPLE_SIGNING -R
cliply-video/cliply-exporter -b true`). This is the master switch: the workflow
only imports the cert when it's `true`, so the secrets above can be added/tested
without risking a broken release.

## 6. Cut a release

Push a tag (`git tag -a v0.1.1 -m … && git push origin v0.1.1`). The macOS job
now signs with the Developer ID cert and notarizes via `notarytool`. Verify:

```bash
spctl -a -vvv "/Applications/Offcut.app"   # → accepted, source=Notarized Developer ID
```

Then drop the "Running it on macOS" workaround from the landing page.

## Windows (deferred)

SmartScreen reputation needs an **OV/EV code-signing certificate** (paid, from a
CA like DigiCert/Sectigo; EV often a hardware token → awkward in CI). Wire later
with `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` in `tauri.conf.json`
`bundle.windows.certificateThumbprint` / tauri-action. Until then Windows stays
unsigned (SmartScreen → More info → Run anyway).

## Linux

No signing required. `.AppImage` / `.deb` ship as-is.
