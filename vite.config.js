import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

// Renders src/firebase-messaging-sw.template.js into a real service worker
// with the VITE_FIREBASE_* values substituted in, so the actual config
// values don't live as a literal, easily-stale copy in a committed file --
// see the template's own comment for why the apiKey itself is fine to be
// client-visible. Vite always runs this config with cwd at the project
// root, so this literal relative path (no variable, no path-joining) is
// all that's needed -- nothing here is attacker-influenced.
function firebaseMessagingSw(env) {
  const render = () => {
    const template = fs.readFileSync('src/firebase-messaging-sw.template.js', 'utf-8')
    // JSON.stringify (not raw string substitution) so a value containing a
    // quote, backslash, or newline can't produce invalid JS or change the
    // meaning of the generated file -- the template embeds these
    // placeholders unquoted so the stringified literal supplies its own quotes.
    return template
      .replaceAll('__VITE_FIREBASE_API_KEY__', JSON.stringify(env.VITE_FIREBASE_API_KEY || ''))
      .replaceAll('__VITE_FIREBASE_AUTH_DOMAIN__', JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || ''))
      .replaceAll('__VITE_FIREBASE_PROJECT_ID__', JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || ''))
      .replaceAll('__VITE_FIREBASE_STORAGE_BUCKET__', JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || ''))
      .replaceAll('__VITE_FIREBASE_MESSAGING_SENDER_ID__', JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''))
      .replaceAll('__VITE_FIREBASE_APP_ID__', JSON.stringify(env.VITE_FIREBASE_APP_ID || ''))
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
