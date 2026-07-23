import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'
import { formatRelativeTime as formatTime } from '../lib/formatTime'

// One row per group the user belongs to, showing that group's latest post
// and how many posts have landed since the user last opened the group's
// feed -- group_members.last_post_read_at (bumped by markGroupRead, called
// from GroupProfileScreen on open) is the read marker, mirroring how
// useChats/useChat track per-chat unread state.
export function useGroupActivity() {
  const { user } = useUser()
  const userId = user?.id
  const [groupActivity, setGroupActivity] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (userId) => {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id, last_post_read_at')
      .eq('user_id', userId)
      .in('role', ['member', 'admin', 'owner'])

    const groupIds = (memberships || []).map(m => m.group_id)
    if (groupIds.length === 0) { setGroupActivity([]); setLoading(false); return }
    const lastReadMap = Object.fromEntries((memberships || []).map(m => [m.group_id, m.last_post_read_at]))

    const [{ data: groups }, { data: posts }] = await Promise.all([
      supabase.from('groups').select('id, name, initial, logo_color, avatar_url').in('id', groupIds),
      supabase.from('posts').select('group_id, author_name, content, text, created_at')
        .in('group_id', groupIds).order('created_at', { ascending: false }),
    ])

    const groupMap = Object.fromEntries((groups || []).map(g => [g.id, g]))
    const latestByGroup = {}
    const missedCountByGroup = {}
    ;(posts || []).forEach(p => {
      if (!latestByGroup[p.group_id]) latestByGroup[p.group_id] = p
      const lastRead = lastReadMap[p.group_id]
      if (!lastRead || new Date(p.created_at) > new Date(lastRead)) {
        missedCountByGroup[p.group_id] = (missedCountByGroup[p.group_id] || 0) + 1
      }
    })

    const activity = groupIds
      .filter(id => latestByGroup[id] && groupMap[id])
      .map(id => {
        const g = groupMap[id]
        const post = latestByGroup[id]
        const preview = post.content || post.text || ''
        return {
          id,
          groupId: id,
          name: g.name,
          initial: g.initial || g.name?.[0]?.toUpperCase() || '?',
          color: g.logo_color || 'linear-gradient(135deg,#2F6BFF,#6C4DF2)',
          avatarUrl: g.avatar_url || null,
          preview: post.author_name ? `${post.author_name}: ${preview}` : preview,
          time: formatTime(post.created_at),
          missedCount: missedCountByGroup[id] || 0,
        }
      })
      .sort((a, b) => (b.missedCount > 0) - (a.missedCount > 0))
    setGroupActivity(activity)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    load(userId)

    const channel = supabase
      .channel('group-activity-posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => load(userId))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, load])

  const markGroupRead = useCallback(async (groupId) => {
    if (!userId || !groupId) return
    setGroupActivity(prev => prev.map(a => a.groupId === groupId ? { ...a, missedCount: 0 } : a))
    await supabase.from('group_members')
      .update({ last_post_read_at: new Date().toISOString() })
      .eq('group_id', groupId).eq('user_id', userId)
  }, [userId])

  const refetch = useCallback(() => { if (userId) return load(userId) }, [userId, load])

  return { groupActivity, loading: userId ? loading : false, markGroupRead, refetch }
}
