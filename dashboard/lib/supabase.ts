import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client.
 *
 * Uses SUPABASE_KEY (the service role key) which never reaches the browser
 * because it is only read inside server components / route handlers. This lets
 * the public /report/[token] page read weekly_reports without any login.
 */
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Bypass the Next.js Data Cache. Without this, postgrest-js GET requests
      // are cached by Next and the page serves stale rows indefinitely — e.g.
      // the dashboard kept handing out an out-of-date share_token even though a
      // newer weekly_reports row existed. `force-dynamic` does not cover this.
      fetch: (input, init) =>
        fetch(input as RequestInfo | URL, { ...init, cache: "no-store" }),
    },
  });
}
