# Landing page

Static, single-file landing for **exporter.cliply.video**. No build step —
`index.html` is self-contained (inline CSS, fonts via Google Fonts, download
links to the GitHub release).

## Deploy

Point any static host at this `site/` directory and set the custom domain
`exporter.cliply.video`:

- **Cloudflare Pages / Vercel:** new project from this repo, build command _none_,
  output/root directory = `site`.
- **GitHub Pages:** serve `site/` (or copy to `/docs`) + add a `CNAME` file with
  `exporter.cliply.video`.

## Maintenance

Download links point at `/releases/latest`, so they're version-free — nothing
to bump per release. `screenshot.png` is the app's home screen (kept in sync
with `docs/home.png`); refresh it when the UI changes. The look mirrors the app
(`src/styles.css`): dark broadcast-OSD palette, Anton + IBM Plex Mono, square
panels, CRT field.
