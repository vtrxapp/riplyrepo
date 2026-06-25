import { useSignIn, useSignUp } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase'

export function useClerkAuth(showToast, setScreen, go) {
  const { signIn, setActive: setActiveIn } = useSignIn()
  const { signUp, setActive: setActiveUp } = useSignUp()

  const login = async (email, password) => {
    if (!email.trim()) { showToast('Enter your student email'); return; }
    if (!password) { showToast('Enter your password'); return; }
    try {
      const result = await signIn.create({ identifier: email, password })
      if (result.status === 'complete') {
        await setActiveIn({ session: result.createdSessionId })
        setScreen('home')
      }
    } catch(e) {
      showToast(e.errors?.[0]?.message || 'Login failed. Try again.')
    }
  }

  const signup = async (name, email, password, confirm) => {
    if (!name.trim()) { showToast('Choose a username'); return; }
    if (!email.includes('@')) { showToast('Enter a valid email'); return; }
    if (password.length < 6) { showToast('Password must be 6+ characters'); return; }
    if (password !== confirm) { showToast('Passwords do not match'); return; }
    try {
      await signUp.create({ emailAddress: email, password, username: name })
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      go('verify')
    } catch(e) {
      showToast(e.errors?.[0]?.message || 'Sign up failed. Try again.')
    }
  }

  const verify = async (code) => {
    if (code.length < 6) { showToast('Enter the full 6-digit code'); return; }
    try {
      const result = await signUp.attemptEmailAddressVerification({ code })
      if (result.status === 'complete') {
        await setActiveUp({ session: result.createdSessionId })
        go('onboard')
      }
    } catch(e) {
      showToast(e.errors?.[0]?.message || 'Invalid code. Try again.')
    }
  }

  const completeOnboarding = async (role, university, campus, program, year, signUpRef) => {
    if (!role) { showToast('Please choose an account type'); return; }
    try {
      const userId = signUpRef?.createdUserId
      if (userId) {
        await supabase.from('users').insert({
          id: userId,
          email: signUpRef?.emailAddress,
          name: signUpRef?.username,
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

  return { login, signup, verify, completeOnboarding, signUp }
}