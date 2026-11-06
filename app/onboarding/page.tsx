import { requireAccount, pageRequest } from "@/lib/page-auth";
import { me } from "@/lib/workspaces";
import { Onboarding } from "@/components/onboarding";
import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  await requireAccount();
  const user = await me(await pageRequest());
  const createNew = (await searchParams).new === "1";
  if (!createNew && user.activeWorkspace?.status === "ready")
    redirect("/dashboard");
  return <Onboarding initialUser={user} createNew={createNew} />;
}
