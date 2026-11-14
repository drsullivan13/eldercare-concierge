import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountSettings } from "@/components/account-settings";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const client = await createClient();
  const { data, error } = await client.auth.getUser().catch(() => ({
    data: { user: null },
    error: true,
  }));
  if (error || !data.user) redirect("/login?next=/account");
  return (
    <main className="auth-main" style={{ minHeight: "100dvh" }}>
      <Link href="/dashboard" className="text-link muted">
        Back to workspace
      </Link>
      <AccountSettings userId={data.user.id} email={data.user.email ?? ""} />
    </main>
  );
}
