import { AuthForm } from "@/components/auth-form";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { safeRelativeRedirect } from "@/lib/workspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const params = await searchParams;
  return (
    <AuthForm
      mode="login"
      next={safeRelativeRedirect(params.next)}
      initialError={
        params.error === "auth_callback"
          ? "That link could not sign you in here. If you opened it on another device, try signing in below with your email and password."
          : undefined
      }
    />
  );
}
