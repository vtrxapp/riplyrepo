import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useGroups() {
  const [groups,  setGroups]  = useState([])
  const [loading, setLoading] = useState(true)
  // Bumped on every fetchGroups() call so an earlier-fired fetch (e.g. from a
  // rapid burst of group_members realtime events during a bulk approval)
  // can't resolve after a later one and overwrite it with stale data.
  const genRef = useRef(0)

  const fetchGroups = useCallback(async () => {
    const gen = ++genRef.current
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .order('name', { ascending: true })

    if (gen !== genRef.current) return
    if (error) { console.error('[useGroups] fetch error:', error); setLoading(false); return }

    const list = data || []
    if (list.length === 0) { setGroups([]); setLoading(false); return }

    // groups.member_count is only ever set once at creation time and never
    // kept in sync with joins/leaves/bans, so it drifts from reality almost
    // immediately -- derive both the count and the avatar previews from the
    // actual approved membership rows instead of trusting that column.
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('group_id, role, users(name, avatar_url, avatar_color)')
      .in('group_id', list.map(g => g.id))
      .eq('status', 'approved')

    if (gen !== genRef.current) return
    if (membersError) { console.error('[useGroups] members fetch error:', membersError); setLoading(false); return }

    // Most-privileged first (owner, then admin, then member) -- ordering by
    // `role` in SQL sorts alphabetically ('admin' < 'member' < 'owner'), which
    // put owners last instead of first, so sort in JS by explicit rank instead.
    const ROLE_RANK = { owner: 0, admin: 1, member: 2 }
    const byGroup = {}
    ;(members || []).forEach(m => {
      (byGroup[m.group_id] ||= []).push(m)
    })
    Object.values(byGroup).forEach(rows => {
      rows.sort((a, b) => (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3))
    })

    setGroups(list.map(g => {
      const rows = byGroup[g.id] || []
      return {
        ...g,
        member_count: rows.length,
        member_previews: rows.slice(0, 5).map(m => ({
          avatar_url:   m.users?.avatar_url || null,
          avatar_color: m.users?.avatar_color || null,
          initial:      (m.users?.name || '?')[0].toUpperCase(),
        })),
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchGroups()

    const channel = supabase
      .channel('groups-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => fetchGroups())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchGroups])

  return { groups, loading, refetch: fetchGroups }
}
