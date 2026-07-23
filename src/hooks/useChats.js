import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { deriveAvatarColor } from './useCurrentUser'
import { formatChatTimestamp as formatTime } from '../lib/formatTime'

export function useChats() {
  const { user } = useUser()
  const userId = user?.id
  const [chats, setChats]     = useState([])
  const [loading, setLoading] = useState(true)
  // Bumped on every load() call and by deleteChat's optimistic removal, so a
  // load already in flight when a newer one (or a delete) starts can detect
  // it's stale and skip writing its now-outdated results over the state.
  const loadGenRef = useRef(0)

  const load = useCallback(async (userId) => {
    const gen = ++loadGenRef.current
    // Get all chats this user participates in
    const { data: participations } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userId)

    if (gen !== loadGenRef.current) return
    const chatIds = (participations || []).map(p => p.chat_id)
    if (chatIds.length === 0) { setChats([]); setLoading(false); return }

    const { data: chatRows } = await supabase
      .from('chats')
      .select('id, name, initial, color, last_message, last_message_at, group_id')
      .in('id', chatIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    // A chat with no group_id is a plain 1:1 DM -- look up the other
    // participant's profile so the list shows their name/avatar rather than
    // a blank "Chat" row (chats.name is only set for group/admin threads).
    const dmChats = (chatRows || []).filter(c => !c.group_id)
    const otherParticipantIds = []

    if (gen !== loadGenRef.current) return

    if (dmChats.length > 0) {
      const { data: otherParts } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id')
        .in('chat_id', dmChats.map(c => c.id))
        .neq('user_id', userId)

      if (gen !== loadGenRef.current) return

      const partMap = Object.fromEntries((otherParts || []).map(p => [p.chat_id, p.user_id]))
      const uniqueIds = [...new Set(Object.values(partMap).filter(Boolean))]
      otherParticipantIds.push(...uniqueIds)

      if (uniqueIds.length > 0) {
        const { data: profiles } = await supabase
          .from('users')
          .select('id, name, avatar_url, avatar_color')
          .in('id', uniqueIds)

        if (gen !== loadGenRef.current) return

        const profileMap = Object.fromEntries((profiles || []).map(u => [u.id, u]))

        const enriched = (chatRows || []).map(c => {
          const otherId = partMap[c.id]
          const profile = otherId ? profileMap[otherId] : null
          const displayName = c.name || profile?.name || 'Chat'
          const avatarColor = profile?.avatar_color || deriveAvatarColor(otherId || c.id)
          return {
            ...c,
            name: displayName,
            initial: c.initial || displayName[0]?.toUpperCase() || '?',
            color: c.color || avatarColor,
            avatar_url: profile?.avatar_url || null,
            preview: c.last_message || 'No messages yet',
            time: formatTime(c.last_message_at),
            unread: false,
            unreadCount: 0,
          }
        })
        setChats(enriched)
        setLoading(false)
        return
      }
    }

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
    if (!userId) return
    load(userId)

    const channel = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => load(userId))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, load])

  // Deletes the current user's own membership row rather than the chat
  // itself, so this only removes the conversation from their own list --
  // other participants keep the chat and their message history intact.
  const deleteChat = useCallback(async (chatId) => {
    if (!userId) return { error: 'Not signed in' }
    // Invalidate any load() already in flight so it can't resolve after this
    // and overwrite the optimistic removal below with pre-delete data.
    loadGenRef.current++
    setChats(prev => prev.filter(c => c.id !== chatId))
    const { error } = await supabase
      .from('chat_participants')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId)
    // Reconcile with the server either way -- on success this just confirms
    // the optimistic removal; on failure it restores the chat if it's still
    // actually there.
    load(userId)
    return { error }
  }, [userId, load])

  const refetch = useCallback(() => load(userId), [userId, load])

  return { chats, loading: userId ? loading : false, deleteChat, refetch }
}
