# Cliply Exporter — Backlog de Producto/Ingeniería

*Nota: el producto se renombró a **Offcut** (el repo y el bundle id no cambian). Este doc queda como registro histórico.*

**Fecha:** 2026-06-15
**Repositorio:** `~/Development/cliply-oss` (Tauri v2 + React/TypeScript, totalmente offline)

Cliply Exporter descarga un video de YouTube (yt-dlp), importa opcionalmente un XML de análisis (SportsCode/Nacsport), permite revisar y seleccionar clips, y exporta MP4s con ffmpeg (carpeta-por-tag + reels). Es standalone, open-source y no depende del SaaS de cliply.video.

---

## Tabla resumen de prioridades

| # | Ítem | Prioridad |
|---|------|-----------|
| 1 | Smoke-test end-to-end | Alta |
| 2 | Publicar repo en GitHub | Alta |
| 3 | Verificación de CI real | Media |
| 4 | ffmpeg gestionado en Windows/Linux | Media |
| 5 | Gate P1 — publicar paquetes compartidos | Media |
| 6 | Firma de código / notarización | Media |
| 7 | Auto-updater | Baja |
| 8 | Pulido / UX | Baja |
| 9 | Tests | Baja |

---

## Estado actual (hecho)

- **Flujo completo** funcional: descarga por URL o ID de YouTube (11 chars), import XML opcional ("sin XML → guardar video"), lista de clips agrupados por tag con colores, posters vía ffmpeg, preview, export (cut + carpeta-por-tag + reels perTag/combined, codec copy o reencode videotoolbox/libx264).
- **Binarios gestionados**: yt-dlp 2026.06.09 (todas las plataformas) y ffmpeg/ffprobe macOS (evermeet 8.1.1, `.zip`); descarga con verificación SHA256; orden de resolución `env → managed → PATH`.
- **Título real del video** obtenido vía `yt-dlp --write-info-json`.
- **i18n EN/ES** con toggle en UI. Branding completo (logo, hero, promo a cliply.video, link GitHub). Icono propio.
- **CI/release workflows** escritos: `.github/workflows/ci.yml` y `release.yml`.
- **P0 lado-cliply**: paquetes `clip-core` (crate Rust) y `@cliply/xml` (TS) extraídos dentro del repo privado `cliply`; `cliply-oss` todavía tiene sus propias copias locales (duplicación intencional hasta publicación).

---

## Backlog

### 1. Smoke-test end-to-end

**Prioridad:** Alta

**Por qué**
La app compila pero nunca se ejecutó de forma integrada. Cualquier bug de integración (casing de args en `invoke`, migraciones SQLite, reproducción en WKWebView, saturación de procesos) bloqueará a los primeros usuarios reales. Debe completarse antes de publicar el repo.

**Qué hacer**

1. Ejecutar `npm run app` en una máquina con Apple Silicon (macOS).
2. Recorrer el flujo completo:
   - Descarga por URL completa de YouTube.
   - Descarga por ID de 11 caracteres.
   - Verificar que el título real del video aparece en la UI.
   - Import de un XML de Nacsport/SportsCode con al menos 3 tags distintos.
   - Flujo sin XML ("guardar video").
   - Generación de posters: confirmar que no satura CPU con ≥10 clips simultáneos.
   - Preview de clip vía protocolo `asset://`.
   - Export: clips individuales + reel por tag + reel combinado.
   - Toggle ES ↔ EN.
   - Links externos: GitHub y cliply.video se abren en el navegador del sistema.
3. Verificar en logs de Tauri que ffmpeg de evermeet (x86_64) corre correctamente bajo Rosetta en Apple Silicon.
4. Documentar todos los errores encontrados como issues en el backlog antes de cierre.

**Archivos relevantes**
- `src-tauri/src/lib.rs` — registro de comandos `invoke`
- `src-tauri/src/download.rs`, `export.rs`, `media.rs`
- `src/screens/` — flujo de pantallas
- `src/lib/links.ts` — URLs externas

**Criterio de aceptación**
El flujo completo (descarga → XML → selección → export) termina sin errores en macOS Apple Silicon. Los posters se generan sin saturar la CPU. El protocolo `asset://` reproduce video en WKWebView. Los links externos abren en el navegador del sistema.

---

### 2. Publicar repo en GitHub

**Prioridad:** Alta

**Por qué**
El repo es local. El link de GitHub hardcodeado en `src/lib/links.ts` apunta a `github.com/cliply-video/cliply-exporter` pero el repo no existe públicamente. Sin esto, CI y `release.yml` nunca corren, y ningún usuario externo puede acceder al proyecto.

**Qué hacer**

