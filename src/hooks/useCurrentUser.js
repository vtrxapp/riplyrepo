import { useState, useEffect, useCallback } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useCurrentUser() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) setProfile(data)
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    if (!user) { setProfileLoading(false); return }
    fetchProfile(user.id)
  }, [isLoaded, user?.id, fetchProfile])

  const updateProfile = useCallback(async (updates) => {
    if (!user?.id) return { error: 'Not logged in' }
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()
    if (!error && data) setProfile(data)
    return { data, error }
  }, [user?.id])

  const logout = useCallback(async () => {
    await signOut()
  }, [signOut])

  const isAuthenticated = isLoaded && !!user

  return {
    clerkUser: user,
    profile,
    isLoaded,
    profileLoading,
    isAuthenticated,
    updateProfile,
    logout,
    refetchProfile: () => user?.id && fetchProfile(user.id),
    userId: user?.id || null,
    name: profile?.name || user?.username || '',
    email: profile?.email || user?.primaryEmailAddress?.emailAddress || '',
    avatarUrl: profile?.avatar_url || null,
    role: profile?.role || 'student',
    university: profile?.university || '',
    campus: profile?.campus || '',
    program: profile?.program || '',
    year: profile?.year || '',
  }
}
