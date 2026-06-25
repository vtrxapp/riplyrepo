import { useSignIn, useSignUp } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useClerkAuth(showToast, setScreen, go) {
  const { signIn, isLoaded: signInLoaded, setActive: setActiveIn } = useSignIn()
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveUp } = useSignUp()

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
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Login failed. Try again.')
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
      console.log('[verify] result:', result.status, result)
      if (result.status === 'complete') {
        await setActiveUp({ session: result.createdSessionId })
        go('onboard')
      } else if (result.verifications?.emailAddress?.status === 'verified') {
        // Email verified but signup not fully complete — still proceed
        go('onboard')
      } else {
        const verifyErr = result.verifications?.emailAddress?.error
        showToast(verifyErr?.longMessage || verifyErr?.message || 'Verification failed. Check your code.')
      }
    } catch(e) {
      console.error('[verify] error:', e)
      showToast(e.errors?.[0]?.longMessage || e.errors?.[0]?.message || 'Invalid code. Try again.')
    }
  }

  const completeOnboarding = async (role, university, campus, program, year) => {
    if (!role) { showToast('Please choose an account type'); return; }
    try {
      const userId = signUp?.createdUserId
      if (userId) {
        await supabase.from('users').insert({
          id: userId,
          email: signUp?.emailAddress,
          name: signUp?.username,
          university,
          campus,
          program,
          year,
          role,
        })
      }
    } catch(e) {
      console.log('User save error:', e)
    }
    setScreen('home')
  }

  return { login, signup, verify, completeOnboarding }
}