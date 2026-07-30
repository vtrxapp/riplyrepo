import { useState, useEffect, Component } from 'react'
import { useAuth } from '@clerk/clerk-react'
import RiplyApp from './Riply.jsx'

// Catches uncaught render/lifecycle errors from anywhere in the app so a bug
// in one screen shows a recoverable fallback instead of a blank white page.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, info) {
    // Swap for a real telemetry call (Sentry, etc.) when one is wired up.
    console.error('[ErrorBoundary]', error, info)
  }
  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: 24, textAlign: 'center', background: '#F4F6FA',
        fontFamily: "'Montserrat',-apple-system,sans-serif",
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0E1726' }}>Something went wrong</div>
        <div style={{ fontSize: 13.5, color: '#7B8499', maxWidth: 280 }}>
          Riply hit an unexpected error. Reloading usually fixes it.
        </div>
        <button type="button" onClick={() => window.location.reload()} style={{
          marginTop: 6, height: 46, padding: '0 26px', border: 'none',
          borderRadius: 999, background: 'linear-gradient(135deg,#19BFFF,#1499F5)',
          color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: 'pointer',
          fontFamily: "'Montserrat',-apple-system,sans-serif",
          boxShadow: '0 8px 20px rgba(2,162,240,0.35)',
        }}>Reload</button>
      </div>
    )
  }
}

function SplashScreen({ ready, onDone }) {
  const [fading, setFading] = useState(false)

  // Fades out as soon as auth is actually ready, instead of always waiting
  // out a fixed 2.5s regardless of how fast (or slow) Clerk resolves --
  // that fixed floor was pure added latency on a fast connection, and on a
  // slow one it left a blank white gap between the splash's own fade and
  // the app underneath actually being ready. onDone fires after the fade
  // transition finishes, not on an independent timer.
  useEffect(() => {
    if (!ready) return
    setFading(true)
    const doneTimer = setTimeout(onDone, 500)
    return () => clearTimeout(doneTimer)
  }, [ready, onDone])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'opacity 0.5s ease',
      opacity: fading ? 0 : 1,
      zIndex: 9999,
    }}>
      <img src="/logo.png" alt="Riply"
        style={{ width: 660, height: 330, objectFit: 'contain' }} />
    </div>
  )
}

export default function App() {
  const { isLoaded } = useAuth()
  const [splashDone, setSplashDone] = useState(false)
  const [clerkTimedOut, setClerkTimedOut] = useState(false)

  // If Clerk's script is blocked or unusually slow, don't spin on the splash
  // forever — proceed into the app after a generous timeout. Screens that
  // depend on auth already handle a not-yet-loaded Clerk state gracefully.
  useEffect(() => {
    if (isLoaded) return
    const timer = setTimeout(() => setClerkTimedOut(true), 8000)
    return () => clearTimeout(timer)
  }, [isLoaded])

  const authReady = isLoaded || clerkTimedOut
  const ready = splashDone

  // Boundary wraps both branches so it also catches crashes during splash.
  return (
    <ErrorBoundary>
      {!ready
        ? <SplashScreen ready={authReady} onDone={() => setSplashDone(true)} />
        : <RiplyApp clerkTimedOut={clerkTimedOut} />}
    </ErrorBoundary>
  )
}