1. Revisar el repo local: asegurarse de que no hay secretos en el historial (API keys, certificados, `.env`). Usar `git log --all --full-diff -p | grep -i secret` o similar.
2. Crear el repo público `cliply-video/cliply-exporter` en GitHub.
3. `git remote add origin https://github.com/cliply-video/cliply-exporter.git && git push -u origin main`.
4. Verificar que el CI job (`ci.yml`) arranca automáticamente en el push.
5. Crear un tag de prueba `v0.1.0-rc1` y confirmar que `release.yml` genera un Release Draft en GitHub.
6. Actualizar `src/lib/links.ts` si la URL final difiere de la supuesta.

**Archivos relevantes**
- `src/lib/links.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Criterio de aceptación**
El repo es público en GitHub. Un push a `main` dispara CI. Un tag `vX.Y.Z` genera un Release Draft. El link de GitHub en la app resuelve correctamente.

---

### 3. Verificación de CI real

**Prioridad:** Media

**Por qué**
Los workflows están escritos pero nunca ejecutaron contra GitHub Actions. Los jobs de Linux requieren dependencias de sistema específicas de Tauri (`libwebkit2gtk-4.1-dev`, etc.) que pueden fallar silenciosamente si no están declaradas. La matriz de release debe compilar en 4 plataformas.

**Depende de:** #2

**Qué hacer**

1. Tras el primer push a GitHub, observar los logs del job `ci.yml`:
   - Linux: confirmar que el step de instalación de deps (`apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`) está presente y completo.
   - Confirmar que `cargo test` pasa en la matriz (macOS, Linux, Windows).
   - Confirmar que `npm run build` (Vite) no falla por módulos faltantes.
2. Si `release.yml` compila la matriz de 4 plataformas, verificar que los artefactos (`.dmg`, `.msi`, `.deb`, `.AppImage`) se adjuntan al Release Draft.
3. Corregir cualquier fallo de CI antes de declarar el paso como cerrado.

**Archivos relevantes**
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Criterio de aceptación**
CI verde en macOS, Linux y Windows. `release.yml` produce artefactos para las 4 plataformas en un Release Draft.

---

### 4. ffmpeg gestionado en Windows/Linux

**Prioridad:** Media

**Por qué**
En Windows y Linux, ffmpeg solo se resuelve desde el PATH del sistema. En una instalación limpia sin ffmpeg, la app falla en silencio o muestra un error críptico. macOS ya tiene descarga gestionada (evermeet); hay que parear las otras plataformas para que la experiencia de instalación sea zero-dep.

**Qué hacer**

1. **Windows**: usar los builds de BtbN (`https://github.com/BtbN/FFmpeg-Builds/releases`), archivo `.zip` con `ffmpeg.exe` + `ffprobe.exe`. Fijar una versión y calcular SHA256.
2. **Linux**: usar un tarball estático (por ejemplo `https://johnvansickle.com/ffmpeg/`), formato `.tar.xz`. Requiere agregar soporte de extracción tar.xz en Rust — considerar el crate `xz2` o `flate2` + `tar`.
3. Editar `src-tauri/src/binaries.rs`:
   - Extender la función `source()` para retornar la URL y SHA256 correctos según el target triple (`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`).
   - Implementar extracción de `.zip` (ya existe para macOS) y de `.tar.xz` (nuevo).
   - Persistir los binarios en el directorio de datos de la app (ya establecido en macOS).
4. Probar en un runner de Linux sin ffmpeg preinstalado (puede ser el job de CI).

**Archivos relevantes**
- `src-tauri/src/binaries.rs` — `source()`, lógica de descarga y extracción
- `src-tauri/Cargo.toml` — agregar crates de compresión si se necesitan

**Criterio de aceptación**
En una máquina Windows o Linux limpia (sin ffmpeg en PATH), la pantalla de setup descarga, verifica SHA256 y extrae ffmpeg correctamente. La app funciona end-to-end sin intervención manual.

---

### 5. Gate P1 — publicar paquetes compartidos

**Prioridad:** Media

**Por qué**
Actualmente hay duplicación intencional: el repo privado `cliply` tiene `clip-core` (crate Rust) y `@cliply/xml` (paquete TS); `cliply-oss` tiene sus propias copias en `export.rs`/`download.rs`/`binaries.rs` y `src/lib/xml.ts`. Como `cliply` es privado, `cliply-oss` no puede depender de él directamente. Publicar los paquetes en registros públicos (crates.io / npm) elimina la duplicación y establece una fuente única de verdad.

**Qué hacer**

