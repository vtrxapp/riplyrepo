import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

async function attachUserProfiles(rows, idField = 'host_id') {
  if (!rows?.length) return rows || []
  const ids = [...new Set(rows.map(r => r[idField]).filter(Boolean))]
  if (!ids.length) return rows
  const { data: users } = await supabase.from('users').select('id,name,avatar_url,avatar_color').in('id', ids)
  const map = Object.fromEntries((users || []).map(u => [u.id, u]))
  return rows.map(r => {
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

  useEffect(() => {
    const fetch = async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('spaces')
        .select('*')
        .gte('day', today)
        .order('day', { ascending: true })

      const enriched = await attachUserProfiles(data || [], 'host_id')
      setSpaces(enriched)
      setLoading(false)
    }

    fetch()
  }, [])

  return { spaces, loading }
}