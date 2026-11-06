import type { Metadata } from "next";
import Link from "next/link";
import { ApiDocumentation } from "@/components/api-documentation";
import { Brand } from "@/components/brand";
import Workspace from "@/components/workspace";
import { optionalWorkspace } from "@/lib/page-auth";

export const metadata: Metadata = {
  title: "API documentation",
  description: "Integrate YourCDN with the single-request upload API.",
};

export default async function Page() {
  const user = await optionalWorkspace();
  if (user) return <Workspace initialUser={user} />;

  return (
    <main className="public-docs">
      <header className="public-docs-header">
        <Link href="/about" aria-label="About YourCDN">
          <Brand />
        </Link>
        <Link className="button secondary" href="/login">
          Sign in
        </Link>
      </header>
      <div className="public-docs-intro">
        <h1>API documentation</h1>
        <p>
          Upload files from your application and get their URLs in one request.
        </p>
      </div>
      <ApiDocumentation standalone />
    </main>
  );
}