**Parte A — `clip-core` a crates.io**
1. En el repo `cliply`, preparar el crate `clip-core`: `[package]` con `name`, `version`, `license`, `description`, `repository`.
2. `cargo login` con cuenta en crates.io.
3. `cargo publish -p clip-core`.
4. En `cliply-oss/src-tauri/Cargo.toml`, reemplazar el código local por `clip-core = "X.Y.Z"`.
5. Eliminar las secciones duplicadas de `export.rs`, `download.rs`, `binaries.rs` que replican lógica de `clip-core`.

**Parte B — `@cliply/xml` a npm**
1. En el repo `cliply`, asegurarse de que el paquete tiene `package.json` correcto con `name: "@cliply/xml"`, `version`, `main`/`exports`, `license`.
2. `npm publish --access public` (la org `@cliply` en npm debe existir o usar nombre sin scope).
3. En `cliply-oss/package.json`, agregar `"@cliply/xml": "X.Y.Z"`.
4. Eliminar `src/lib/xml.ts` y actualizar los imports en `src/`.

**Criterio de aceptación**
`clip-core` aparece en crates.io. `@cliply/xml` aparece en npm. `cliply-oss` no contiene copias locales de esa lógica. `npm run app` y `cargo build` siguen funcionando usando las versiones publicadas.

---

### 6. Firma de código / notarización

**Prioridad:** Media

**Por qué**
Los builds sin firmar activan Gatekeeper en macOS ("esta app no puede abrirse porque no puede verificarse el desarrollador") y SmartScreen en Windows. Esto bloqueará a la gran mayoría de usuarios no técnicos al intentar abrir la app descargada desde el Release Draft.

**Depende de:** #2, #3

**Qué hacer**

