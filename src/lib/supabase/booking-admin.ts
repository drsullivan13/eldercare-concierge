import { createClient } from "@supabase/supabase-js";

function bookingAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function isBookingAdminConfigured() {
  return bookingAdminConfig() !== null;
}

export function bookingAdmin() {
  const config = bookingAdminConfig();
  if (!config) throw new Error("Booking storage unavailable");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
