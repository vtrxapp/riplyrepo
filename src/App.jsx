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
        style={{ width: 220, height: 110, objectFit: 'contain' }} />
    </div>
  )
}

export default function App() {
  const { isLoaded } = useAuth()
  const [splash, setSplash] = useState(true)

  if (splash) return <SplashScreen onDone={() => setSplash(false)} />

  if (!isLoaded) return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#fff',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        border: '4px solid #E1E6EE', borderTopColor: '#0098F0',
        animation: 'spin .8s linear infinite',
      }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return <RiplyApp />
}