import { createBrowserClient } from '@supabase/ssr'

declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_PUBLISHABLE_KEY__: string | undefined;

const DEFAULT_SUPABASE_URL = "https://olggelhgciddienhphrz.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EUM8n0KTUJpyD_N9Ii6wUg_42K6nARR";

export function createClient() {
  const buildSupabaseUrl = typeof __SUPABASE_URL__ === "string" ? __SUPABASE_URL__ : "";
  const buildSupabasePublishableKey =
    typeof __SUPABASE_PUBLISHABLE_KEY__ === "string" ? __SUPABASE_PUBLISHABLE_KEY__ : "";
  const runtimeEnv =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : {};

  const supabaseUrl =
    buildSupabaseUrl ||
    runtimeEnv.BUN_PUBLIC_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const supabasePublishableKey =
    buildSupabasePublishableKey ||
    runtimeEnv.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.BUN_PUBLIC_SUPABASE_PUBLISAHABLE_KEY ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

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
