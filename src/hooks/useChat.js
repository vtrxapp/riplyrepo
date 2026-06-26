import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useChat(chatId) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chatId) return
    setLoading(true)

    // Initial fetch
    supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))

    // Real-time subscription
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [chatId])

  const sendMessage = async (content) => {
    if (!content.trim()) return
    await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: 'current-user',
      content,
    })
  }

  return { messages, loading, sendMessage }
}
