import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useUserInteractions() {
  const { user } = useUser()
  const [liked,       setLikedState]      = useState({})
  const [saved,       setSavedState]      = useState({})
  const [spaceSaved,  setSpaceSavedState] = useState({})
  const [rsvpd,       setRsvpdState]      = useState({})
  const [postLiked,   setPostLikedState]  = useState({})

  useEffect(() => {
    if (!user?.id) return
    const uid = user.id
    Promise.all([
      supabase.from('event_likes').select('event_id').eq('user_id', uid),
      supabase.from('event_saves').select('event_id').eq('user_id', uid),
      supabase.from('space_saves').select('space_id').eq('user_id', uid),
      supabase.from('event_rsvps').select('event_id').eq('user_id', uid),
      supabase.from('post_likes').select('post_id').eq('user_id', uid),
    ]).then(([likes, saves, ssaves, rsvps, plikes]) => {
      if (likes.data)  setLikedState(Object.fromEntries(likes.data.map(r => [r.event_id, true])))
      if (saves.data)  setSavedState(Object.fromEntries(saves.data.map(r => [r.event_id, true])))
      if (ssaves.data) setSpaceSavedState(Object.fromEntries(ssaves.data.map(r => [r.space_id, true])))
      if (rsvps.data)  setRsvpdState(Object.fromEntries(rsvps.data.map(r => [r.event_id, true])))
      if (plikes.data) setPostLikedState(Object.fromEntries(plikes.data.map(r => [r.post_id, true])))
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

  const toggleSaveSpace = useCallback(async (spaceId) => {
    if (!user?.id) return
    const was = !!spaceSaved[spaceId]
    setSpaceSavedState(p => ({ ...p, [spaceId]: !was }))
    if (was) {
      await supabase.from('space_saves').delete().eq('user_id', user.id).eq('space_id', spaceId)
    } else {
      await supabase.from('space_saves').insert({ user_id: user.id, space_id: spaceId })
    }
  }, [user?.id, spaceSaved])

  const togglePostLike = useCallback(async (postId) => {
    if (!user?.id) return
    const was = !!postLiked[postId]
    setPostLikedState(p => ({ ...p, [postId]: !was }))
    if (was) {
      await supabase.from('post_likes').delete().eq('user_id', user.id).eq('post_id', postId)
    } else {
      await supabase.from('post_likes').insert({ user_id: user.id, post_id: postId })
    }
  }, [user?.id, postLiked])

  return { liked, saved, spaceSaved, rsvpd, postLiked, toggleLike, toggleSave, toggleSaveSpace, toggleRsvp, togglePostLike }
}
