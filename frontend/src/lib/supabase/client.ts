import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const runtimeEnv =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : {};

  const supabaseUrl =
    runtimeEnv.BUN_PUBLIC_SUPABASE_URL ||
    runtimeEnv.VITE_SUPABASE_URL ||
    metaEnv.BUN_PUBLIC_SUPABASE_URL ||
    metaEnv.VITE_SUPABASE_URL;
  const supabasePublishableKey =
    runtimeEnv.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.BUN_PUBLIC_SUPABASE_PUBLISAHABLE_KEY ||
    runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.VITE_SUPABASE_PUBLISAHABLE_KEY ||
    metaEnv.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    metaEnv.BUN_PUBLIC_SUPABASE_PUBLISAHABLE_KEY ||
    metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    metaEnv.VITE_SUPABASE_PUBLISAHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing Supabase public env vars. Expected one of: BUN_PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL and BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  return createBrowserClient(
    supabaseUrl,
    supabasePublishableKey
  )
}
