import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

// Cache user profiles so we don't re-fetch on every message
const profileCache = {}
async function fetchSenderProfiles(senderIds) {
  const missing = senderIds.filter(id => id && !profileCache[id])
  if (missing.length) {
    const { data } = await supabase.from('users').select('id,name,avatar_url,avatar_color').in('id', missing)
    ;(data || []).forEach(u => { profileCache[u.id] = u })
  }
}

function enrichMessages(msgs, currentUserId) {
  return msgs.map(msg => ({
    ...msg,
    _senderProfile: profileCache[msg.sender_id] || null,
  }))
}

// Find or create a chat row, returns the real UUID chat_id
async function resolveChat(chatId, currentUserId) {
  // If it's already a UUID, use it directly
  if (/^[0-9a-f-]{36}$/.test(chatId)) {
    // Ensure current user is a participant
    await supabase.from('chat_participants')
      .upsert({ chat_id: chatId, user_id: currentUserId }, { onConflict: 'chat_id,user_id' })
    return chatId
  }

  // For synthetic DM ids like "dm-John Doe", look up or create a chat
  const { data: existing } = await supabase
    .from('chats')
    .select('id')
    .eq('synthetic_id', chatId)
    .maybeSingle()

  if (existing?.id) {
    await supabase.from('chat_participants')
      .upsert({ chat_id: existing.id, user_id: currentUserId }, { onConflict: 'chat_id,user_id' })
    return existing.id
  }

  const { data: created } = await supabase
    .from('chats')
    .insert({ synthetic_id: chatId, created_by: currentUserId })
    .select('id')
    .single()

  if (created?.id) {
    await supabase.from('chat_participants')
      .upsert({ chat_id: created.id, user_id: currentUserId }, { onConflict: 'chat_id,user_id' })
  }

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
        const msgs = data || []
        await fetchSenderProfiles([...new Set(msgs.map(m => m.sender_id).filter(Boolean))])
        setMessages(enrichMessages(msgs, user.id))
        setLoading(false)
      }

      const channel = supabase
        .channel(`chat:${resolved}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${resolved}`,
        }, async (payload) => {
          await fetchSenderProfiles([payload.new.sender_id].filter(Boolean))
          setMessages(prev => {
            if (prev.find(m => m.id === payload.new.id)) return prev
            return [...prev, ...enrichMessages([payload.new], user.id)]
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
    setMessages(prev => [...prev, ...enrichMessages([{ ...row, id: tempId, created_at: new Date().toISOString() }], user.id)])

    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (!error && data) {
      setMessages(prev => prev.map(m => m.id === tempId ? data : m))
      // Update chat's last message preview
      await supabase.from('chats').update({
        last_message: content || '📎 Attachment',
        last_message_at: data.created_at,
      }).eq('id', cid)
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
