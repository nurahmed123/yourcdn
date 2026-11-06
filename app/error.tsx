"use client";
import Link from "next/link";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="invite-page">
      <section className="onboarding-card">
        <span
          className="auth-mini-brand"
          style={{ display: "block", marginBottom: 25 }}
        >
          Arionys CDN
        </span>
        <h1>We couldn’t load this page.</h1>
        <p>
          Your workspace is still protected. Try again in a moment, or return to
          sign-in.
        </p>
        <button className="button primary full" onClick={() => retry()}>
          Try again
        </button>
        <Link className="text-button centered" href="/login">
          Return to sign-in
        </Link>
      </section>
    </main>
  );
}
