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

// chatId here is always a real chats.id UUID -- either from the chat list
// (useChats.js, where the user is already a participant) or from a
// create_direct_chat/create_admin_thread RPC call made before navigating
// here, both of which already enroll the current user server-side. Verify
// membership (rather than upserting it) so a client-supplied chatId can't
// self-enroll into a chat the user was never actually added to.
async function resolveChat(chatId, currentUserId) {
  if (!chatId) return { chatId: null, error: null }
  const { data, error } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .eq('chat_id', chatId)
    .eq('user_id', currentUserId)
    .maybeSingle()
  if (error) {
    console.error('resolveChat: Supabase error while verifying membership', { chatId, currentUserId, error })
    return { chatId: null, error }
  }
  return { chatId: data ? chatId : null, error: null }
}

export function useChat(chatId) {
  const { user } = useUser()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [resolveError, setResolveError] = useState(null)
  const [messagesError, setMessagesError] = useState(null)
  const [realChatId, setRealChatId] = useState(null)
  const channelRef = useRef(null)

  useEffect(() => {
    setRealChatId(null)
    setMessages([])
    setNotFound(false)
    setResolveError(null)
    setMessagesError(null)
    if (!chatId || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false

    const init = async () => {
      const { chatId: resolved, error: resolveErr } = await resolveChat(chatId, user.id)
      if (cancelled) return
      if (resolveErr) { setLoading(false); setResolveError(resolveErr); return }
      if (!resolved) { setLoading(false); setNotFound(true); return }
      setRealChatId(resolved)

      const { data, error: messagesErr } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', resolved)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (messagesErr) {
        console.error('useChat: failed to load messages', { chatId: resolved, error: messagesErr })
        setLoading(false)
        setMessagesError(messagesErr)
        return
      }
      const msgs = data || []
      await fetchSenderProfiles([...new Set(msgs.map(m => m.sender_id).filter(Boolean))])
      if (cancelled) return
      setMessages(enrichMessages(msgs, user.id))
      setLoading(false)

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
    if (!user?.id) return new Error('Not signed in')
    if (!realChatId || realChatId !== chatId) return new Error('Chat membership has not been resolved')
    const cid = realChatId
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

  const sendAttachment = async (file, content = '') => {
    if (!file || !user?.id) return
    if (!realChatId || realChatId !== chatId) return new Error('Chat membership has not been resolved')
    const ext = file.name.split('.').pop()
    const path = `chat-attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
    if (upErr) return upErr
    const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path)
    const sendErr = await sendMessage(content, publicUrl)
    if (sendErr) {
      await supabase.storage.from('attachments').remove([path])
    }
    return sendErr
  }

  return { messages, loading, notFound, resolveError, messagesError, sendMessage, sendAttachment, currentUserId: user?.id || null }
}
