# Pruebas de humo sin red

Renderizan todas las pantallas con un Supabase simulado (`mock-supabase.js`) en Chromium (Playwright) para detectar pantallas que se rompen.
Pensado para el sandbox de Claude (React y Playwright en `/opt/npm-tools`, sin acceso a npm ni a Supabase).

```bash
cd tools/smoke
node build.mjs                      # compila la app con el Supabase simulado en ./out
python3 -m http.server 8765 --bind 127.0.0.1 &
node run.mjs x anon,diver           # roles: anon, diver, center (sin verificar), centerv (verificado), centerr (rechazado), admin, vacio (semana sin salidas)
node run.mjs shots center           # además guarda capturas en ./shots
node click.mjs centerv /centro/agenda "main .card button[aria-expanded]" shots/agenda.png
```

`run.mjs` imprime `ok` o los errores de cada ruta y `FAILS n` al final.

## Paquetes que no están en `/opt/npm-tools`

- `lucide-react` → `lucide-shim.js`, generado con los SVG de Lucide (mismos nombres y props que lucide-react). Si la app importa un icono nuevo, regenéralo:
  ```bash
  git clone --depth 1 --filter=blob:none --sparse https://github.com/lucide-icons/lucide /tmp/lucide && (cd /tmp/lucide && git sparse-checkout set icons)
  node gen-lucide-shim.mjs /tmp/lucide/icons
  ```
- `@fontsource/*` → CSS vacío. Para ver las fuentes de verdad en las capturas, `FONTSOURCE_DIR=<fonts/google del repo fontsource/font-files> node build.mjs`.

