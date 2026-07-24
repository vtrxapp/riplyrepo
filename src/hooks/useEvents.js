import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// A group-linked event's card should read as coming from the group itself
// (name + group photo), never from whichever member happened to create it --
// same reasoning as the "New Event Alert" announcement post in
// CreateEventScreen (author_is_group), just applied to the event card too.
// Only a personal (non-group) event falls back to the creator's own profile.
async function attachUserProfiles(rows) {
  if (!rows?.length) return rows || []
  // Fetched for every row, not just non-group ones -- a group-linked event
  // whose group_id points at a since-deleted group still needs the creator
  // as a fallback, rather than falling through with no organizer at all.
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
  const groupIds = [...new Set(rows.map(r => r.group_id).filter(Boolean))]
  const [{ data: users, error: usersErr }, { data: groups, error: groupsErr }] = await Promise.all([
    userIds.length ? supabase.from('users').select('id,name,avatar_url,avatar_color').in('id', userIds) : Promise.resolve({ data: [] }),
    groupIds.length ? supabase.from('groups').select('id,name,avatar_url,logo_color').in('id', groupIds) : Promise.resolve({ data: [] }),
  ])
  // A failed lookup just means this pass falls back to whatever fields the
  // row already had (or the other lookup's result) rather than blocking the
  // whole event list -- but it's still worth logging so a silently-empty
  // organizer badge on cards has a paper trail.
  if (usersErr) console.error('[useEvents] users lookup failed:', usersErr)
  if (groupsErr) console.error('[useEvents] groups lookup failed:', groupsErr)
  const userMap  = Object.fromEntries((users || []).map(u => [u.id, u]))
  const groupMap = Object.fromEntries((groups || []).map(g => [g.id, g]))
  return rows.map(r => {
    const g = r.group_id ? groupMap[r.group_id] : null
    if (g) {
      return {
        ...r,
        org:          g.name || r.org,
        orgInitial:   (g.name || r.org || 'G')[0].toUpperCase(),
        org_avatar:   g.avatar_url || null,
        org_color:    g.logo_color || null,
      }
    }
    const u = userMap[r.user_id]
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
    // The end of *this* calendar week (through Saturday), not a rolling
    // 7-day window -- a rolling window starting mid-week (e.g. Thursday)
    // would run into next Thursday, showing next week's events under a
    // "This Week" label.
    const daysUntilSaturday = 6 - now.getDay()
    const weekEnd = new Date(end); weekEnd.setDate(weekEnd.getDate() + daysUntilSaturday)
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

  const fetch = useCallback(async () => {
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
      if (category && !['thisweek', 'new', 'mine'].includes(category)) {
        q = q.eq('category', category)
      }
      // "This Week" is a real date-range filter (today through the end of
      // the next 7 days), not the old manually-flagged `trending` boolean --
      // replaces the fake "Trending This Week" tab with an actually-week-
      // scoped one.
      if (category === 'thisweek') {
        const range = dateRangeFor('This Week')
        q = q.gte('date', range[0]).lte('date', range[1])
      }

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

        // Interests → category id. FiltersScreen sends canonical ids (e.g.
        // 'personal-development'), matching what CreateEventScreen persists,
        // so an exact match is used instead of ilike substring matching.
        const interestOpts = keys.filter(k => k.startsWith('interests:')).map(k => k.split(':')[1])
        if (interestOpts.length > 0) {
          q = q.in('category', interestOpts)
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
  }, [category, search, JSON.stringify(filters)])

  useEffect(() => { fetch() }, [fetch])

  return { events, loading, error, refetch: fetch }
}

// Fetch a single event by id — for screens (tickets, check-in) that need one
// specific event rather than a filtered list.
export function useEvent(eventId) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!eventId) { setEvent(null); setError(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    // Same published/legacy-NULL status gating as useEvents() — otherwise a
    // single-event fetch by id could render a draft/pending row that the
    // list view would have filtered out.
    supabase.from('events').select('*').eq('id', eventId)
      .or('status.is.null,status.eq.published')
      .single()
      .then(async ({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) { setEvent(null); setError(err || null); setLoading(false); return }
        const [enriched] = await attachUserProfiles([data])
        if (cancelled) return
        setEvent(enriched)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[useEvent] fetch error:', err)
        setEvent(null)
        setError(err)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [eventId])

  return { event, loading, error }
}
