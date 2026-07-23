import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { deriveAvatarColor } from './useCurrentUser'
import { formatChatTimestamp as formatTime } from '../lib/formatTime'

// Deletes the current user's own membership row rather than the chat itself,
// so this only removes the conversation from their own list -- other
// participants keep the chat and their message history intact. Exported
// standalone (not just as useChats().deleteChat) so screens that don't need
// the full chat list -- e.g. an open chat's own "Delete chat" action -- can
// call the exact same logic without mounting a redundant list fetch.
export async function deleteChatParticipant(chatId, userId) {
  if (!userId) return { error: 'Not signed in' }
  return supabase
    .from('chat_participants')
    .delete()
    .eq('chat_id', chatId)
    .eq('user_id', userId)
}

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

    if (gen !== loadGenRef.current) return

    // Unread = messages sent by someone else since this user last opened the
    // chat. chat_participants.last_read_at is bumped by useChat.js whenever
    // the chat screen is opened (or a new message arrives while it's open).
    // Counted server-side (not by pulling every message to the client) since
    // Supabase/PostgREST caps rows per request (commonly 1000) -- a client-side
    // scan would silently undercount for a user in long-running, active chats.
    const { data: unreadCounts, error: unreadErr } = await supabase.rpc('get_unread_chat_counts')
    if (unreadErr) {
      // Bail out rather than falling through with an empty map -- that would
      // render every chat as read, which is worse than just leaving the
      // previously-known unread state on screen until the next successful load.
      console.error('[useChats] get_unread_chat_counts failed:', unreadErr)
      setLoading(false)
      return
    }
    const unreadCountMap = new Map((unreadCounts || []).map(row => [row.chat_id, row.unread_count]))

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

      const partMap = new Map((otherParts || []).map(p => [p.chat_id, p.user_id]))
      const uniqueIds = [...new Set([...partMap.values()].filter(Boolean))]
      otherParticipantIds.push(...uniqueIds)

      if (uniqueIds.length > 0) {
        const { data: profiles } = await supabase
          .from('users')
          .select('id, name, avatar_url, avatar_color')
          .in('id', uniqueIds)

        if (gen !== loadGenRef.current) return

        const profileMap = new Map((profiles || []).map(u => [u.id, u]))

        const enriched = (chatRows || []).map(c => {
          const otherId = partMap.get(c.id)
          const profile = otherId ? profileMap.get(otherId) : null
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
            unread: !!unreadCountMap.get(c.id),
            unreadCount: unreadCountMap.get(c.id) || 0,
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
      unread:  !!unreadCountMap.get(c.id),
      unreadCount: unreadCountMap.get(c.id) || 0,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) return
    load(userId)

    const channel = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => load(userId))
      // markRead (useChat.js) bumps chat_participants.last_read_at when a
      // chat is opened -- without this, the unread badge here wouldn't
      // clear until something else happened to trigger a reload. Filtered to
      // this user's own rows so another participant reading their copy of a
      // shared chat doesn't reload everyone else's list too.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${userId}` }, () => load(userId))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, load])

  const deleteChat = useCallback(async (chatId) => {
    if (!userId) return { error: 'Not signed in' }
    // Invalidate any load() already in flight so it can't resolve after this
    // and overwrite the optimistic removal below with pre-delete data.
    loadGenRef.current++
    setChats(prev => prev.filter(c => c.id !== chatId))
    const { error } = await deleteChatParticipant(chatId, userId)
    // Reconcile with the server either way -- on success this just confirms
    // the optimistic removal; on failure it restores the chat if it's still
    // actually there.
    load(userId)
    return { error }
  }, [userId, load])

  const refetch = useCallback(() => load(userId), [userId, load])

  // How many *chats* have unread messages -- not the total unread message
  // count -- since that's what the Messages tab badge should show.
  const unreadChatCount = chats.filter(c => c.unread).length

  return { chats, loading: userId ? loading : false, deleteChat, refetch, unreadChatCount }
}
