import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { deriveAvatarColor } from './useCurrentUser'
import { formatChatTimestamp as formatTime } from '../lib/formatTime'

export function useChats() {
  const { user } = useUser()
  const [chats, setChats]     = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (userId) => {
    // Get all chats this user participates in
    const { data: participations } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', userId)

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

    if (dmChats.length > 0) {
      const { data: otherParts } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id')
        .in('chat_id', dmChats.map(c => c.id))
        .neq('user_id', userId)

      const partMap = Object.fromEntries((otherParts || []).map(p => [p.chat_id, p.user_id]))
      const uniqueIds = [...new Set(Object.values(partMap).filter(Boolean))]
      otherParticipantIds.push(...uniqueIds)

      if (uniqueIds.length > 0) {
        const { data: profiles } = await supabase
          .from('users')
          .select('id, name, avatar_url, avatar_color')
          .in('id', uniqueIds)

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
    if (!user?.id) { setLoading(false); return }
    load(user.id)

    const channel = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => load(user.id))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id, load])

  return { chats, loading }
}
