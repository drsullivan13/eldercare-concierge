import { Dashboard } from "@/components/dashboard";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  if (params.demo === "1") return <Dashboard demo />;
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");

  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  return <Dashboard demo={false} />;
}
