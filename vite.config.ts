import { defineConfig, type Plugin } from "vite";

/** Published at https://mohanenm.github.io/better-directions/ (a GitHub Pages project site). */
export const BASE = "/better-directions/";

/**
 * Content-Security-Policy, as a <meta> tag because GitHub Pages can't send custom headers.
 * Everything comes from the site itself: no third-party scripts, fonts, tiles or APIs.
 * A meta CSP can't set frame-ancestors, report-uri or sandbox (see docs/SECURITY.md).
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "child-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

/** Dev needs inline styles for hot reload, so the CSP is only added to production builds. */
function csp(): Plugin {
  return {
    name: "better-directions-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
    },
  };
}

export default defineConfig({
  root: "app",
  base: BASE,
  publicDir: "public",
  plugins: [csp()],
  worker: { format: "es" },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    // The style JSON from @protomaps/basemaps and MapLibre are big; that's expected.
    chunkSizeWarningLimit: 1500,
  },
  preview: { port: 4173, strictPort: true },
});
