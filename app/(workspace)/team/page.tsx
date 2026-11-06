import Workspace from "@/components/workspace";
import { requireWorkspace } from "@/lib/page-auth";
import { redirect } from "next/navigation";
export default async function Page() {
  const user = await requireWorkspace();
  if (!["owner", "admin"].includes(user.role)) redirect("/dashboard");
  return <Workspace initialUser={user} />;
}
