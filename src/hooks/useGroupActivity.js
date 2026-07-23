import { useState, useEffect, useCallback, useRef } from 'react'
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
  // Bumped on every load() call and by markGroupRead's optimistic update, so
  // a load already in flight (e.g. from the mount call racing the posts
  // realtime handler) can't resolve late and clobber newer or optimistic
  // state -- mirrors useChats.js's loadGenRef.
  const loadGenRef = useRef(0)

  const load = useCallback(async (userId) => {
    const gen = ++loadGenRef.current
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId)
      .in('role', ['member', 'admin', 'owner'])

    if (gen !== loadGenRef.current) return
    const groupIds = (memberships || []).map(m => m.group_id)
    if (groupIds.length === 0) { setGroupActivity([]); setLoading(false); return }

    // Latest post and missed-post count are both computed server-side via
    // RPC (not by pulling every post in every group to the client) since
    // Supabase/PostgREST caps rows per request (commonly 1000) -- a
    // client-side scan would silently undercount missed posts for a user in
    // long-running, active groups.
    const [
      { data: groups, error: groupsErr },
      { data: latestPosts, error: latestErr },
      { data: unreadCounts, error: unreadErr },
    ] = await Promise.all([
      supabase.from('groups').select('id, name, initial, logo_color, avatar_url').in('id', groupIds),
      supabase.rpc('get_latest_group_posts'),
      supabase.rpc('get_group_unread_post_counts'),
    ])
    if (gen !== loadGenRef.current) return
    if (groupsErr) console.error('[useGroupActivity] groups fetch failed:', groupsErr)
    if (latestErr) console.error('[useGroupActivity] get_latest_group_posts failed:', latestErr)
    if (unreadErr) console.error('[useGroupActivity] get_group_unread_post_counts failed:', unreadErr)

    // Map (not a plain object) for these lookups -- id/group_id are UUIDs we
    // fetched ourselves, never user-controlled property names, but keyed
    // object access still reads as an object-injection sink to static
    // analysis. Map.get/set sidesteps that entirely.
    const groupMap = new Map((groups || []).map(g => [g.id, g]))
    const latestByGroup = new Map((latestPosts || []).map(p => [p.group_id, p]))
    const missedCountByGroup = new Map((unreadCounts || []).map(r => [r.group_id, r.unread_count]))

    const activity = groupIds
      .filter(id => latestByGroup.has(id) && groupMap.has(id))
      .map(id => {
        const g = groupMap.get(id)
        const post = latestByGroup.get(id)
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
          missedCount: missedCountByGroup.get(id) || 0,
        }
      })
      .sort((a, b) => (b.missedCount > 0) - (a.missedCount > 0))
    setGroupActivity(activity)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) return
    load(userId)

    const channel = supabase
      .channel('group-activity-posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => load(userId))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, load])

  const markGroupRead = useCallback(async (groupId) => {
    if (!userId || !groupId) return
    // Invalidate any load() already in flight so it can't resolve after this
    // and overwrite the optimistic missedCount reset with stale pre-read data.
    loadGenRef.current++
    setGroupActivity(prev => prev.map(a => a.groupId === groupId ? { ...a, missedCount: 0 } : a))
    await supabase.from('group_members')
      .update({ last_post_read_at: new Date().toISOString() })
      .eq('group_id', groupId).eq('user_id', userId)
  }, [userId])

  const refetch = useCallback(() => { if (userId) return load(userId) }, [userId, load])

  return { groupActivity, loading: userId ? loading : false, markGroupRead, refetch }
}
