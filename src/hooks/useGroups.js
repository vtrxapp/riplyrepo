import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useGroups() {
  const [groups,  setGroups]  = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .order('name', { ascending: true })

    const list = data || []
    if (list.length === 0) { setGroups([]); setLoading(false); return }

    // groups.member_count is only ever set once at creation time and never
    // kept in sync with joins/leaves/bans, so it drifts from reality almost
    // immediately -- derive both the count and the avatar previews from the
    // actual approved membership rows instead of trusting that column.
    const { data: members } = await supabase
      .from('group_members')
      .select('group_id, role, users(name, avatar_url, avatar_color)')
      .in('group_id', list.map(g => g.id))
      .eq('status', 'approved')
      .order('role', { ascending: true }) // 'admin' sorts before 'member' -- admin shows first

    const byGroup = {}
    ;(members || []).forEach(m => {
      (byGroup[m.group_id] ||= []).push(m)
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
    fetch()

    const channel = supabase
      .channel('groups-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => fetch())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetch])

  return { groups, loading }
}
