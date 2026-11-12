// Public build-time switch. Account activation also requires the hosted checks
// documented in docs/verification.md; the current POC uses local demo storage.
export const ACCOUNTS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ACCOUNTS === "true";
