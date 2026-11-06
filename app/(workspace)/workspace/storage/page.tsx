import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { requireWorkspace } from "@/lib/page-auth";
export default async function Page() {
  const user = await requireWorkspace();
  if (user.role !== "owner") redirect("/dashboard");
  return <Workspace initialUser={user} />;
}
