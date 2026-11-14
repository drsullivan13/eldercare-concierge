import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { ACCOUNTS_ENABLED } from "@/lib/features";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  const { error } = await searchParams;
  return (
    <AuthForm
      mode="forgot"
      initialError={
        error
          ? "That reset link could not be completed. Request a new link below and open it in this browser."
          : undefined
      }
    />
  );
}
