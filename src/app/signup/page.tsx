import { AuthForm } from "@/components/auth-form";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
export default function Page() {
  if (!ACCOUNTS_ENABLED) redirect("/dashboard?demo=1");
  return <AuthForm mode="signup" />;
}
