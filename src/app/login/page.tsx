import { AuthForm } from "@/components/auth-form";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const params = await searchParams;
  return (
    <AuthForm
      mode="login"
      initialError={
        params.error === "auth_callback"
          ? "That sign-in link could not be completed. Please sign in below, or request a new confirmation link."
          : undefined
      }
    />
  );
}
