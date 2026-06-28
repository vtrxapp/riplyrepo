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

  // Show splash until both the timer AND Clerk are ready
  const ready = splashDone && isLoaded

  if (!ready) return <SplashScreen onDone={() => setSplashDone(true)} />

  return <RiplyApp />
}