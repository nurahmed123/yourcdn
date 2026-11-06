import Workspace from "@/components/workspace";
import { requireWorkspace } from "@/lib/page-auth";
export default async function Page() {
  const user = await requireWorkspace();
  return <Workspace initialUser={user} />;
}
