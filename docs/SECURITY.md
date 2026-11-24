# Security and privacy notes

Better Directions is a static site: HTML, JavaScript, the walking graph, map tiles, fonts and sprites, all served from GitHub Pages under `/better-directions/`. There is no server code, no database and no accounts.

## What the page does and doesn't do

- **No third-party requests.** Scripts, styles, tiles, fonts, sprites, the graph and the places list are all served by the site itself. The browser smoke test (`npm run smoke`) fails on any request to another host.
- **No cookies, no storage, no analytics.** The smoke test checks `document.cookie`, `localStorage` and `sessionStorage` are empty after planning a route.
- **Location only on request.** The browser's geolocation is used only when someone taps "Use my location". The fix stays on the device and is snapped to the nearest path before it goes into the URL.
- **Shareable links contain start and end points.** The page says so next to the Share button. Points are snapped to the nearest path, not the exact tap or GPS fix.
- **Planning happens on the device,** in a Web Worker.

## Content-Security-Policy

GitHub Pages can't send custom HTTP headers, so the policy is a `<meta http-equiv>` tag. The production build adds it (see `vite.config.ts`), and `app/test/site.test.ts` checks it's there:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self'; child-src 'self'; manifest-src 'self';
base-uri 'none'; form-action 'none'; object-src 'none'
```

- No `unsafe-inline`, no `unsafe-eval` and no wildcards. The built HTML has no inline scripts, event handlers or style attributes; a test checks this.
- MapLibre loads its worker from a same-origin file, so there's no `blob:` worker. Its only `eval` path is for optional plugins (such as the right-to-left text plugin), which we don't load.
- `img-src` allows `data:` and `blob:` because MapLibre builds sprite and marker images in memory.

**What a meta CSP can't do:**

- `frame-ancestors`, so we can't stop other sites from framing the page (clickjacking protection needs a header). The page has no sensitive actions, so the risk is low.
- `report-uri` and `report-to`, so violations aren't reported anywhere. That's fine: we collect nothing.
- `sandbox`.
- It also only applies once the parser reaches it. That's why it's the first thing in `<head>`.

## Supply chain

- **npm dependencies:**
  - Runtime: `maplibre-gl` and `@protomaps/basemaps`.
  - Development: `vite`, `typescript`, `vitest`, `eslint`, `typescript-eslint`, `@eslint/js`, `fast-check` and `@types/node`.
  - All are pinned exactly in `package-lock.json`, and `npm audit` reports 0 vulnerabilities as of 2026-11-24.
  - npm blocked the optional `fsevents` install script; it isn't needed.
- **Python build tools:** pinned in `requirements-dev.txt`.
- **`pmtiles` command-line tool:** pinned to v1.31.2 and checked against the release's SHA-256 before use.
- **Basemap fonts and sprites:** fetched from a pinned commit of `protomaps/basemaps-assets`.
- **CI:** pinned action SHAs, `contents: read`, and no persisted credentials.

## Data safety

The routing safety rules are documented in the README and in `safety/cases.json`. They're enforced at build time, audited again when the page loads, filtered during search, and re-checked on every finished route.
