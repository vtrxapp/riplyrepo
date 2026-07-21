import { useRef, useEffect, useState } from 'react'
import { useSignIn, useSignUp, useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

// Preference order when Clerk offers more than one second-factor option --
// TOTP needs nothing sent, so it's fastest and comes first; phone/email
// codes are the normal recurring second factor after that. Backup codes are
// a scarce break-glass mechanism (each one is single-use) so they're last
// even though, like TOTP, they need no outbound send.
const SECOND_FACTOR_PRIORITY = ['totp', 'phone_code', 'email_code', 'backup_code']

export function useClerkAuth(showToast, setScreen, go, refetchProfile) {
  const { signIn, isLoaded: signInLoaded, setActive: setActiveIn } = useSignIn()
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveUp } = useSignUp()
  const { user, isLoaded: userLoaded } = useUser()

  // { strategy, hint, phoneNumberId?, emailAddressId? } for whichever second
  // factor Clerk asked us to complete after a password sign-in.
  const [secondFactor, setSecondFactor] = useState(null)

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
      } else if (result.status === 'needs_second_factor') {
        const factors = result.supportedSecondFactors || []
        const chosen = SECOND_FACTOR_PRIORITY
          .map(strategy => factors.find(f => f.strategy === strategy))
          .find(Boolean)
        if (!chosen) {
          showToast('This account requires a verification method we don’t support yet.')
          return
        }
        if (chosen.strategy === 'phone_code') {
          await signIn.prepareSecondFactor({ strategy: 'phone_code', phoneNumberId: chosen.phoneNumberId })
        } else if (chosen.strategy === 'email_code') {
          await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: chosen.emailAddressId })
        }
        setSecondFactor({
          strategy: chosen.strategy,
          hint: chosen.safeIdentifier || null,
          phoneNumberId: chosen.phoneNumberId,
          emailAddressId: chosen.emailAddressId,
        })
        go('second-factor')
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

  const verifySecondFactor = async (code) => {
    if (!signInLoaded || !secondFactor) { showToast('Session expired. Please log in again.'); go('login'); return; }
    if (!code || (secondFactor.strategy !== 'backup_code' && code.length < 6)) { showToast('Enter the full code'); return; }
    try {
      const result = await signIn.attemptSecondFactor({ strategy: secondFactor.strategy, code })
      if (result.status === 'complete') {
        await setActiveIn({ session: result.createdSessionId })
        setSecondFactor(null)
        setScreen('home')
      } else {
        showToast('Verification incomplete: ' + result.status)
      }
    } catch(e) {
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Invalid code. Try again.')
    }
  }

  const resendSecondFactor = async () => {
    if (!secondFactor) return
    try {
      if (secondFactor.strategy === 'phone_code') {
        await signIn.prepareSecondFactor({ strategy: 'phone_code', phoneNumberId: secondFactor.phoneNumberId })
      } else if (secondFactor.strategy === 'email_code') {
        await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: secondFactor.emailAddressId })
      } else {
        return
      }
      showToast('A new code is on its way')
    } catch(e) {
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Could not resend code.')
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

  return { login, signup, verify, completeOnboarding, secondFactor, verifySecondFactor, resendSecondFactor }
}