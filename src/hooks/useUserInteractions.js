import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useUserInteractions() {
  const { user } = useUser()
  const [liked,   setLikedState]  = useState({})
  const [saved,   setSavedState]  = useState({})
  const [rsvpd,   setRsvpdState]  = useState({})

  useEffect(() => {
    if (!user?.id) return
    const uid = user.id
    Promise.all([
      supabase.from('event_likes').select('event_id').eq('user_id', uid),
      supabase.from('event_saves').select('event_id').eq('user_id', uid),
      supabase.from('event_rsvps').select('event_id').eq('user_id', uid),
    ]).then(([likes, saves, rsvps]) => {
      if (likes.data)  setLikedState(Object.fromEntries(likes.data.map(r => [r.event_id, true])))
      if (saves.data)  setSavedState(Object.fromEntries(saves.data.map(r => [r.event_id, true])))
      if (rsvps.data)  setRsvpdState(Object.fromEntries(rsvps.data.map(r => [r.event_id, true])))
    })
  }, [user?.id])

  const toggleLike = useCallback(async (eventId) => {
    if (!user?.id) return
    const was = !!liked[eventId]
    setLikedState(p => ({ ...p, [eventId]: !was }))
    if (was) {
      await supabase.from('event_likes').delete().eq('user_id', user.id).eq('event_id', eventId)
    } else {
      await supabase.from('event_likes').insert({ user_id: user.id, event_id: eventId })
    }
  }, [user?.id, liked])

  const toggleSave = useCallback(async (eventId) => {
    if (!user?.id) return
    const was = !!saved[eventId]
    setSavedState(p => ({ ...p, [eventId]: !was }))
    if (was) {
      await supabase.from('event_saves').delete().eq('user_id', user.id).eq('event_id', eventId)
    } else {
      await supabase.from('event_saves').insert({ user_id: user.id, event_id: eventId })
    }
  }, [user?.id, saved])

  const toggleRsvp = useCallback(async (eventId) => {
    if (!user?.id) return
    const was = !!rsvpd[eventId]
    setRsvpdState(p => ({ ...p, [eventId]: !was }))
    if (was) {
      await supabase.from('event_rsvps').delete().eq('user_id', user.id).eq('event_id', eventId)
    } else {
      await supabase.from('event_rsvps').insert({ user_id: user.id, event_id: eventId })
    }
  }, [user?.id, rsvpd])

  return { liked, saved, rsvpd, toggleLike, toggleSave, toggleRsvp }
}
