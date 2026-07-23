import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Renders src/firebase-messaging-sw.template.js into a real service worker
// with the VITE_FIREBASE_* values substituted in, so the actual config
// values don't live as a literal, easily-stale copy in a committed file --
// see the template's own comment for why the apiKey itself is fine to be
// client-visible.
function firebaseMessagingSw(env) {
  const render = () => {
    const template = fs.readFileSync(
      path.resolve(__dirname, 'src/firebase-messaging-sw.template.js'),
      'utf-8',
    )
    return template
      .replaceAll('__VITE_FIREBASE_API_KEY__', env.VITE_FIREBASE_API_KEY || '')
      .replaceAll('__VITE_FIREBASE_AUTH_DOMAIN__', env.VITE_FIREBASE_AUTH_DOMAIN || '')
      .replaceAll('__VITE_FIREBASE_PROJECT_ID__', env.VITE_FIREBASE_PROJECT_ID || '')
      .replaceAll('__VITE_FIREBASE_STORAGE_BUCKET__', env.VITE_FIREBASE_STORAGE_BUCKET || '')
      .replaceAll('__VITE_FIREBASE_MESSAGING_SENDER_ID__', env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')
      .replaceAll('__VITE_FIREBASE_APP_ID__', env.VITE_FIREBASE_APP_ID || '')
  }

  return {
    name: 'firebase-messaging-sw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/firebase-messaging-sw.js') {
          res.setHeader('Content-Type', 'application/javascript')
          res.end(render())
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'firebase-messaging-sw.js', source: render() })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE')
  return {
    plugins: [react(), firebaseMessagingSw(env)],
  }
})
