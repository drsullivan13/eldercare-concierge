import { AuthForm } from "@/components/auth-form";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { safeRelativeRedirect } from "@/lib/workspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const params = await searchParams;
  return <AuthForm mode="signup" next={safeRelativeRedirect(params.next)} />;
}
