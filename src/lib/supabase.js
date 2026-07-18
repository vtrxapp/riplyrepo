import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

// Bridges Clerk's session JWT into every Supabase request via the
// `accessToken` client option, so the anon-key client resolves as the
// signed-in Clerk user for RLS (current_user_id() reads auth.jwt()->>'sub').
// window.Clerk is the browser SDK global set up by ClerkProvider in
// main.jsx — reading it here avoids threading a token through every one of
// this module's many existing call sites.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  accessToken: async () => {
    try {
      return (await window.Clerk?.session?.getToken()) ?? null
    } catch {
      return null
    }
  },
})