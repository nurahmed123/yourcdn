import { Brand } from "@/components/brand";
import Link from "next/link";
export default function NotFound() {
  return (
    <main className="invite-page">
      <section className="onboarding-card">
        <span
          className="auth-mini-brand"
          style={{ display: "block", marginBottom: 25 }}
        >
          <Brand />
        </span>
        <h1>This page isn’t here.</h1>
        <p>
          The link may have changed. Return to your workspace to find what you
          need.
        </p>
        <Link className="button primary full" href="/dashboard">
          Back to your workspace
        </Link>
      </section>
    </main>
  );
}
