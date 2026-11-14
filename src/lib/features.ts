// Only advertise accounts when this build can reach its Supabase project.
export const ACCOUNTS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ACCOUNTS === "true" &&
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
