import { useState, useEffect } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useChat(chatId) {
  const { user } = useUser()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chatId) return
    setLoading(true)

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
    if (!content.trim() || !user?.id) return
    const { error } = await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      content,
    })
    return error
  }

  return { messages, loading, sendMessage, currentUserId: user?.id || null }
}
