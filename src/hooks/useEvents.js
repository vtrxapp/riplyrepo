import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useEvents({ category, search } = {}) {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)

      let query = supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })

      if (category && !['trending', 'popular'].includes(category)) {
        query = query.eq('category', category)
      }

      if (category === 'trending') {
        query = query.eq('trending', true)
      }

      const { data, error } = await query

      if (error) {
        setError(error)
        setLoading(false)
        return
      }

      let results = data || []

      if (search) {
        const s = search.toLowerCase()
        results = results.filter(e =>
          (e.title + e.org + e.location + (e.description || ''))
            .toLowerCase().includes(s)
        )
      }

      setEvents(results)
      setLoading(false)
    }

    fetch()
  }, [category, search])

  return { events, loading, error }
}