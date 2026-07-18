import { useRef, useEffect } from 'react'
import { useSignIn, useSignUp, useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useClerkAuth(showToast, setScreen, go, refetchProfile) {
  const { signIn, isLoaded: signInLoaded, setActive: setActiveIn } = useSignIn()
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveUp } = useSignUp()
  const { user, isLoaded: userLoaded } = useUser()

  // Persist signup data across the verify → onboard → role steps,
  // because Clerk clears signUp after setActiveUp() is called.
  const pendingUser = useRef({ id: null, email: null, name: null })

  // Track user?.id in a ref so completeOnboarding always has the latest value
  // even if the closure was captured before Clerk finished loading the session.
  const userIdRef = useRef(null)
  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  const login = async (email, password) => {
    if (!email.trim()) { showToast('Enter your student email'); return; }
    if (!password) { showToast('Enter your password'); return; }
    if (!signInLoaded) { showToast('Still loading, try again'); return; }
    try {
      const result = await signIn.create({ identifier: email, password })
      if (result.status === 'complete') {
        await setActiveIn({ session: result.createdSessionId })
        setScreen('home')
      } else {
        showToast('Login incomplete: ' + result.status)
      }
    } catch(e) {
      const msg = e.errors?.[0]?.longMessage || e.errors?.[0]?.message || ''
      const code = e.errors?.[0]?.code || ''
      // "client_not_found" / "client trust id" — stale Clerk session in browser.
      // Clear all Clerk storage and reload so Clerk reinitializes from scratch.
      if (code.includes('client') || msg.toLowerCase().includes('client') || msg.toLowerCase().includes('trust')) {
        Object.keys(localStorage).filter(k => k.startsWith('__clerk')).forEach(k => localStorage.removeItem(k))
        Object.keys(sessionStorage).filter(k => k.startsWith('__clerk')).forEach(k => sessionStorage.removeItem(k))
        window.location.reload()
        return
      }
      showToast(msg || 'Login failed. Try again.')
    }
  }

  const signup = async (name, email, password, confirm) => {
    if (!name.trim()) { showToast('Choose a username'); return; }
    if (!email.includes('@')) { showToast('Enter a valid email'); return; }
    if (password.length < 6) { showToast('Password must be 6+ characters'); return; }
    if (password !== confirm) { showToast('Passwords do not match'); return; }
    if (!signUpLoaded) { showToast('Still loading, try again'); return; }
    try {
      await signUp.create({ emailAddress: email, password, username: name })
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      go('verify')
    } catch(e) {
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Sign up failed. Try again.')
    }
  }

  const verify = async (code) => {
    if (code.length < 6) { showToast('Enter the full 6-digit code'); return; }
    if (!signUpLoaded || !signUp) { showToast('Session expired. Please sign up again.'); go('signup'); return; }
    try {
      const result = await signUp.attemptEmailAddressVerification({ code })
      if (result.status === 'complete') {
        pendingUser.current = {
          id: result.createdUserId,
          email: result.emailAddress,
          name: result.username,
        }
        await setActiveUp({ session: result.createdSessionId })
        go('onboard')
      } else {
        const verifyErr = result.verifications?.emailAddress?.error
        showToast(verifyErr?.longMessage || verifyErr?.message || 'Verification failed: ' + result.status + (result.missingFields?.length ? ' — missing: ' + result.missingFields.join(', ') : ''))
      }
    } catch(e) {
      console.error('[verify] error:', e)
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Invalid code. Try again.')
    }
  }

  const completeOnboarding = async (role, university, campus, program, year) => {
    if (!role) { showToast('Please choose an account type'); return; }
    try {
      // Use ref captured at verify time; fall back to live useUser() if already signed in
      const userId = pendingUser.current.id || userIdRef.current || user?.id
      const email  = pendingUser.current.email || user?.primaryEmailAddress?.emailAddress
      const name   = pendingUser.current.name || user?.username
      if (!userId) {
        showToast('Could not save profile — no user ID. Please try again.')
        return
      }
      // upsert, not insert — useCurrentUser no longer creates a stub row on
      // load, but this is still the only place a users row gets written, so
      // upsert keeps this idempotent against a retry after a failed attempt.
      const { error } = await supabase.from('users').upsert({
        id: userId, email, name, university, campus, program, year, role,
      })
      if (error) {
        console.error('[onboarding] supabase error:', error)
        showToast('Profile save failed: ' + (error.message || 'unknown error'))
        return
      }
      // Await so currentUser.profile is populated before we navigate — the
      // auth guard treats "authenticated with no profile" as still-onboarding
      // and would otherwise immediately route straight back here.
      await refetchProfile?.()
      setScreen('home')
    } catch(e) {
      console.error('[onboarding] error:', e)
    }
  }

  return { login, signup, verify, completeOnboarding }
}