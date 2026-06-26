import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function useChats() {
  const [chats, setChats]   = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: chatRows } = await supabase
      .from('chats')
      .select('*')
      .order('updated_at', { ascending: false })

    if (!chatRows?.length) { setLoading(false); return }

    // Latest message per chat
    const { data: msgs } = await supabase
      .from('messages')
      .select('chat_id, content, sender_id, created_at')
      .in('chat_id', chatRows.map(c => c.id))
      .order('created_at', { ascending: false })

    const latest = {}
    msgs?.forEach(m => { if (!latest[m.chat_id]) latest[m.chat_id] = m })

    setChats(chatRows.map(c => {
      const msg = latest[c.id]
      const isMine = msg?.sender_id === 'current-user'
      return {
        ...c,
        preview: msg ? (isMine ? `You: ${msg.content}` : msg.content) : 'No messages yet',
        time:    msg ? formatTime(msg.created_at) : '',
        unread:  false,
        unreadCount: 0,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return { chats, loading }
}
