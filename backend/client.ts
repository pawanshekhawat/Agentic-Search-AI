import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Missing Supabase public env vars. Expected SUPABASE_URL and SUPABASE_SECRET_KEY.'
    )
  }

  return createClient(
    supabaseUrl,
    supabaseSecretKey
  )
}
