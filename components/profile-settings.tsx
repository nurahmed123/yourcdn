"use client";
import { useState } from "react";
import {
  ShieldCheck,
  Loader2,
  LogOut,
  UserRound,
  LockKeyhole,
} from "lucide-react";
import { api } from "./client";
export function ProfileSettings({
  user,
  onUpdated,
}: {
  user: { name: string; email: string };
  onUpdated: (name: string) => void;
}) {
  const [name, setName] = useState(user.name),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState("");
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("profile", { method: "PATCH", body: JSON.stringify({ name }) });
      onUpdated(name);
      setMessage("Your profile has been updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (challenge) {
        await api("profile/password/verify", {
          method: "POST",
          body: JSON.stringify({ challengeId: challenge, code }),
        });
        window.location.assign("/login?passwordChanged=1");
      } else {
        if (newPassword !== confirmPassword)
          throw new Error("New passwords do not match.");
        const result = await api("profile/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        setChallenge(result.challengeId);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage("Verification code sent to your email.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-settings">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="profile-success" role="status">
          <ShieldCheck size={16} />
          {message}
        </div>
      )}
      <section className="panel">
        <div className="panel-title">
          <h2>Your profile</h2>
          <UserRound size={18} />
        </div>
        <form method="post" className="profile-form" onSubmit={saveProfile}>
          <label>
            Display name
            <input
              required
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email address
            <input type="email" value={user.email} readOnly />
            <small>
              Your verified email identifies your account across workspaces.
            </small>
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} /> : null}Save changes
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Password & security</h2>
          <LockKeyhole size={18} />
        </div>
        <form method="post" className="profile-form" onSubmit={changePassword}>
          <p>
            Changing your password requires your current password and a fresh
            email verification code. All sessions will be signed out after
            confirmation.
          </p>
          {challenge ? (
            <label>
              Verification code
              <input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Six-digit code"
              />
            </label>
          ) : (
            <>
              <label>
                Current password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  minLength={12}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
            </>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ShieldCheck size={15} />
            )}{" "}
            {challenge ? "Verify & change password" : "Verify password change"}
          </button>
          {challenge && (
            <button
              type="button"
              className="text-button centered"
              onClick={() => {
                setChallenge("");
                setCode("");
              }}
            >
              Start again
            </button>
          )}
        </form>
      </section>
      <section className="panel profile-session">
        <div>
          <h2>Signed in as {user.name}</h2>
          <p>{user.email}</p>
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            setBusy(true);
            try {
              await api("auth/logout", { method: "POST", body: "{}" });
              window.location.assign("/login");
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </section>
    </div>
  );
}
