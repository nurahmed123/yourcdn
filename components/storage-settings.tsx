"use client";
import { useEffect, useState } from "react";
import { Cloud, ShieldCheck, Loader2, LockKeyhole } from "lucide-react";
import { api } from "./client";
export function StorageSettings({ workspaceId }: { workspaceId: string }) {
  const [credentials, setCredentials] = useState({
      accountId: "",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "",
    }),
    [currentPassword, setCurrentPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [version, setVersion] = useState(1);
  useEffect(() => {
    let active = true;
    api(`workspaces/${workspaceId}/storage`)
      .then((d) => {
        if (active) {
          setCredentials((v) => ({
            ...v,
            accountId: d.accountId,
            bucket: d.bucket,
          }));
          setVersion(d.storageVersion);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (challenge) {
        const result = await api(`workspaces/${workspaceId}/storage/verify`, {
          method: "POST",
          body: JSON.stringify({ challengeId: challenge, code }),
        });
        setVersion(result.storageVersion);
        setChallenge("");
        setCode("");
        setMessage(
          "Storage connection updated. New uploads will use this connection.",
        );
      } else {
        const result = await api(`workspaces/${workspaceId}/storage/change`, {
          method: "POST",
          body: JSON.stringify({
            credentials,
            currentPassword,
            privateBucketConfirmed: confirmed,
          }),
        });
        setChallenge(result.challengeId);
        setCurrentPassword("");
        setCredentials((v) => ({ ...v, accessKeyId: "", secretAccessKey: "" }));
        setMessage(
          "Connection verified. Enter the email code to confirm this change.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>Change storage connection</h2>
          <Cloud size={18} />
        </div>
        <form method="post" className="profile-form" onSubmit={submit}>
          <p>
            Update the access keys for your existing R2 bucket, or connect a
            different bucket. Only the workspace owner can make this change.
          </p>
          {challenge ? (
            <label>
              Email verification code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Six-digit verification code"
              />
            </label>
          ) : (
            <>
              <label>
                Cloudflare account ID
                <input
                  autoComplete="off"
                  spellCheck={false}
                  required
                  pattern="[a-fA-F0-9]{32}"
                  value={credentials.accountId}
                  onChange={(e) =>
                    setCredentials((v) => ({
                      ...v,
                      accountId: e.target.value.trim(),
                    }))
                  }
                />
              </label>
              <label>
                Bucket name
                <input
                  autoComplete="off"
                  required
                  value={credentials.bucket}
                  onChange={(e) =>
                    setCredentials((v) => ({
                      ...v,
                      bucket: e.target.value.trim(),
                    }))
                  }
                />
              </label>
              <label>
                New access key ID
                <input
                  type="password"
                  autoComplete="off"
                  minLength={16}
                  required
                  value={credentials.accessKeyId}
                  onChange={(e) =>
                    setCredentials((v) => ({
                      ...v,
                      accessKeyId: e.target.value.trim(),
                    }))
                  }
                  placeholder="Enter the access key ID"
                />
              </label>
              <label>
                New secret access key
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={24}
                  required
                  value={credentials.secretAccessKey}
                  onChange={(e) =>
                    setCredentials((v) => ({
                      ...v,
                      secretAccessKey: e.target.value.trim(),
                    }))
                  }
                  placeholder="Enter the secret access key"
                />
              </label>
              <label>
                Your account password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={12}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label className="permission-option">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  <strong>This bucket is private</strong>
                  <small>
                    Public r2.dev access and public bucket domains are disabled.
                  </small>
                </span>
              </label>
            </>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <p className="profile-success" role="status">
              {message}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}{" "}
            {busy
              ? challenge
                ? "Saving connection…"
                : "Verifying connection…"
              : challenge
                ? "Confirm storage change"
                : "Verify connection & send code"}
          </button>
          {challenge && (
            <button
              type="button"
              className="text-button centered"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setCode("");
                setMessage("");
              }}
            >
              Cancel this change
            </button>
          )}
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Your existing files</h2>
          <LockKeyhole size={18} />
        </div>
        <div className="settings-description">
          <p>
            Rotating keys for the same account and bucket uses the new
            credentials for both existing files and new uploads.
          </p>
          <p>
            Switching to a different bucket preserves the previous encrypted
            connection for existing files. Keep the old bucket and its
            credentials available; files are not automatically moved between
            buckets.
          </p>
          <p>
            File URLs stay the same. Uploads already in progress finish using
            their original connection.
          </p>
          <p>Connection version: {version}</p>
        </div>
        <div className="panel-notice">
          <ShieldCheck size={17} />
          <span>
            Passwords and email verification are required. Stored access keys
            remain encrypted and are never returned to the browser.
          </span>
        </div>
      </section>
    </div>
  );
}
