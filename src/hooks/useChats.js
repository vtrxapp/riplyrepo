import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function useChats() {
  const [chats, setChats]     = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: chatRows } = await supabase
      .from('chats')
      .select('id, name, initial, color, last_message, last_message_at')
      .order('last_message_at', { ascending: false })

    setChats((chatRows || []).map(c => ({
      ...c,
      preview: c.last_message || 'No messages yet',
      time:    formatTime(c.last_message_at),
      unread:  false,
      unreadCount: 0,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return { chats, loading }
}
