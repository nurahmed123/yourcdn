"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, ArrowRight, Loader2 } from "lucide-react";
import { api } from "./client";
export function Invitation() {
  const params = useSearchParams(),
    token = params.get("token") || "";
  const [info, setInfo] = useState<any>(null),
    [user, setUser] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`auth/invite?token=${encodeURIComponent(token)}`)
      .then((i) => {
        if (active) setInfo(i);
      })
      .catch((e) => setError(e.message));
    api("me")
      .then((u) => {
        if (active) setUser(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="invite-page">
      <section className="onboarding-card">
        <span className="onboarding-icon">
          <Users size={28} />
        </span>
        <h1>You’re invited.</h1>
        {info ? (
          <>
            <p>
              Join <strong>{info.workspaceName}</strong> using{" "}
              <strong>{info.email}</strong>. You’ll share this workspace’s
              storage—no R2 setup needed.
            </p>
            {user ? (
              <>
                <p>Signed in as {user.email}</p>
                <button
                  className="button primary full"
                  disabled={busy || user.email !== info.email}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await api("invitations/accept", {
                        method: "POST",
                        body: JSON.stringify({ token }),
                      });
                      window.location.assign(result.next);
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Users size={16} />
                  )}
                  Join workspace
                </button>
                {user.email !== info.email && (
                  <>
                    <p className="form-error">
                      Sign in with the invited email address to accept.
                    </p>
                    <button
                      className="text-button centered"
                      onClick={async () => {
                        try {
                          await api("auth/logout", {
                            method: "POST",
                            body: "{}",
                          });
                          window.location.assign(
                            `/login?invite=${encodeURIComponent(token)}`,
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Sign out and switch account
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="invitation-actions">
                <Link
                  className="button primary full"
                  href={`/login?invite=${encodeURIComponent(token)}`}
                >
                  Sign in to join
                  <ArrowRight size={16} />
                </Link>
                <Link
                  className="button secondary full"
                  href={`/signup?invite=${encodeURIComponent(token)}`}
                >
                  Create an account
                </Link>
              </div>
            )}
          </>
        ) : !error ? (
          <Loader2 className="spin" />
        ) : null}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
