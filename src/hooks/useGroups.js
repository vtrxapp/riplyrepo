import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useGroups() {
  const [groups,  setGroups]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('groups')
        .select('*')
        .order('member_count', { ascending: false })

      setGroups(data || [])
      setLoading(false)
    }

    fetch()
  }, [])

  return { groups, loading }
}