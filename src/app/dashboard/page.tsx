import { Dashboard } from "@/components/dashboard";
import { redirect } from "next/navigation";
import { ACCOUNTS_ENABLED } from "@/lib/features";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  if (!ACCOUNTS_ENABLED && params.demo !== "1") redirect("/dashboard?demo=1");
  return <Dashboard demo={params.demo === "1"} />;
}
