import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createPost, PostError } from './scripts/blog-files.ts'

/**
 * Dev-only endpoint behind the /blog/new editor: POST /__blog/posts writes a Markdown file
 * into src/content/blog. It does not exist in production builds.
 */
function blogWriter(): Plugin {
  return {
    name: 'blog-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__blog/posts', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let raw = ''
        req.on('data', (chunk) => (raw += chunk))
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const slug = createPost(JSON.parse(raw))
            res.statusCode = 201
            res.end(JSON.stringify({ slug }))
          } catch (e) {
            res.statusCode = e instanceof PostError ? e.status : 500
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), blogWriter()],
})
