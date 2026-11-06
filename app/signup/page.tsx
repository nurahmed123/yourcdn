import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { optionalAccount } from "@/lib/page-auth";
import { AuthPage } from "@/components/auth-page";
export const metadata: Metadata = { title: "Create an account" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; password?: string }>;
}) {
  const params = await searchParams;
  if (params.password !== undefined) redirect("/signup");
  if (await optionalAccount())
    redirect(
      params.invite
        ? `/invite?token=${encodeURIComponent(params.invite)}`
        : "/dashboard",
    );
  return <AuthPage mode="signup" />;
}
