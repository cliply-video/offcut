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
(`src/styles.css`): its own Offcut mark (a 3×3 dot-matrix block with its corner piece cut off),
graphite palette with a signal-cyan accent, Doto dot-matrix display + IBM Plex
Mono labels, scanline field. Like sinte.ar it carries the cliply family cues — SMPTE
bar strip, "by cliply" next to the logo, "a product of cliply" in the footer —
and pink is reserved for anything that leads to cliply.video.
