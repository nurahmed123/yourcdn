"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Cloud,
  FolderOpen,
  Loader2,
  LockKeyhole,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { api } from "./client";
export function Onboarding({
  initialUser,
  createNew,
}: {
  initialUser: any;
  createNew: boolean;
}) {
  const pending =
    !createNew && initialUser.activeWorkspace?.status === "pending"
      ? initialUser.activeWorkspace
      : null;
  const [workspace, setWorkspace] = useState<any>(pending),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [credentials, setCredentials] = useState({
      accountId: "",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "",
    }),
    [confirmed, setConfirmed] = useState(false);
  const [origin, setOrigin] = useState("https://your-app.example");
  useEffect(() => setOrigin(window.location.origin), []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!workspace) {
        setWorkspace(
          await api("workspaces", {
            method: "POST",
            body: JSON.stringify({ name }),
          }),
        );
        window.history.replaceState({}, "", "/onboarding");
      } else {
        const result = await api(`workspaces/${workspace.id}/storage`, {
          method: "POST",
          body: JSON.stringify({
            credentials,
            privateBucketConfirmed: confirmed,
          }),
        });
        setCredentials({
          accountId: "",
          bucket: "",
          accessKeyId: "",
          secretAccessKey: "",
        });
        window.location.assign(result.next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-page">
      <header>
        <a className="auth-logo" href="/dashboard">
          <span className="auth-logo-mark">A</span>arionys<span>CDN</span>
        </a>
        <button
          className="text-button"
          onClick={async () => {
            try {
              await api("auth/logout", { method: "POST", body: "{}" });
            } finally {
              window.location.assign("/login");
            }
          }}
        >
          <LogOut size={15} />
          Sign out
        </button>
      </header>
      <div className="onboarding-grid">
        <aside>
          <p className="auth-eyebrow">A space of your own</p>
          <h1>
            {workspace
              ? "Bring your storage.\nWe’ll take care of the workspace."
              : "Let’s set up your first workspace."}
          </h1>
          <p>
            Each workspace has its own file library, storage connection, team,
            and API keys. Switch between them whenever you need.
          </p>
          <ol className="setup-steps">
            <li className={!workspace ? "current" : "done"}>
              <span>1</span>
              <div>
                <strong>Name your workspace</strong>
                <small>Give your project a place to grow.</small>
              </div>
            </li>
            <li className={workspace ? "current" : ""}>
              <span>2</span>
              <div>
                <strong>Connect your R2 bucket</strong>
                <small>Your files stay in your own storage.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Make yourself at home</strong>
                <small>Upload, organize, invite, and build.</small>
              </div>
            </li>
          </ol>
          {initialUser.workspaces.some((w: any) => w.status === "ready") && (
            <div className="existing-workspaces">
              <strong>Or continue in a workspace</strong>
              {initialUser.workspaces
                .filter((w: any) => w.status === "ready")
                .map((w: any) => (
                  <button
                    key={w.id}
                    className="button secondary full"
                    onClick={async () => {
                      try {
                        const result = await api(`workspaces/${w.id}/switch`, {
                          method: "POST",
                          body: "{}",
                        });
                        window.location.assign(result.next);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <FolderOpen size={15} />
                    {w.name}
                    <ArrowRight size={14} />
                  </button>
                ))}
            </div>
          )}
        </aside>
        <section className="onboarding-card">
          <span className="onboarding-icon">
            {workspace ? <Cloud size={27} /> : <FolderOpen size={27} />}
          </span>
          <h2>
            {workspace ? `Connect ${workspace.name}` : "Create a workspace"}
          </h2>
          <p>
            {workspace
              ? "Use credentials with Object Read & Write access to this bucket. We verify the connection before completing setup."
              : `Hi ${initialUser.name}. A workspace keeps your projects and team’s files together.`}
          </p>
          <form method="post" onSubmit={submit}>
            {!workspace ? (
              <label>
                Workspace name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Arionys Studio"
                />
              </label>
            ) : (
              <>
                <label>
                  Cloudflare account ID
                  <input
                    required
                    autoComplete="off"
                    spellCheck={false}
                    pattern="[a-fA-F0-9]{32}"
                    value={credentials.accountId}
                    onChange={(e) =>
                      setCredentials((v) => ({
                        ...v,
                        accountId: e.target.value.trim(),
                      }))
                    }
                    placeholder="32-character account ID"
                  />
                </label>
                <label>
                  Bucket name
                  <input
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={credentials.bucket}
                    onChange={(e) =>
                      setCredentials((v) => ({
                        ...v,
                        bucket: e.target.value.trim(),
                      }))
                    }
                    placeholder="my-assets"
                  />
                </label>
                <label>
                  Access key ID
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    minLength={16}
                    value={credentials.accessKeyId}
                    onChange={(e) =>
                      setCredentials((v) => ({
                        ...v,
                        accessKeyId: e.target.value.trim(),
                      }))
                    }
                    placeholder="R2 access key ID"
                  />
                </label>
                <label>
                  Secret access key
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={24}
                    value={credentials.secretAccessKey}
                    onChange={(e) =>
                      setCredentials((v) => ({
                        ...v,
                        secretAccessKey: e.target.value.trim(),
                      }))
                    }
                    placeholder="R2 secret access key"
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
                    <strong>My bucket is private</strong>
                    <small>
                      I have disabled r2.dev access and public bucket domains.
                    </small>
                  </span>
                </label>
                <div className="onboarding-security">
                  <LockKeyhole size={17} />
                  <p>
                    Credentials are encrypted on the server with AES-256-GCM
                    before being saved. They are never sent back to the browser.
                  </p>
                </div>
                <details className="cors-help">
                  <summary>Allow browser uploads to your bucket</summary>
                  <p>
                    In Cloudflare → R2 → your bucket → Settings → CORS, add the
                    exact origin where you use Arionys.
                  </p>
                  <pre>
                    {JSON.stringify(
                      [
                        {
                          AllowedOrigins: [origin],
                          AllowedMethods: ["PUT"],
                          AllowedHeaders: ["Content-Type", "Content-Length"],
                          ExposeHeaders: ["ETag"],
                          MaxAgeSeconds: 3600,
                        },
                      ],
                      null,
                      2,
                    )}
                  </pre>
                  <p>
                    Also configure a one-day expiry lifecycle rule for the{" "}
                    <code>staging/</code> prefix.
                  </p>
                </details>
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
              ) : workspace ? (
                <ShieldCheck size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              {busy
                ? workspace
                  ? "Verifying your storage…"
                  : "Creating workspace…"
                : workspace
                  ? "Verify & finish setup"
                  : "Continue to storage"}
            </button>
          </form>
          <div className="onboarding-footnote">
            Invited to someone else’s workspace? Open the invitation from your
            email. You won’t need an R2 connection.
          </div>
        </section>
      </div>
    </main>
  );
}
