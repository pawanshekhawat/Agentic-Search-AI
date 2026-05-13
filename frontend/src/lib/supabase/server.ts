import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServerClient() {
  const supabaseUrl = process.env.BUN_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing Supabase env vars. Expected BUN_PUBLIC_SUPABASE_URL and BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return createSupabaseClient(supabaseUrl, supabasePublishableKey);
}
