import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { setCachedMany } from '../lib/detailCache'

async function attachUserProfiles(rows, idField = 'host_id') {
  if (!rows?.length) return rows || []
  const ids = [...new Set(rows.map(r => r[idField]).filter(Boolean))]
  if (!ids.length) return rows
  const { data: users } = await supabase.from('users').select('id,name,avatar_url,avatar_color').in('id', ids)
  const map = Object.fromEntries((users || []).map(u => [u.id, u]))
  return rows.map(r => {
    // A group-attributed space (host_is_group) keeps the group's own
    // name/avatar/color it was created with -- overwriting it from the
    // admin's personal profile here would show the wrong host on every
    // space list (Spaces tab, group Spaces tab), even though
    // SpaceDetailsScreen already gets this right.
    if (r.host_is_group) return r
    const u = map[r[idField]]
    if (!u) return r
    return {
      ...r,
      host_text:    u.name || r.host_text,
      host_name:    u.name || r.host_text,
      host_avatar:  u.avatar_url || null,
      host_color:   u.avatar_color || null,
    }
  })
}

export function useSpaces() {
  const [spaces,  setSpaces]  = useState([])
  const [loading, setLoading] = useState(true)
  // Bumped on every fetch() call so an earlier-fired request can't resolve
  // after a later one (e.g. a rapid refetch()) and overwrite both the list
  // state and the shared detail cache with stale rows.
  const genRef = useRef(0)

  const fetch = useCallback(async () => {
    const gen = ++genRef.current
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    // Delete past spaces from DB
    await supabase.from('spaces').delete().lt('day', today)

    const { data } = await supabase
      .from('spaces')
      .select('*')
      .gte('day', today)
      .order('day', { ascending: true })

    if (gen !== genRef.current) return
    const enriched = await attachUserProfiles(data || [], 'host_id')
    if (gen !== genRef.current) return
    setSpaces(enriched)
    setCachedMany('space', enriched)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { spaces, loading, refetch: fetch }
}
