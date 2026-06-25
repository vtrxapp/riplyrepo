import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useSpaces() {
  const [spaces,  setSpaces]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('spaces')
        .select('*')
        .order('created_at', { ascending: false })

      setSpaces(data || [])
      setLoading(false)
    }

    fetch()
  }, [])

  return { spaces, loading }
}