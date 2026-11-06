"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { api } from "./client";
import { uploadFile } from "./upload-file";
import { ApiDocumentation } from "./api-documentation";
import { StorageSettings } from "./storage-settings";
import { ProfileSettings } from "./profile-settings";
import { MoveFileDialog } from "./move-file";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Globe2,
  Grid2X2,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  List,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";
type View =
  | "Overview"
  | "File library"
  | "API keys"
  | "Team members"
  | "Activity log"
  | "Settings"
  | "Documentation"
  | "Storage settings";
type StoredFile = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  visibility: "public" | "private";
  url: string;
  createdAt: string;
  source: string;
};
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  requests: number;
  maxRequests: number;
  maxUploadBytes: number;
  revokedAt: string | null;
  createdAt: string;
};
type User = {
  userId: string;
  email: string;
  name: string;
  role: string;
  activeWorkspace: {
    id: string;
    name: string;
    status: string;
    role: string;
  } | null;
  workspaces: { id: string; name: string; status: string; role: string }[];
};

type Stats = {
  totals: { count: number; bytes: number; public: number };
  types: { _id: string; bytes: number; count: number }[];
  recent: { _id: string; count: number; bytes: number }[];
  keys: number;
  team: number;
};
type Member = {
  id: string;
  email: string;
  role: string;
  disabledAt: string | null;
};
const size = (n: number) =>
  n === 0
    ? "0 B"
    : n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : n < 1073741824
          ? `${(n / 1048576).toFixed(1)} MB`
          : `${(n / 1073741824).toFixed(2)} GB`;
