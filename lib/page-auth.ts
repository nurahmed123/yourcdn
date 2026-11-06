import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { identity } from "./auth";
import { me } from "./workspaces";
import { ApiError } from "./security";
export async function pageRequest() {
  return new Request("http://internal", {
    headers: { cookie: (await cookies()).toString() },
  });
}
export async function optionalAccount() {
  const request = await pageRequest();
  try {
    return await identity(request);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
export async function requireAccount() {
  const user = await optionalAccount();
  if (!user) redirect("/login");
  return user;
}
export async function requireWorkspace() {
  await requireAccount();
  const user = await me(await pageRequest());
  if (!user.activeWorkspace || user.activeWorkspace.status !== "ready")
    redirect("/onboarding");
  return user;
}
