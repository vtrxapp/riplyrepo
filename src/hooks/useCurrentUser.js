import { useState, useEffect, useCallback } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

const AVATAR_COLORS = [
  'linear-gradient(135deg,#FF6B6B,#FF8A3D)',
  'linear-gradient(135deg,#19BFFF,#0098F0)',
  'linear-gradient(135deg,#10B981,#06B6D4)',
  'linear-gradient(135deg,#FF5A8A,#FF8A3D)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#2F6BFF,#6C4DF2)',
  'linear-gradient(135deg,#10B981,#34D399)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
]

export function deriveAvatarColor(seed = '') {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function useCurrentUser() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  // Only reads the profile — never creates one. A signed-in Clerk user with
  // no `users` row yet (mid-onboarding) is a real, valid state; the auth
  // guard in Riply.jsx routes that case to the onboarding screen, which is
  // the only place a row should be written (via upsert in completeOnboarding).
  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    // Explicitly clear on no-row/error too, not just set on success — otherwise
    // a stale profile from a previously signed-in user lingers in state.
    setProfile(error ? null : data ?? null)
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
      .upsert({ id: user.id, ...updates }, { onConflict: 'id' })
      .select()
    if (!error && data?.[0]) setProfile(prev => ({ ...prev, ...data[0] }))
    return { data: data?.[0], error }
  }, [user?.id])

  const logout = useCallback(async () => {
    await signOut()
  }, [signOut])

  const isAuthenticated = isLoaded && !!user

  const name = profile?.name || user?.username || ''
  const avatarColor = profile?.avatar_color || deriveAvatarColor(user?.id || name)

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
    name,
    email: profile?.email || user?.primaryEmailAddress?.emailAddress || '',
    avatarUrl: profile?.avatar_url || null,
    avatarColor,
    role: profile?.role || 'student',
    university: profile?.university || '',
    campus: profile?.campus || '',
    program: profile?.program || '',
    year: profile?.year || '',
  }
}
