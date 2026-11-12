import { Dashboard } from "@/components/dashboard";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  return <Dashboard demo={params.demo === "1"} />;
}
