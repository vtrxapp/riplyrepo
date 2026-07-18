import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

async function attachUserProfiles(rows) {
  if (!rows?.length) return rows || []
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
  if (!ids.length) return rows
  const { data: users } = await supabase.from('users').select('id,name,avatar_url,avatar_color').in('id', ids)
  const map = Object.fromEntries((users || []).map(u => [u.id, u]))
  return rows.map(r => {
    const u = map[r.user_id]
    if (!u) return r
    return {
      ...r,
      org:          u.name || r.org,
      orgInitial:   (u.name || r.org || 'O')[0].toUpperCase(),
      org_avatar:   u.avatar_url || null,
      org_color:    u.avatar_color || null,
    }
  })
}

// Map FiltersScreen price chip labels to Supabase query ranges
const PRICE_RANGES = {
  'Free':    [0, 0],
  '$10–$20': [10, 20],
  '$20–$30': [20, 30],
  '$30–$40': [30, 40],
  '$40–$50': [40, 50],
  '$50+':    [50, 99999],
}

function dateRangeFor(label) {
  const now = new Date()
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end   = new Date(now); end.setHours(23, 59, 59, 999)
  if (label === 'Today') return [start.toISOString(), end.toISOString()]
  if (label === 'Tomorrow') {
    start.setDate(start.getDate() + 1); end.setDate(end.getDate() + 1)
    return [start.toISOString(), end.toISOString()]
  }
  if (label === 'This Week') {
    const weekEnd = new Date(end); weekEnd.setDate(weekEnd.getDate() + 7)
    return [start.toISOString(), weekEnd.toISOString()]
  }
  if (label === 'This Month') {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return [start.toISOString(), monthEnd.toISOString()]
  }
  if (label === 'Next Month') {
    const ms = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const me = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999)
    return [ms.toISOString(), me.toISOString()]
  }
  return null
}

// filters: object keyed `${secId}:${opt}` → true (from FiltersScreen)
export function useEvents({ category, search, filters } = {}) {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayIso = todayStart.toISOString()

      // Delete past events from DB
      await supabase.from('events').delete().lt('date', todayIso)

      let q = supabase.from('events').select('*')
        .gte('date', todayIso)
        // The admin dashboard writes draft/pending events with a status
        // column; only published (or legacy rows with no status yet) should
        // reach normal users here.
        .or('status.is.null,status.eq.published')
        .order('date', { ascending: true })

      // Category filter
      if (category && !['trending', 'popular', 'new'].includes(category)) {
        q = q.eq('category', category)
      }
      if (category === 'trending') q = q.eq('trending', true)

      // Server-side search via ilike
      if (search && search.trim()) {
        q = q.or(
          `title.ilike.%${search.trim()}%,org.ilike.%${search.trim()}%,location.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`
        )
      }

      // Apply filter chips from FiltersScreen
      if (filters && Object.keys(filters).length > 0) {
        const keys = Object.keys(filters)

        // Date: use the first selected date chip
        const dateKey = keys.find(k => k.startsWith('date:'))
        if (dateKey) {
          const range = dateRangeFor(dateKey.split(':')[1])
          if (range) q = q.gte('date', range[0]).lte('date', range[1])
        }

        // Location
        const locationOpts = keys.filter(k => k.startsWith('location:')).map(k => k.split(':')[1])
        if (locationOpts.length > 0) {
          const values = locationOpts.map(o => `location.ilike.%${o}%`)
          q = q.or(values.join(','))
        }

        // Faculty
        const facultyOpts = keys.filter(k => k.startsWith('faculty:')).map(k => k.split(':')[1])
        if (facultyOpts.length > 0) {
          const values = facultyOpts.map(o => `faculty.ilike.%${o}%`)
          q = q.or(values.join(','))
        }

        // Interests → tags / category
        const interestOpts = keys.filter(k => k.startsWith('interests:')).map(k => k.split(':')[1].toLowerCase())
        if (interestOpts.length > 0) {
          const values = interestOpts.map(o => `category.ilike.%${o}%`)
          q = q.or(values.join(','))
        }

        // Price
        const priceOpts = keys.filter(k => k.startsWith('price:')).map(k => k.split(':')[1])
        if (priceOpts.length > 0) {
          if (priceOpts.includes('Free')) {
            q = q.eq('price', 0)
          } else {
            const ranges = priceOpts.map(o => PRICE_RANGES[o]).filter(Boolean)
            if (ranges.length > 0) {
              const min = Math.min(...ranges.map(r => r[0]))
              const max = Math.max(...ranges.map(r => r[1]))
              q = q.gte('price', min).lte('price', max)
            }
          }
        }
      }

      const { data, error } = await q

      if (error) { setError(error); setLoading(false); return }
      const enriched = await attachUserProfiles(data || [])
      setEvents(enriched)
      setLoading(false)
    }

    fetch()
  }, [category, search, JSON.stringify(filters)])

  return { events, loading, error }
}
