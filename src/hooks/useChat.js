import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

// Find or create a chat row, returns the real UUID chat_id
async function resolveChat(chatId, currentUserId) {
  // If it's already a UUID, use it directly
  if (/^[0-9a-f-]{36}$/.test(chatId)) return chatId

  // For synthetic DM ids like "dm-John Doe", look up or create a chat
  const { data: existing } = await supabase
    .from('chats')
    .select('id')
    .eq('synthetic_id', chatId)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: created } = await supabase
    .from('chats')
    .insert({ synthetic_id: chatId, created_by: currentUserId })
    .select('id')
    .single()

  return created?.id || null
}

export function useChat(chatId) {
  const { user } = useUser()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [realChatId, setRealChatId] = useState(null)
  const channelRef = useRef(null)

  useEffect(() => {
    if (!chatId || !user?.id) return
    let cancelled = false

    const init = async () => {
      const resolved = await resolveChat(chatId, user.id)
      if (cancelled || !resolved) return
      setRealChatId(resolved)

      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', resolved)
        .order('created_at', { ascending: true })

      if (!cancelled) {
        setMessages(data || [])
        setLoading(false)
      }

      const channel = supabase
        .channel(`chat:${resolved}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${resolved}`,
        }, (payload) => {
          setMessages(prev => {
            // avoid duplicates from optimistic insert
            if (prev.find(m => m.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        })
        .subscribe()

      channelRef.current = channel
    }

    init()
    return () => {
      cancelled = true
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [chatId, user?.id])

  const sendMessage = async (content, attachmentUrl = null) => {
    if (!user?.id) return
    const cid = realChatId || chatId
    const row = {
      chat_id: cid,
      sender_id: user.id,
      content: content || '',
    }
    if (attachmentUrl) row.attachment_url = attachmentUrl

    // Optimistic insert
    const tempId = `temp-${Date.now()}`
    setMessages(prev => [...prev, { ...row, id: tempId, created_at: new Date().toISOString() }])

    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (!error && data) {
      // Replace temp with real row
      setMessages(prev => prev.map(m => m.id === tempId ? data : m))
    } else if (error) {
      // Remove optimistic on failure
      setMessages(prev => prev.filter(m => m.id !== tempId))
    }
    return error
  }

  const sendAttachment = async (file) => {
    if (!file || !user?.id) return
    const ext = file.name.split('.').pop()
    const path = `chat-attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
    if (upErr) return upErr
    const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path)
    return sendMessage('', publicUrl)
  }

  return { messages, loading, sendMessage, sendAttachment, currentUserId: user?.id || null }
}
