import { AuthForm } from "@/components/auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
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
