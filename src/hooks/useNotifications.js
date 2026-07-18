import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { formatRelativeTime as formatTime } from '../lib/formatTime'

// Icon config keyed by notification type
const TYPE_CONFIG = {
  like:        { initial: '♥', color: 'linear-gradient(135deg,#FF5A8A,#FF8A3D)' },
  comment:     { initial: '💬', color: 'linear-gradient(135deg,#7C5CFF,#B06BFF)' },
  follow:      { initial: '👤', color: 'linear-gradient(135deg,#10B981,#06B6D4)' },
  message:     { initial: '✉', color: 'linear-gradient(135deg,#0098F0,#19BFFF)' },
  event:       { initial: '📅', color: 'linear-gradient(135deg,#FF6B6B,#FFB347)' },
  group:       { initial: '👥', color: 'linear-gradient(135deg,#2F6BFF,#6C4DF2)' },
  space:       { initial: '🌐', color: 'linear-gradient(135deg,#0E9F6E,#06B6D4)' },
  ticket:      { initial: '🎟', color: 'linear-gradient(135deg,#F59E0B,#EF4444)' },
  reminder:    { initial: '⏰', color: 'linear-gradient(135deg,#FF8A3D,#FF5A8A)' },
  system:      { initial: 'R', color: 'linear-gradient(135deg,#19BFFF,#0098F0)' },
}

export function useNotifications() {
  const { user } = useUser()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const unreadCount = notifications.filter(n => !n.read).length

  const load = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!error) {
      setNotifications((data || []).map(n => ({
        ...n,
        time: formatTime(n.created_at),
        initial: TYPE_CONFIG[n.type]?.initial || 'R',
        color: TYPE_CONFIG[n.type]?.color || TYPE_CONFIG.system.color,
      })))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user?.id) { setLoading(false); return }
    load(user.id)

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const n = payload.new
        setNotifications(prev => [{
          ...n,
          time: formatTime(n.created_at),
          initial: TYPE_CONFIG[n.type]?.initial || 'R',
          color: TYPE_CONFIG[n.type]?.color || TYPE_CONFIG.system.color,
        }, ...prev])
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotifications(prev => prev.map(n =>
          n.id === payload.new.id ? { ...n, ...payload.new } : n
        ))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id, load])

  const markRead = useCallback(async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    await supabase.from('notifications').update({ read: true }).eq('id', id)
  }, [])

  const markAllRead = useCallback(async () => {
    if (!user?.id) return
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true })
      .eq('user_id', user.id).eq('read', false)
  }, [user?.id])

  const deleteNotification = useCallback(async (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }, [])

  return { notifications, loading, unreadCount, markRead, markAllRead, deleteNotification }
}
