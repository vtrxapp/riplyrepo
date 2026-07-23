import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { supabase } from './supabase'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const messaging = getMessaging(app)

export async function requestNotificationPermission(userId) {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    })
    if (token && userId) {
      // fcm_tokens is a text[] — a user can have multiple registered
      // devices/browsers, so append rather than overwrite.
      const { data } = await supabase.from('users').select('fcm_tokens').eq('id', userId).single()
      const existing = data?.fcm_tokens || []
      if (!existing.includes(token)) {
        await supabase.from('users').update({ fcm_tokens: [...existing, token] }).eq('id', userId)
      }
    }
    return token
  } catch (err) {
    console.warn('FCM token error:', err)
    return null
  }
}

export function onForegroundMessage(callback) {
  return onMessage(messaging, callback)
}

export { messaging }
