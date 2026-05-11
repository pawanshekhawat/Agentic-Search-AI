import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.BUN_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing Supabase public env vars. Expected BUN_PUBLIC_SUPABASE_URL and BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  return createBrowserClient(
    supabaseUrl,
    supabasePublishableKey
  )
}