**macOS**
1. Obtener una cuenta Apple Developer (US$99/año).
2. Generar un certificado "Developer ID Application" desde Keychain/portal de Apple.
3. Exportar el certificado como `.p12` y convertirlo a base64.
4. Agregar los siguientes secrets en GitHub Actions:
   - `APPLE_CERTIFICATE` (base64 del `.p12`)
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_ID`, `APPLE_PASSWORD` (Apple ID + contraseña de app para notarización)
   - `APPLE_TEAM_ID`
5. Configurar `tauri-action` en `release.yml` para usar esos secrets.
6. Verificar que el `.dmg` resultante pasa `spctl --assess` y `xcrun stapler validate`.

**Windows**
1. Obtener un certificado EV Code Signing (DigiCert, Sectigo, etc.) o usar un OV temporalmente.
2. Agregar `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` como secrets.
3. Configurar el step de firma en `release.yml`.

**Linux**
No requiere firma. Sin acción adicional.

**Archivos relevantes**
- `.github/workflows/release.yml`
- `src-tauri/tauri.conf.json` — `bundle.macOS`, `bundle.windows`

**Criterio de aceptación**
El `.dmg` de macOS se abre sin advertencia de Gatekeeper. El `.msi` de Windows se instala sin advertencia de SmartScreen. Los certificados no están hardcodeados en el repo; están en secrets de GitHub Actions.

---

### 7. Auto-updater

**Prioridad:** Baja

**Por qué**
Sin auto-updater, los usuarios deben descargar manualmente cada nueva versión. Para un tool de escritorio en uso activo, esto genera fricción y fragmentación de versiones.

**Depende de:** #2, #5 (firma de código, ya que Tauri updater requiere que el binario esté firmado en macOS)

**Qué hacer**

1. Generar clave de firma del updater: `npx tauri signer generate`. Guardar la clave privada como secret `TAURI_SIGNING_PRIVATE_KEY` en GitHub Actions; la clave pública va en `tauri.conf.json`.
2. En `tauri.conf.json`, configurar la sección `updater`:
   ```json
   {
     "updater": {
       "active": true,
       "endpoints": ["https://github.com/cliply-video/cliply-exporter/releases/latest/download/latest.json"],
       "dialog": true,
       "pubkey": "..."
     }
   }
   ```
3. En `release.yml`, generar el archivo `latest.json` con las URLs y firmas de los artefactos y adjuntarlo al Release.
4. En la app, agregar un hook de inicio que llame a `checkUpdate()` (tauri-plugin-updater) y muestre un banner si hay actualización disponible.

**Archivos relevantes**
- `src-tauri/tauri.conf.json`
- `.github/workflows/release.yml`
- `src/` — componente de notificación de actualización

**Criterio de aceptación**
Al lanzar una versión `vX.Y.Z` nueva en GitHub, una instalación de la versión anterior detecta la actualización al iniciar y ofrece instalarla. La actualización se instala correctamente sin intervención manual adicional.

---

### 8. Pulido / UX

**Prioridad:** Baja

**Por qué**
Hay varios puntos de fricción conocidos que degradan la experiencia en casos de uso reales, especialmente con análisis de partidos largos (muchos clips).

**Qué hacer**

1. **Generación de posters lazy**: hoy se dispara un proceso ffmpeg por cada `ClipCard` al montar el componente. Con ≥20 clips, esto puede saturar la CPU. Implementar lazy loading con `IntersectionObserver`: solo generar el poster cuando el card entra en el viewport. Alternativamente, usar una cola con límite de concurrencia (max 2-3 procesos simultáneos).
   - Archivo: componente `ClipCard` en `src/components/` o `src/screens/`.

2. **Estados de error más claros**: cuando falla la descarga (URL inválida, sin conexión, video privado), mostrar un mensaje específico con la causa, no un estado de error genérico.
   - Archivo: `src-tauri/src/download.rs` (retornar errores tipados), `src/screens/` (manejarlos en UI).

3. **Reanudar descargas**: `yt-dlp` ya soporta `--continue` para reanudar descargas parciales (`.part`). Exponer un botón "Reanudar" en la UI cuando se detecta un archivo `.part` en el directorio de trabajo.
   - Archivo: `src-tauri/src/download.rs`, pantalla de descarga en `src/screens/`.

4. **Capturar duración y poster del video principal**: mostrar la duración total del video y un poster representativo en la pantalla de revisión, no solo en los clips.
   - Archivo: `src-tauri/src/media.rs`, pantalla de review.

5. **Validación de entrada**: validar en el frontend que la URL sea de YouTube o que el ID tenga exactamente 11 caracteres antes de disparar la descarga. Mostrar error inline inmediato.
   - Archivo: pantalla de descarga en `src/screens/`.

**Criterio de aceptación**
Con 30 clips cargados, la CPU no supera el 50% durante la renderización inicial. Los errores de descarga muestran la causa específica. La validación de URL/ID da feedback inmediato sin necesidad de iniciar el proceso de descarga.

---

### 9. Tests

**Prioridad:** Baja

**Por qué**
El coverage actual es mínimo (2 tests Rust en `binaries.rs` + 7 en `clip-core` en el repo privado). Los componentes críticos — parser XML, capa de base de datos SQLite, arg-building de ffmpeg — no tienen cobertura, lo que hace arriesgado cualquier refactor.

**Qué hacer**

1. **Tests del parser XML (TypeScript/Vitest)**:
   - Agregar fixtures de XML de Nacsport/SportsCode reales o sintéticos en `src/__tests__/fixtures/`.
   - Testear `src/lib/xml.ts` (o su reemplazo publicado): parsing de múltiples tags, clips sin duración, caracteres especiales en nombres de tags, XML vacío.
   - Archivo: `src/__tests__/xml.test.ts`.

2. **Tests de la capa DB (TypeScript/Vitest)**:
   - Mockear `tauri-plugin-sql` o usar una instancia SQLite en memoria.
   - Testear las operaciones CRUD de clips y configuración.
   - Archivo: `src/__tests__/db.test.ts`.

3. **Tests Rust de arg-building (si `clip-core` no se publica aún)**:
   - En `src-tauri/src/export.rs` y `download.rs`, agregar unit tests que verifiquen que los vectores de argumentos generados para ffmpeg y yt-dlp son correctos para distintas combinaciones de opciones (codec copy, reencode, con/sin reel, etc.).
   - Archivo: módulo `#[cfg(test)]` en cada archivo Rust correspondiente.

4. Integrar los tests en CI (`ci.yml`): `npm run test` y `cargo test` deben correr en cada PR.

**Archivos relevantes**
- `src/__tests__/` (crear si no existe)
- `src/lib/xml.ts`
- `src-tauri/src/export.rs`, `download.rs`
- `.github/workflows/ci.yml`

**Criterio de aceptación**
`npm run test` y `cargo test` pasan en CI. El parser XML tiene cobertura de al menos los casos: XML válido con múltiples tags, XML vacío, tag sin clips. Los arg-builders de ffmpeg tienen al menos un test por modo (copy, reencode, reel).

---

## Orden sugerido

```
1 (smoke-test)
  → 2 (publicar repo)
    → 3 (verificar CI)
      → 4 (ffmpeg Win/Linux) + 5 (publicar paquetes)  ← paralelo
        → 6 (firma de código)
          → 7 (auto-updater)
```

Los ítems 8 (pulido/UX) y 9 (tests) pueden iniciarse en cualquier momento tras #1, independientemente del resto. Priorizar #8 si hay usuarios beta activos; priorizar #9 antes de aceptar PRs externos.