const date = (d: string) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <svg
          width="27"
          height="27"
          viewBox="0 0 30 30"
          fill="none"
          aria-hidden="true"
        >
          <path d="M5 23 14 6h3l9 17h-6l-5-10-5 10H5Z" fill="currentColor" />
          <path d="m13 21 3-5 4 7h-6l-1-2Z" fill="#b8b1ff" />
        </svg>
      </span>
      <span>
        arionys<span className="brand-cdn">CDN</span>
      </span>
    </div>
  );
}
function FileIcon({ type }: { type: string }) {
  const Icon = type.startsWith("image")
    ? FileImage
    : type.startsWith("video")
      ? FileVideo
      : type.startsWith("audio")
        ? FileAudio
        : type.includes("zip")
          ? FileArchive
          : type.includes("json") || type.includes("javascript")
            ? FileCode2
            : FileText;
  return (
    <span className={`file-icon ${type.split("/")[0]}`}>
      <Icon size={21} />
    </span>
  );
}
function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = box.current;
    root?.querySelector<HTMLElement>("input,button,select,textarea")?.focus();
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && root) {
        const list = Array.from(
          root.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href]",
          ),
        );
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
      >
        <button
          className="icon-button close-modal"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <Brand small />
        <h2>{title}</h2>
        {description && (
          <p className="muted modal-description">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}
const routeViews: Record<string, View> = {
  "/dashboard": "Overview",
  "/files": "File library",
  "/api-keys": "API keys",
  "/team": "Team members",
  "/activity": "Activity log",
  "/settings": "Settings",
  "/docs": "Documentation",
  "/workspace/storage": "Storage settings",
};
const viewRoutes = Object.fromEntries(
  Object.entries(routeViews).map(([route, view]) => [view, route]),
);
export default function Workspace({ initialUser }: { initialUser: User }) {
  const router = useRouter(),
    pathname = usePathname(),
    searchParams = useSearchParams();
  const view = routeViews[pathname] || "Overview";
  const folderId = searchParams.get("folder");
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]),
    [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [folderOpen, setFolderOpen] = useState(false),
    [movingFile, setMovingFile] = useState<StoredFile | null>(null);
  const [mobile, setMobile] = useState(false),
    [user, setUser] = useState<User | null>(initialUser),
    [stats, setStats] = useState<Stats | null>(null),
    [files, setFiles] = useState<StoredFile[]>([]),
    [keys, setKeys] = useState<ApiKey[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [pending, setPending] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]),
    [loading, setLoading] = useState(false),
    [pageError, setPageError] = useState("");
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [grid, setGrid] = useState(false),
    [sort, setSort] = useState("newest"),
    [selected, setSelected] = useState<string[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false),
    [queue, setQueue] = useState<
      {
        file: globalThis.File;
        state: string;
        progress: number;
        requestId: string;
      }[]
    >([]),
    [visibility, setVisibility] = useState("private"),
    [drag, setDrag] = useState(false),
    [keyOpen, setKeyOpen] = useState(false),
    [keySecret, setKeySecret] = useState(""),
    [inviteOpen, setInviteOpen] = useState(false),
    [keyScopes, setKeyScopes] = useState<string[]>([
      "files:read",
      "files:upload",
    ]);
  const input = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    closeMenuButton = useRef<HTMLButtonElement>(null),
    sidebar = useRef<HTMLElement>(null),
    main = useRef<HTMLElement>(null),
    fileRequest = useRef(0);
  const notify = (message: string) => {
    setToast(message);
  };
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refresh = useCallback(async () => {
    setStats(await api("stats"));
  }, []);
  useEffect(() => {
    let active = true;
    api<User>("me")
      .then((me) => {
        if (active) setUser(me);
      })
      .catch(() => router.replace("/login"));
    void refresh().catch((e) => setPageError(e.message));
    return () => {
      active = false;
    };
  }, [refresh, router]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 760px)");
    const closeOnDesktop = () => {
      if (!compact.matches) setMobile(false);
    };
    compact.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => compact.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    closeMenuButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
      if (event.key === "Tab" && sidebar.current) {
        const items = Array.from(
          sidebar.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select:not(:disabled), a[href]",
          ),
        );
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      if (window.matchMedia("(max-width: 760px)").matches) {
        menuButton.current?.focus();
      } else {
        main.current?.focus();
      }
    };
  }, [mobile]);
  const loadFiles = useCallback(
    async (next?: string) => {
      if (!user) return;
      const request = ++fileRequest.current;
      setLoading(true);
      setPageError("");
      try {
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        if (type !== "all") params.set("type", type);
        if (next) params.set("cursor", next);
        if (folderId) params.set("folderId", folderId);
        const [result, folderResult] = await Promise.all([
          api(`v1/files?${params}`),
          api(`v1/folders${folderId ? `?parentId=${folderId}` : ""}`),
        ]);
        if (request !== fileRequest.current) return;
        setFolders(folderResult.folders);
        setBreadcrumbs(folderResult.breadcrumbs);
        setFiles((old) => (next ? [...old, ...result.files] : result.files));
        setCursor(result.nextCursor);
        if (!next) setSelected([]);
      } catch (e) {
        if (request === fileRequest.current) setPageError((e as Error).message);
      } finally {
        if (request === fileRequest.current) setLoading(false);
      }
    },
    [user, search, type, folderId],
  );
  useEffect(() => {
    if (view !== "File library") return;
    ++fileRequest.current;
    const timer = setTimeout(() => void loadFiles(), 250);
    return () => clearTimeout(timer);
  }, [loadFiles, view]);
  const loadView = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setPageError("");
    try {
      if (view === "API keys") setKeys(await api("keys"));
      if (view === "Team members") {
        const t = await api("team");
        setMembers(t.members);
        setPending(t.pending);
      }
      if (view === "Activity log") setEvents(await api("activity"));
      if (view === "Overview") await refresh();
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, view, refresh]);
  useEffect(() => {
    void loadView();
  }, [loadView]);
  function navigate(v: View) {
    router.push(viewRoutes[v]);
    setMobile(false);
    setPageError("");
  }
  function requireUser() {
    if (!user) {
      router.replace("/login");
      return false;
    }
    return true;
  }
  function addFiles(incoming: FileList | globalThis.File[] | null) {
    if (!incoming || !requireUser()) return;
    if (user?.role === "viewer") {
      notify("You have read-only access to this workspace.");
      return;
    }
    const list = Array.from(incoming);
    setQueue((old) => [
      ...old,
      ...list.map((file) => ({
        file,
        state: "Ready to upload",
        progress: 0,
        requestId: crypto.randomUUID(),
      })),
    ]);
    setUploadOpen(true);
  }
  async function uploadAll() {
    setBusy(true);
    let completed = 0;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.state === "Uploaded") continue;
      try {
        setQueue((q) =>
          q.map((v, j) =>
            j === i ? { ...v, state: "Uploading…", progress: 0 } : v,
          ),
        );
        await uploadFile(
          item.file,
          { requestId: item.requestId, visibility, folderId },
          (progress, processing) => {
            setQueue((q) =>
              q.map((v, j) =>
                j === i
                  ? {
                      ...v,
                      progress,
                      state: processing
                        ? "Processing…"
                        : progress === 100
                          ? "Uploaded"
                          : "Uploading…",
                    }
                  : v,
              ),
            );
          },
        );
        completed++;
      } catch (error) {
        setQueue((q) =>
          q.map((v, j) =>
            j === i
              ? { ...v, state: (error as Error).message, progress: 0 }
              : v,
          ),
        );
      }
    }
    setBusy(false);
    await Promise.all([loadFiles(), refresh()]);
    if (completed)
      notify(
        `${completed} file${completed === 1 ? "" : "s"} uploaded to your workspace.`,
      );
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard unavailable. Select and copy the text manually.");
    }
  }
  async function deleteFiles(ids: string[]) {
    if (
      !window.confirm(
        `Permanently delete ${ids.length} file${ids.length === 1 ? "" : "s"} from storage?`,
      )
    )
      return;
    let count = 0;
    for (const id of ids) {
      try {
        await api(`v1/files/${id}`, { method: "DELETE" });
        count++;
      } catch (e) {
        notify((e as Error).message);
        break;
      }
    }
    await Promise.all([loadFiles(), refresh()]);
    if (count) notify(`${count} file${count === 1 ? "" : "s"} deleted.`);
  }
  async function createKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api("keys", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          scopes: keyScopes,
          expiresInDays:
            form.get("days") === "never" ? null : Number(form.get("days")),
          maxRequests: Number(form.get("requests")),
          maxUploadBytes: Number(form.get("mb")) * 1048576,
        }),
      });
      setKeySecret(result.secret);
      setKeys(await api("keys"));
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inviteMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api("team", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
        }),
      });
      setInviteOpen(false);
      await loadView();
      notify("Invitation sent.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sortedFiles = [...files].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "size"
        ? b.size - a.size
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const navItems = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "File library", icon: FolderOpen },
    { name: "API keys", icon: KeyRound },
    { name: "Team members", icon: Users },
    { name: "Activity log", icon: Activity },
  ] as const;
  const canAdmin = user && ["owner", "admin"].includes(user.role),
    canEdit = user && user.role !== "viewer";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside ref={sidebar} className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close menu"
            ref={closeMenuButton}
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-picker">
          <span className="workspace-avatar">
            {user?.activeWorkspace?.name[0] || "A"}
          </span>
          <label>
            <span className="sr-only">Switch workspace</span>
            <select
              aria-label="Switch workspace"
              value={user?.activeWorkspace?.id || ""}
              onChange={async (e) => {
                try {
                  const result = await api(
                    `workspaces/${e.target.value}/switch`,
                    { method: "POST", body: "{}" },
                  );
                  window.location.assign(result.next);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              {user?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <small>{user?.role} workspace</small>
          </label>
        </div>
        <button
          className="new-workspace-button"
          onClick={() => router.push("/onboarding?new=1")}
        >
          <Plus size={13} />
          New workspace
        </button>
        <div className="nav-caption">Workspace</div>
        <nav aria-label="Workspace navigation">
          {navItems
            .filter((n) => n.name !== "Team members" || !user || canAdmin)
            .map((n) => (
              <button
                key={n.name}
                className={`nav-item ${view === n.name ? "active" : ""}`}
                aria-current={view === n.name ? "page" : undefined}
                onClick={() => navigate(n.name)}
              >
                <n.icon size={19} />
                <span>{n.name}</span>
                {n.name === "File library" && stats && (
                  <span className="nav-count">{stats.totals.count}</span>
                )}
                {view === n.name && <span className="nav-active-dot" />}
              </button>
            ))}
        </nav>
        <div className="nav-caption developer-caption">Developer</div>
        <nav aria-label="Developer and account navigation">
          <button
            className={`nav-item ${view === "Documentation" ? "active" : ""}`}
            aria-current={view === "Documentation" ? "page" : undefined}
            onClick={() => navigate("Documentation")}
          >
            <Code2 size={19} />
            <span>API documentation</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            className={`nav-item ${view === "Settings" ? "active" : ""}`}
            aria-current={view === "Settings" ? "page" : undefined}
            onClick={() => navigate("Settings")}
          >
            <Settings2 size={19} />
            <span>Settings</span>
          </button>
        </nav>
        {user?.role === "owner" && (
          <button
            className={`nav-item ${view === "Storage settings" ? "active" : ""}`}
            aria-current={view === "Storage settings" ? "page" : undefined}
            onClick={() => navigate("Storage settings")}
          >
            <Cloud size={19} />
            <span>Storage settings</span>
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="storage-mini">
            <div>
              <span>
                <Cloud size={16} />
                Workspace storage
              </span>
              <span className="tiny-dot green" />
            </div>
            <p>{stats ? size(stats.totals.bytes) : "Your file library"}</p>
            <span className="storage-line">
              <i style={{ width: stats?.totals.bytes ? "100%" : "0%" }} />
            </span>
            <small>
              {stats
                ? `${stats.totals.count} files stored securely`
                : "Your infrastructure, your control"}
            </small>
          </div>
          <button
            className="help-button"
            onClick={() => navigate("Documentation")}
          >
            <CircleHelp size={18} />
            Help & documentation
            <ArrowUpRight size={15} />
          </button>
          <button
            className="account"
            onClick={() => (user ? navigate("Settings") : requireUser())}
          >
            <span className="avatar">
              {user ? user.email[0].toUpperCase() : "N"}
            </span>
            <span>
              <strong>{user ? user.name : "Your workspace"}</strong>
              <small>
                {user
                  ? user.role === "owner"
                    ? "Workspace owner"
                    : user.role
                  : "Sign in to get started"}
              </small>
            </span>
            <MoreHorizontal size={19} />
          </button>
        </div>
      </aside>
      <main
        ref={main}
        className="main"
        id="main-content"
        tabIndex={-1}
        inert={mobile}
      >
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open menu"
              aria-expanded={mobile}
              ref={menuButton}
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <LockKeyhole size={12} />
              Private workspace
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Open documentation"
              onClick={() => navigate("Documentation")}
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="top-avatar"
              aria-label="Your account"
              onClick={() => (user ? navigate("Settings") : requireUser())}
            >
              {user ? user.email[0].toUpperCase() : "N"}
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="heading-kicker">
                <span className="tiny-dot purple" />
                {view === "File library"
                  ? "A home for every file"
                  : view === "Overview"
                    ? "Everything, in one place"
                    : "Arionys workspace"}
              </div>
              <h1>{view}</h1>
              <p>
                {
                  {
                    Overview: "Your storage and delivery, at a glance.",
                    "File library":
                      "Upload, organize, and share. Your files, ready for the world.",
                    "API keys":
                      "Connect your applications with precisely the access they need.",
                    "Team members": "Give the right people the right access.",
                    "Activity log":
                      "A clear record of what happens in your workspace.",
                    Settings: "Manage your profile and account security.",
                    "Storage settings":
                      "Manage the storage connection for this workspace.",
                    Documentation:
                      "From your application to the edge, in three requests.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              {view === "File library" || view === "Overview" ? (
                <>
                  <button
                    className="button secondary desktop-label"
                    onClick={() => navigate("Documentation")}
                  >
                    <Code2 size={16} />
                    API docs
                    <ArrowUpRight size={14} />
                  </button>
                  {canEdit && (
                    <button
                      className="button primary"
                      onClick={() => {
                        if (requireUser()) {
                          setQueue([]);
                          setUploadOpen(true);
                        }
                      }}
                    >
                      <Plus size={17} />
                      Upload files
                    </button>
                  )}
                </>
              ) : view === "API keys" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    if (requireUser()) {
                      setKeySecret("");
                      setKeyOpen(true);
                    }
                  }}
                >
                  <Plus size={17} />
                  Create API key
                </button>
              ) : view === "Team members" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    if (requireUser()) setInviteOpen(true);
                  }}
                >
                  <Plus size={17} />
                  Invite member
                </button>
              ) : null}
            </div>
          </div>
          {pageError && (
            <div className="error-banner" role="alert">
              {pageError}
              <button
                onClick={() => {
                  void loadFiles();
                  void loadView();
                }}
              >
                Try again
              </button>
            </div>
          )}
          {(view === "File library" || view === "Overview") && (
            <>
              <div className="metrics">
                <div className="metric">
                  <span className="metric-icon lavender">
                    <HardDrive size={20} />
                  </span>
                  <div>
                    <span>Storage used</span>
                    <strong>
                      {stats ? size(stats.totals.bytes) : "—"}
                      <small>in your workspace</small>
                    </strong>
                  </div>
                  <span className="metric-corner">
                    <ArrowUpRight size={16} />
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-icon blue">
                    <FolderOpen size={20} />
                  </span>
                  <div>
                    <span>Total files</span>
                    <strong>
                      {stats ? stats.totals.count.toLocaleString() : "—"}
                      <small>across your workspace</small>
                    </strong>
                  </div>
                </div>
                <div className="metric">
                  <span className="metric-icon mint">
                    <Globe2 size={20} />
                  </span>
                  <div>
                    <span>Public files</span>
                    <strong>
                      {stats ? stats.totals.public.toLocaleString() : "—"}
                      <small>ready to share</small>
                    </strong>
                  </div>
                </div>
                <div className="metric">
                  <span className="metric-icon peach">
                    <KeyRound size={20} />
                  </span>
                  <div>
                    <span>Active API keys</span>
                    <strong>
                      {stats ? stats.keys.toLocaleString() : "—"}
                      <small>connected to your apps</small>
                    </strong>
                  </div>
                </div>
              </div>
              {view === "Overview" ? (
                <div className="overview-layout">
                  <section className="panel">
                    <div className="panel-title">
                      <h2>Upload activity</h2>
                      <span className="badge neutral">Last 7 days · UTC</span>
                    </div>
                    <div className="chart">
                      {Array.from({ length: 7 }, (_, i) => {
                        const d = new Date(Date.now() - (6 - i) * 86400000);
                        const key = d.toISOString().slice(0, 10);
                        const entry = stats?.recent.find((r) => r._id === key);
                        const max = Math.max(
                          1,
                          ...(stats?.recent.map((r) => r.count) || []),
                        );
                        return (
                          <div className="chart-column" key={key}>
                            <span>{entry?.count || 0}</span>
                            <div
                              className="chart-bar"
                              style={{
                                height: `${Math.max(2, ((entry?.count || 0) / max) * 160)}px`,
                              }}
                            />
                            <small>
                              {d.toLocaleDateString("en-US", {
                                weekday: "short",
                                timeZone: "UTC",
                              })}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                    <p className="panel-footnote">
                      Completed uploads only. Activity appears after your first
                      upload.
                    </p>
                  </section>
                  <section className="panel delivery-panel">
                    <span className="delivery-art">
                      <Globe2 size={83} strokeWidth={0.75} />
                      <span />
                      <i />
                    </span>
                    <h2>A shorter path to everywhere.</h2>
                    <p>
                      Store once in R2. Share a stable URL with the people and
                      applications that need it.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate("File library")}
                    >
                      Open your file library
                      <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
              ) : (
                <div className="library-layout">
                  <section className="panel file-panel">
                    <div className="library-header">
                      <div>
                        <h2>
                          All files
                          <span className="count-badge">
                            {stats?.totals.count || 0}
                          </span>
                        </h2>
                        <p>Everything you’ve uploaded, in one place.</p>
                      </div>
                      <div className="view-toggle" aria-label="File display">
                        <button
                          aria-label="List view"
                          aria-pressed={!grid}
                          className={!grid ? "selected" : ""}
                          onClick={() => setGrid(false)}
                        >
                          <List size={17} />
                        </button>
                        <button
                          aria-label="Grid view"
                          aria-pressed={grid}
                          className={grid ? "selected" : ""}
                          onClick={() => setGrid(true)}
                        >
                          <Grid2X2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="folder-toolbar">
                      <div className="folder-breadcrumbs">
                        <button onClick={() => router.push("/files")}>
                          <FolderOpen size={15} />
                          All files
                        </button>
                        {breadcrumbs.map((f) => (
                          <span key={f.id}>
                            <ChevronRight size={13} />
                            <button
                              onClick={() =>
                                router.push(`/files?folder=${f.id}`)
                              }
                            >
                              {f.name}
                            </button>
                          </span>
                        ))}
                      </div>
                      {canEdit && (
                        <button
                          className="button secondary small"
                          onClick={() => setFolderOpen(true)}
                        >
                          <Plus size={14} />
                          New folder
                        </button>
                      )}
                    </div>
                    {canEdit && (
                      <div
                        className={`dropzone ${drag ? "dragging" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDrag(true);
                        }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDrag(false);
                          addFiles(e.dataTransfer.files);
                        }}
                      >
                        <span className="upload-cloud">
                          <Upload size={24} strokeWidth={1.7} />
                        </span>
                        <div>
                          <strong>
                            Drop your files here, or{" "}
                            <button
                              onClick={() => {
                                if (requireUser()) input.current?.click();
                              }}
                            >
                              browse files
                            </button>
                          </strong>
                          <p>
                            Images, videos, documents, and everything in
                            between.
                          </p>
                        </div>
                        <span className="dropzone-note">
                          <LockKeyhole size={13} />
                          Private by default
                        </span>
                      </div>
                    )}
                    <div className="library-controls">
                      <div className="type-tabs">
                        {[
                          ["all", "All files"],
                          ["image", "Images"],
                          ["video", "Videos"],
                          ["application", "Documents"],
                          ["audio", "Audio"],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            className={type === id ? "active" : ""}
                            onClick={() => setType(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="search-sort">
                        <label className="search">
                          <Search size={16} />
                          <input
                            ref={searchInput}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files…"
                            aria-label="Search files"
                          />
                          <kbd>⌘ K</kbd>
                        </label>
                        <label className="sort-control">
                          <SlidersHorizontal size={16} />
                          <select
                            aria-label="Sort files"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="newest">Newest</option>
                            <option value="name">Name</option>
                            <option value="size">Size</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    {canEdit && selected.length > 0 && (
                      <div className="selection-bar">
                        <span>{selected.length} selected</span>
                        <button
                          className="text-button danger"
                          onClick={() => void deleteFiles(selected)}
                        >
                          <Trash2 size={14} />
                          Delete selected
                        </button>
                      </div>
                    )}
                    {folders.length > 0 && (
                      <div className="folder-grid">
                        {folders.map((f) => (
                          <div className="folder-card" key={f.id}>
                            <button
                              className="folder-open"
                              onClick={() =>
                                router.push(`/files?folder=${f.id}`)
                              }
                            >
                              <FolderOpen size={24} />
                              <strong>{f.name}</strong>
                            </button>
                            {canEdit && (
                              <div>
                                <button
                                  className="icon-button"
                                  aria-label={`Rename ${f.name}`}
                                  onClick={async () => {
                                    const name = window.prompt(
                                      "Folder name",
                                      f.name,
                                    );
                                    if (!name) return;
                                    try {
                                      await api(`v1/folders/${f.id}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({ name }),
                                      });
                                      await loadFiles();
                                    } catch (e) {
                                      notify((e as Error).message);
                                    }
                                  }}
                                >
                                  <Settings2 size={13} />
                                </button>
                                <button
                                  className="icon-button danger"
                                  aria-label={`Delete folder ${f.name}`}
                                  onClick={async () => {
                                    if (
                                      !window.confirm(
                                        "Delete this empty folder?",
                                      )
                                    )
                                      return;
                                    try {
                                      await api(`v1/folders/${f.id}`, {
                                        method: "DELETE",
                                      });
                                      await loadFiles();
                                    } catch (e) {
                                      notify((e as Error).message);
                                    }
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {loading && files.length === 0 ? (
                      <div className="empty-state">
                        <Loader2 className="spin" />
                        <p>Loading your files…</p>
                      </div>
                    ) : sortedFiles.length === 0 ? (
                      <>
                        <div className="table-header">
                          <span>
                            File name <ArrowDown size={12} />
                          </span>
                          <span>Size</span>
                          <span>Visibility</span>
                          <span>Uploaded</span>
                        </div>
                        <div className="empty-state">
                          <div className="empty-illustration">
                            <span className="empty-file left">
                              <FileImage size={28} />
                            </span>
                            <span className="empty-file right">
                              <FileCode2 size={26} />
                            </span>
                            <span className="empty-folder">
                              <FolderOpen size={43} strokeWidth={1.2} />
                            </span>
                          </div>
                          <h3>
                            {search || type !== "all"
                              ? "No matching files"
                              : "No files in this folder yet"}
                          </h3>
                          <p>
                            {search || type !== "all"
                              ? "Try another search or select a different file type."
                              : canEdit
                                ? "Upload a file here, or create a folder to keep things organized."
                                : "There are no files in this folder yet."}
                          </p>
                          {(search || type !== "all" || canEdit) && (
                            <button
                              className="button secondary"
                              onClick={() => {
                                if (search || type !== "all") {
                                  setSearch("");
                                  setType("all");
                                } else if (requireUser()) {
                                  setQueue([]);
                                  setUploadOpen(true);
                                }
                              }}
                            >
                              {search || type !== "all" ? (
                                "Clear filters"
                              ) : (
                                <>
                                  <Upload size={15} />
                                  Upload your first file
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </>
                    ) : grid ? (
                      <div className="file-grid">
                        {sortedFiles.map((f) => (
                          <article className="file-card" key={f.id}>
                            <div className="file-card-preview">
                              <FileIcon type={f.contentType} />
                              <span
                                className={`badge ${f.visibility === "public" ? "success" : "neutral"}`}
                              >
                                {f.visibility}
                              </span>
                            </div>
                            <strong title={f.name}>{f.name}</strong>
                            <small>
                              {size(f.size)} · {date(f.createdAt)}
                            </small>
                            <div className="file-card-actions">
                              {canEdit && (
                                <button
                                  className="icon-button"
                                  aria-label={`Move ${f.name}`}
                                  onClick={() => setMovingFile(f)}
                                >
                                  <FolderOpen size={15} />
                                </button>
                              )}
                              <button
                                className="text-button"
                                onClick={() => void copy(f.url)}
                              >
                                <Copy size={13} />
                                Copy URL
                              </button>
                              <a
                                className="icon-button"
                                href={`/api/v1/files/${f.id}/download`}
                                aria-label={`Download ${f.name}`}
                              >
                                <ArrowDownToLine size={15} />
                              </a>
                              {canEdit && (
                                <button
                                  className="icon-button danger"
                                  aria-label={`Delete ${f.name}`}
                                  onClick={() => void deleteFiles([f.id])}
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>
                                <input
                                  type="checkbox"
                                  aria-label="Select all files"
                                  disabled={!canEdit}
                                  checked={
                                    files.length > 0 &&
                                    selected.length === files.length
                                  }
                                  onChange={(e) =>
                                    setSelected(
                                      e.target.checked
                                        ? files.map((f) => f.id)
                                        : [],
                                    )
                                  }
                                />
                              </th>
                              <th>File name</th>
                              <th>Size</th>
                              <th>Visibility</th>
                              <th>Uploaded</th>
                              <th>
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedFiles.map((f) => (
                              <tr key={f.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${f.name}`}
                                    disabled={!canEdit}
                                    checked={selected.includes(f.id)}
                                    onChange={(e) =>
                                      setSelected((s) =>
                                        e.target.checked
                                          ? [...s, f.id]
                                          : s.filter((id) => id !== f.id),
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  <div className="file-name">
                                    <FileIcon type={f.contentType} />
                                    <span>
                                      <strong title={f.name}>{f.name}</strong>
                                      <small>{f.source}</small>
                                    </span>
                                  </div>
                                </td>
                                <td className="nowrap">{size(f.size)}</td>
                                <td>
                                  <span
                                    className={`badge ${f.visibility === "public" ? "success" : "neutral"}`}
                                  >
                                    {f.visibility === "public" ? (
                                      <Globe2 size={11} />
                                    ) : (
                                      <LockKeyhole size={11} />
                                    )}{" "}
                                    {f.visibility}
                                  </span>
                                </td>
                                <td className="nowrap">{date(f.createdAt)}</td>
                                <td>
                                  <div className="row-actions">
                                    {canEdit && (
                                      <button
                                        className="icon-button"
                                        aria-label={`Move ${f.name}`}
                                        onClick={() => setMovingFile(f)}
                                      >
                                        <FolderOpen size={15} />
                                      </button>
                                    )}
                                    <button
                                      className="icon-button"
                                      onClick={() => void copy(f.url)}
                                      aria-label={`Copy URL for ${f.name}`}
                                    >
                                      <Copy size={15} />
                                    </button>
                                    <a
                                      className="icon-button"
                                      href={`/api/v1/files/${f.id}/download`}
                                      aria-label={`Download ${f.name}`}
                                    >
                                      <ArrowDownToLine size={15} />
                                    </a>
                                    {canEdit && (
                                      <button
                                        className="icon-button danger"
                                        aria-label={`Delete ${f.name}`}
                                        onClick={() => void deleteFiles([f.id])}
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="table-footer">
                      <span>
                        {files.length} file{files.length === 1 ? "" : "s"}
                        {search ? " matching your search" : " in this view"}
                      </span>
                      {cursor ? (
                        <button
                          className="button small secondary"
                          disabled={loading}
                          onClick={() => void loadFiles(cursor)}
                        >
                          Load more
                          <ChevronDown size={13} />
                        </button>
                      ) : (
                        <span>
                          <ShieldCheck size={13} />
                          Stored on your infrastructure
                        </span>
                      )}
                    </div>
                  </section>
                  <aside className="library-aside">
                    <section className="panel storage-panel">
                      <div className="panel-title">
                        <h2>File breakdown</h2>
                        <HardDrive size={16} />
                      </div>
                      <div className="storage-ring">
                        <svg viewBox="0 0 160 160" aria-hidden="true">
                          <circle
                            cx="80"
                            cy="80"
                            r="64"
                            fill="none"
                            stroke="#eeedf4"
                            strokeWidth="13"
                          />
                          {(() => {
                            let offset = 0;
                            const colors = [
                              "#8170dc",
                              "#64b8bb",
                              "#e8af77",
                              "#8aa6d5",
                              "#b7a0ce",
                            ];
                            return (stats?.types || []).map((t, i) => {
                              const ratio =
                                  t.bytes /
                                  Math.max(stats?.totals.bytes || 1, 1),
                                start = offset;
                              offset += ratio;
                              return (
                                <circle
                                  key={t._id}
                                  cx="80"
                                  cy="80"
                                  r="64"
                                  fill="none"
                                  stroke={colors[i % 5]}
                                  strokeWidth="13"
                                  strokeDasharray={`${ratio * 402} 402`}
                                  strokeDashoffset={-start * 402}
                                  transform="rotate(-90 80 80)"
                                />
                              );
                            });
                          })()}
                        </svg>
                        <div>
                          <strong>
                            {stats ? size(stats.totals.bytes) : "0 B"}
                          </strong>
                          <span>Total storage</span>
                        </div>
                      </div>
                      <div className="storage-legend">
                        {[
                          ["image", "Images", "#8170dc"],
                          ["video", "Videos", "#64b8bb"],
                          ["application", "Documents", "#e8af77"],
                          ["audio", "Audio", "#8aa6d5"],
                          ["other", "Other", "#b7a0ce"],
                        ].map(([id, label, color]) => {
                          const bytes = (stats?.types || [])
                            .filter((t) =>
                              id === "other"
                                ? ![
                                    "image",
                                    "video",
                                    "application",
                                    "audio",
                                  ].includes(t._id)
                                : t._id === id,
                            )
                            .reduce((n, t) => n + t.bytes, 0);
                          return (
                            <div key={id}>
                              <span>
                                <i style={{ background: color }} />
                                {label}
                              </span>
                              <strong>{size(bytes)}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    <section className="api-promo">
                      <span className="promo-icon">
                        <Terminal size={21} />
                      </span>
                      <h3>Your apps. Your CDN.</h3>
                      <p>
                        Upload directly from any application with a scoped API
                        key.
                      </p>
                      <button onClick={() => navigate("API keys")}>
                        Explore API keys
                        <ArrowRight size={15} />
                      </button>
                      <div className="code-peek">
                        <span>POST</span> /api/v1/uploads
                      </div>
                    </section>
                    <div className="privacy-note">
                      <ShieldCheck size={17} />
                      <p>
                        Your files stay yours.
                        <br />
                        <span>Private by default. Shared by choice.</span>
                      </p>
                    </div>
                  </aside>
                </div>
              )}
            </>
          )}
          {view === "API keys" && (
            <section className="panel">
              <div className="panel-title">
                <h2>Application credentials</h2>
                <span className="badge neutral">Secrets shown once</span>
              </div>
              {keys.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-symbol">
                    <KeyRound size={31} />
                  </span>
                  <h3>A secure connection to your apps</h3>
                  <p>
                    Create a key with upload, read, or delete permissions.
                    <br />
                    Set an expiration and a request limit for every integration.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      if (requireUser()) {
                        setKeySecret("");
                        setKeyOpen(true);
                      }
                    }}
                  >
                    <Plus size={16} />
                    Create your first key
                  </button>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name & prefix</th>
                        <th>Permissions</th>
                        <th>Usage</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.id}>
                          <td>
                            <strong>{k.name}</strong>
                            <small className="block mono">
                              {k.prefix}••••••••
                            </small>
                          </td>
                          <td>
                            <div className="scope-list">
                              {k.scopes.map((s) => (
                                <span className="badge neutral" key={s}>
                                  {s.replace("files:", "")}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            {k.requests.toLocaleString()} /{" "}
                            {k.maxRequests.toLocaleString()}
                          </td>
                          <td>{k.expiresAt ? date(k.expiresAt) : "Never"}</td>
                          <td>
                            <span
                              className={`badge ${k.revokedAt || (k.expiresAt !== null && new Date(k.expiresAt) < new Date()) || k.requests >= k.maxRequests ? "neutral" : "success"}`}
                            >
                              {k.revokedAt
                                ? "Revoked"
                                : k.expiresAt !== null &&
                                    new Date(k.expiresAt) < new Date()
                                  ? "Expired"
                                  : k.requests >= k.maxRequests
                                    ? "Exhausted"
                                    : "Active"}
                            </span>
                          </td>
                          <td>
                            {!k.revokedAt && (
                              <button
                                className="text-button danger"
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      "Revoke this API key immediately?",
                                    )
                                  )
                                    return;
                                  try {
                                    await api(`keys/${k.id}`, {
                                      method: "DELETE",
                                    });
                                    await loadView();
                                    await refresh();
                                    notify("API key revoked.");
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="panel-notice">
                <ShieldCheck size={16} />
                <span>
                  API keys are stored as hashes. Each key can access only the
                  files it uploads.
                </span>
              </div>
            </section>
          )}
          {view === "Team members" && (
            <section className="panel">
              <div className="panel-title">
                <h2>People in your workspace</h2>
                <span className="badge neutral">Invite-only access</span>
              </div>
              {members.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-symbol">
                    <Users size={31} />
                  </span>
                  <h3>Better, together</h3>
                  <p>Invite your team with access that fits their role.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (requireUser()) setInviteOpen(true);
                    }}
                  >
                    Invite a member
                    <Plus size={15} />
                  </button>
                </div>
              ) : (
                <div className="member-list">
                  {members.map((m) => (
                    <div className="member-row" key={m.id}>
                      <span className="avatar">{m.email[0].toUpperCase()}</span>
                      <div>
                        <strong>{m.email}</strong>
                        <small>
                          {m.role === "owner"
                            ? "Workspace owner"
                            : m.disabledAt
                              ? "Access disabled"
                              : "Verified member"}
                        </small>
                      </div>
                      <span
                        className={`badge ${m.disabledAt ? "neutral" : "purple-badge"}`}
                      >
                        {m.role}
                      </span>
                      {!m.disabledAt &&
                        m.role !== "owner" &&
                        m.email !== user?.email && (
                          <button
                            className="icon-button danger"
                            aria-label={`Disable ${m.email}`}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Disable access for ${m.email}?`,
                                )
                              )
                                return;
                              try {
                                await api(`team/${m.id}`, { method: "DELETE" });
                                await loadView();
                                notify("Member access disabled.");
                              } catch (e) {
                                notify((e as Error).message);
                              }
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                    </div>
                  ))}
                  {pending.map((i) => (
                    <div className="member-row" key={i.id}>
                      <span className="avatar pending-avatar">
                        {i.email[0].toUpperCase()}
                      </span>
                      <div>
                        <strong>{i.email}</strong>
                        <small>
                          Invitation pending · expires {date(i.expiresAt)}
                        </small>
                      </div>
                      <span className="badge neutral">{i.role}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="panel-notice">
                <LockKeyhole size={16} />
                <span>
                  Every member must verify their email with an OTP before
                  signing in.
                </span>
              </div>
            </section>
          )}
          {view === "Activity log" && (
            <section className="panel">
              <div className="panel-title">
                <h2>Workspace activity</h2>
                <button className="text-button" onClick={() => void loadView()}>
                  Refresh
                  <Activity size={14} />
                </button>
              </div>
              {events.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-symbol">
                    <Activity size={31} />
                  </span>
                  <h3>A record you can follow</h3>
                  <p>
                    Sign-ins, uploads, key changes, and team activity will
                    appear here.
                  </p>
                </div>
              ) : (
                <div className="event-list">
                  {events.map((e, i) => (
                    <div className="event-row" key={i}>
                      <span className="event-dot">
                        <Activity size={16} />
                      </span>
                      <div>
                        <strong>{e.action}</strong>
                        <span>{e.target}</span>
                        <small>{e.actor}</small>
                      </div>
                      <time>{new Date(e.createdAt).toLocaleString()}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === "Storage settings" && user?.activeWorkspace && (
            <StorageSettings workspaceId={user.activeWorkspace.id} />
          )}
          {view === "Settings" && user && (
            <ProfileSettings
              user={user}
              onUpdated={(name) => setUser((u) => (u ? { ...u, name } : u))}
            />
          )}
          {view === "Documentation" && (
            <ApiDocumentation canUpload={!!canEdit} />
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-mark">A</span>Arionys CDN{" "}
              <span className="footer-dot">·</span> Built for what’s next.
            </span>
            <span>
              <ShieldCheck size={13} />
              Your infrastructure. Your control.
            </span>
          </footer>
        </div>
      </main>
      <input
        className="sr-only"
        ref={input}
        type="file"
        multiple
        aria-label="Choose files to upload"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {movingFile && (
        <MoveFileDialog
          file={movingFile}
          onClose={() => setMovingFile(null)}
          onMoved={() => {
            setMovingFile(null);
            void loadFiles();
            notify("File moved.");
          }}
        />
      )}
      {folderOpen && (
        <Modal
          title="Create a folder"
          description="Keep related files together. Open any folder to add subfolders."
          onClose={() => {
            if (!busy) setFolderOpen(false);
          }}
        >
          <form
            method="post"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const data = new FormData(e.currentTarget);
                await api("v1/folders", {
                  method: "POST",
                  body: JSON.stringify({
                    name: data.get("name"),
                    parentId: folderId,
                  }),
                });
                setFolderOpen(false);
                await loadFiles();
                notify("Folder created.");
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Folder name
              <input
                name="name"
                required
                maxLength={100}
                placeholder="e.g. Brand assets"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Create folder
            </button>
          </form>
        </Modal>
      )}
      {uploadOpen && (
        <Modal
          title="Upload files"
          description="Choose your files and visibility. Uploads go to this workspace’s own storage."
          onClose={() => {
            if (!busy) setUploadOpen(false);
          }}
        >
          <div
            className="modal-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) addFiles(e.dataTransfer.files);
            }}
          >
            <Upload size={27} />
            <strong>Drag files here</strong>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              or choose from your device
            </button>
          </div>
          <div className="upload-queue">
            {queue.map((item, i) => (
              <div className="upload-item" key={`${i}-${item.file.name}`}>
                <FileIcon type={item.file.type} />
                <div>
                  <strong>{item.file.name}</strong>
                  <small>
                    {size(item.file.size)} · {item.state}
                    {item.progress > 0 ? ` · ${item.progress}%` : ""}
                  </small>
                  <span
                    className="progress-track"
                    role="progressbar"
                    aria-label={`Upload progress for ${item.file.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.progress}
                  >
                    <i style={{ width: `${item.progress}%` }} />
                  </span>
                </div>
                {item.state === "Uploaded" ? (
                  <Check size={18} className="green-text" />
                ) : !busy ? (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                  >
                    <X size={15} />
                  </button>
                ) : (
                  <Loader2 size={17} className="spin" />
                )}
              </div>
            ))}
          </div>
          <label>
            File visibility
            <select
              value={visibility}
              disabled={busy}
              onChange={(e) => setVisibility(e.target.value)}
            >
              <option value="private">
                Private — verified workspace members only
              </option>
              <option value="public">
                Public — anyone with the URL can read
              </option>
            </select>
          </label>
          {visibility === "public" && (
            <p className="visibility-note">
              <Globe2 size={15} />
              Public files can be accessed without signing in.
            </p>
          )}
          <button
            className="button primary full"
            disabled={busy || !queue.some((q) => q.state !== "Uploaded")}
            onClick={() => void uploadAll()}
          >
            {busy ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Upload size={17} />
            )}{" "}
            {busy
              ? "Uploading & verifying…"
              : `Upload ${queue.filter((q) => q.state !== "Uploaded").length} files`}
          </button>
        </Modal>
      )}
      {keyOpen && (
        <Modal
          title={keySecret ? "Your API key is ready" : "Create an API key"}
          description={
            keySecret
              ? "Copy it now. You will not be able to see this secret again."
              : "Give each application its own permissions and limits."
          }
          onClose={() => {
            if (!busy) {
              setKeyOpen(false);
              setKeySecret("");
            }
          }}
        >
          {keySecret ? (
            <>
              <div className="secret-box">
                <code>{keySecret}</code>
                <button
                  className="icon-button"
                  aria-label="Copy API key"
                  onClick={() => void copy(keySecret)}
                >
                  <Copy size={18} />
                </button>
              </div>
              <div className="panel-notice">
                <ShieldCheck size={18} />
                <span>
                  Store this key in your application’s server environment. Never
                  put it in public code.
                </span>
              </div>
              <button
                className="button primary full"
                onClick={() => {
                  setKeyOpen(false);
                  setKeySecret("");
                }}
              >
                I’ve saved my key
                <Check size={17} />
              </button>
            </>
          ) : (
            <form method="post" onSubmit={createKey}>
              <label>
                Key name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="e.g. Portfolio website"
                />
              </label>
              <fieldset>
                <legend>Permissions</legend>
                {[
                  [
                    "files:read",
                    "Read files",
                    "List and download this key’s files.",
                  ],
                  [
                    "files:upload",
                    "Upload files",
                    "Create uploads and retrieve their URLs.",
                  ],
                  [
                    "files:delete",
                    "Delete files",
                    "Permanently remove this key’s files.",
                  ],
                ].map(([scope, label, description]) => (
                  <label className="permission-option" key={scope}>
                    <input
                      type="checkbox"
                      checked={keyScopes.includes(scope)}
                      onChange={(e) =>
                        setKeyScopes((s) =>
                          e.target.checked
                            ? [...s, scope]
                            : s.filter((v) => v !== scope),
                        )
                      }
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="form-grid">
                <label>
                  Expires after
                  <select name="days" defaultValue="30">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="never">Never</option>
                  </select>
                </label>
                <label>
                  Total request limit
                  <input
                    name="requests"
                    type="number"
                    min="1"
                    max="10000000"
                    defaultValue="10000"
                    required
                  />
                </label>
              </div>
              <label>
                Maximum file size (MB)
                <input
                  name="mb"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="100"
                  required
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || keyScopes.length === 0}
              >
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <KeyRound size={17} />
                )}
                Create API key
              </button>
            </form>
          )}
        </Modal>
      )}
      {inviteOpen && (
        <Modal
          title="Invite a team member"
          description="They’ll receive an invitation and verify their email before getting access."
          onClose={() => {
            if (!busy) setInviteOpen(false);
          }}
        >
          <form method="post" onSubmit={inviteMember}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@example.com"
              />
            </label>
            <label>
              Workspace role
              <select name="role" defaultValue="editor">
                <option value="viewer">
                  Viewer — browse and download files
                </option>
                <option value="editor">
                  Editor — upload, delete, and manage own API keys
                </option>
                {user?.role === "owner" && (
                  <option value="admin">
                    Admin — manage files and team members
                  </option>
                )}
              </select>
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Users size={17} />
              )}
              Send invitation
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
