# Tauri icons

This directory is intentionally empty. Tauri expects platform-specific
icons (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`) referenced by `src-tauri/tauri.conf.json -> bundle.icon`.

To populate them, run the Tauri icon generator from the project root
once you have the local toolchain installed:

```bash
npx tauri icon ./public/rastrum-logo.svg
```

That command rasterises the source SVG/PNG into every size Tauri needs
and writes them into this folder. It also generates the Android
mipmap densities under `src-tauri/gen/android/app/src/main/res/` the
first time `tauri android init` runs.

Do not commit the generated `.png` / `.icns` / `.ico` binaries until
the brand mark is finalised — they regenerate from
`public/rastrum-logo.svg` on demand.
