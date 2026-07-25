import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useUserInteractions() {
  const { user } = useUser()
  const [liked,       setLikedState]      = useState({})
  const [saved,       setSavedState]      = useState({})
  const [spaceSaved,  setSpaceSavedState] = useState({})
  const [shared,      setSharedState]     = useState({})
  const [postLiked,   setPostLikedState]  = useState({})
  const [postShared,  setPostSharedState] = useState({})

  useEffect(() => {
    if (!user?.id) return
    const uid = user.id
    Promise.all([
      supabase.from('event_likes').select('event_id').eq('user_id', uid),
      supabase.from('event_saves').select('event_id').eq('user_id', uid),
      supabase.from('space_saves').select('space_id').eq('user_id', uid),
      supabase.from('event_shares').select('event_id').eq('user_id', uid),
      supabase.from('post_likes').select('post_id').eq('user_id', uid),
      supabase.from('post_shares').select('post_id').eq('user_id', uid),
    ]).then(([likes, saves, ssaves, shares, plikes, pshares]) => {
      if (likes.data)  setLikedState(Object.fromEntries(likes.data.map(r => [r.event_id, true])))
      if (saves.data)  setSavedState(Object.fromEntries(saves.data.map(r => [r.event_id, true])))
      if (ssaves.data) setSpaceSavedState(Object.fromEntries(ssaves.data.map(r => [r.space_id, true])))
      if (shares.data) setSharedState(Object.fromEntries(shares.data.map(r => [r.event_id, true])))
      if (plikes.data) setPostLikedState(Object.fromEntries(plikes.data.map(r => [r.post_id, true])))
      if (pshares.data) setPostSharedState(Object.fromEntries(pshares.data.map(r => [r.post_id, true])))
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

  // Share is one-way: once shared it stays recorded. Only flipped to true
  // *after* the upsert succeeds -- marking it optimistically beforehand would
  // leave the UI thinking a share was recorded (permanently, since this is
  // one-way) even when a network/RLS failure meant no row was ever saved,
  // with no way for the user to retry.
  const recordShare = useCallback(async (eventId) => {
    if (!user?.id || shared[eventId]) return
    const { error } = await supabase.from('event_shares').upsert({ user_id: user.id, event_id: eventId }, { onConflict: 'user_id,event_id' })
    if (error) { console.error('[useUserInteractions] recordShare failed:', error); return }
    setSharedState(p => ({ ...p, [eventId]: true }))
  }, [user?.id, shared])

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

  // One-way, same as recordShare for events -- once shared it stays recorded,
  // and only marked so after the upsert actually succeeds (see recordShare's
  // comment for why).
  const recordPostShare = useCallback(async (postId) => {
    if (!user?.id || postShared[postId]) return
    const { error } = await supabase.from('post_shares').upsert({ user_id: user.id, post_id: postId }, { onConflict: 'user_id,post_id' })
    if (error) { console.error('[useUserInteractions] recordPostShare failed:', error); return }
    setPostSharedState(p => ({ ...p, [postId]: true }))
  }, [user?.id, postShared])

  return { liked, saved, spaceSaved, shared, postLiked, postShared, toggleLike, toggleSave, toggleSaveSpace, recordShare, togglePostLike, recordPostShare }
}
