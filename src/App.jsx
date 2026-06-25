import { useAuth } from '@clerk/clerk-react'
import RiplyApp from './Riply.jsx'

export default function App() {
  const { isLoaded } = useAuth()

  if (!isLoaded) return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#EEF1F6'
    }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: '4px solid #E1E6EE',
        borderTopColor: '#0098F0',
        animation: 'spin .8s linear infinite'
      }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return <RiplyApp />
}