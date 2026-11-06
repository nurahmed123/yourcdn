"use client";
import { Brand, BrandMark } from "./brand";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Cloud,
  FolderTree,
  KeyRound,
  Loader2,
  ShieldCheck,
  LockKeyhole,
} from "lucide-react";
import { api } from "./client";
export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const params = useSearchParams(),
    invite = params.get("invite");
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("password")) {
      url.searchParams.delete("password");
      url.searchParams.delete("email");
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search,
      );
    }
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        const result = await api("auth/verify", {
          method: "POST",
          body: JSON.stringify({ challengeId: challenge, code }),
        });
        window.location.assign(
          invite ? `/invite?token=${encodeURIComponent(invite)}` : result.next,
        );
      } else {
        const result = await api(`auth/${mode}`, {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            ...(mode === "signup" ? { name } : {}),
          }),
        });
        setChallenge(result.challengeId);
        setPassword("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const link = (path: string) =>
    invite ? `${path}?invite=${encodeURIComponent(invite)}` : path;
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="auth-logo" href="/login">
          <Brand />
        </Link>
        <div className="auth-story-content">
          <div className="auth-cloud-art">
            <Cloud size={110} strokeWidth={0.85} />
            <span className="art-file one">
              <FolderTree size={23} />
            </span>
            <span className="art-file two">
              <KeyRound size={22} />
            </span>
          </div>
          <h1>
            Your files.
            <br />
            Your own corner of the cloud.
          </h1>
          <p>
            A thoughtful workspace for every asset, every application, and
            everyone you work with.
          </p>
          <div className="auth-features">
            <span>
              <FolderTree size={17} />
              Folders that fit the way you work
            </span>
            <span>
              <KeyRound size={17} />A scoped API for every application
            </span>
            <span>
              <ShieldCheck size={17} />
              Your storage. Your access. Your control.
            </span>
          </div>
        </div>
        <small>
          <Link href="/about">About YourCDN</Link>
        </small>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="auth-mini-brand">
            <BrandMark size={24} /> YourCDN
          </span>
          <p className="auth-eyebrow">
            {challenge
              ? "One more step"
              : mode === "signup"
                ? "Make space for your next idea"
                : "Your workspace awaits"}
          </p>
          <h2>
            {challenge
              ? "Check your inbox"
              : mode === "signup"
                ? "Create your account"
                : "Welcome back"}
          </h2>
          <p className="auth-description">
            {challenge
              ? `Enter the six-digit code sent to ${email}.`
              : mode === "signup"
                ? "Start with your account. Connect your storage next."
                : "Sign in to manage your files and workspaces."}
          </p>
          <form method="post" onSubmit={submit}>
            {challenge ? (
              <label>
                Verification code
                <input
                  className="otp-input"
                  aria-label="Verification code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                />
                <small>Valid for 10 minutes. Maximum 5 attempts.</small>
              </label>
            ) : (
              <>
                {mode === "signup" && (
                  <label>
                    Your name
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="What should we call you?"
                    />
                  </label>
                )}
                <label>
                  Email address
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    name="password"
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    minLength={12}
                    maxLength={72}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "signup"
                        ? "At least 12 characters"
                        : "Enter your password"
                    }
                  />
                </label>
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : challenge ? (
                <ShieldCheck size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              {challenge
                ? "Verify and continue"
                : mode === "signup"
                  ? "Create account"
                  : "Continue securely"}
            </button>
          </form>
          {challenge ? (
            <button
              className="text-button centered"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setCode("");
                setError("");
              }}
            >
              Start again
            </button>
          ) : (
            <p className="auth-switch">
              {mode === "signup"
                ? "Already have an account?"
                : "New to YourCDN?"}{" "}
              <Link href={link(mode === "signup" ? "/login" : "/signup")}>
                {mode === "signup" ? "Sign in" : "Create an account"}
              </Link>
            </p>
          )}
          <div className="auth-security">
            <LockKeyhole size={14} />
            Every sign-in requires an email verification code.
          </div>
        </div>
      </section>
    </main>
  );
}
