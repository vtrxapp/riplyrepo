import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import RiplyApp from './Riply.jsx'

function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2000)
    const doneTimer = setTimeout(onDone, 2500)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [onDone])

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

  // Show splash until both the timer AND Clerk are ready (or Clerk timed out)
  const ready = splashDone && (isLoaded || clerkTimedOut)

  if (!ready) return <SplashScreen onDone={() => setSplashDone(true)} />

  return <RiplyApp />
}