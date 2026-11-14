import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const client = await createClient();
  const { data, error } = await client.auth.getUser().catch(() => ({
    data: { user: null },
    error: true,
  }));
  if (error || !data.user) redirect("/forgot-password?error=recovery_session");
  const { data: session } = await client.auth.getClaims();
  const recovery =
    session?.claims.sub === data.user.id &&
    session.claims.amr?.some(
      (entry) =>
        (typeof entry === "string" ? entry : entry.method) === "recovery",
    );
  if (!recovery) redirect("/forgot-password?error=recovery_session");
  return <AuthForm mode="reset" userId={data.user.id} />;
}
