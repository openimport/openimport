import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig, type Plugin } from 'vite'

const root = import.meta.dirname
const docSlugs = () =>
  readdirSync(path.resolve(root, '../../docs'))
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((f) => f.slice(0, -3))

/**
 * The docs are one page with client-side navigation. In dev, `/docs/<page>`
 * is served by docs/index.html; the build writes a copy per page so any
 * static host can serve deep links without rewrite rules.
 */
function docsRoutes(): Plugin {
  return {
    name: 'openimport-docs-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? ''
        if (/^\/docs\/[\w-]+\/?(\?.*)?$/.test(url)) req.url = '/docs/index.html'
        next()
      })
    },
    closeBundle() {
      const out = path.resolve(root, 'dist/docs')
      for (const slug of docSlugs()) {
        mkdirSync(path.join(out, slug), { recursive: true })
        copyFileSync(path.join(out, 'index.html'), path.join(out, slug, 'index.html'))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), docsRoutes()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources — no build step needed.
    conditions: ['@openimport/source', ...defaultClientConditions],
    alias: { '@': path.resolve(root, 'src') },
  },
  server: {
    // The docs import Markdown from the repository's docs/ folder.
    fs: { allow: [path.resolve(root, '../..')] },
  },
  // The import worker is an ES module worker (it shares code with the page).
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      // Landing page at /, playground at /playground/, docs at /docs/
      input: {
        landing: path.resolve(root, 'index.html'),
        playground: path.resolve(root, 'playground/index.html'),
        docs: path.resolve(root, 'docs/index.html'),
      },
    },
  },
})
