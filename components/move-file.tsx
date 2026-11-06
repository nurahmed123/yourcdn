"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, ChevronRight, Loader2, X } from "lucide-react";
import { api } from "./client";
export function MoveFileDialog({
  file,
  onClose,
  onMoved,
}: {
  file: { id: string; name: string };
  onClose: () => void;
  onMoved: () => void;
}) {
  const [parent, setParent] = useState<string | null>(null),
    [data, setData] = useState<any>({ folders: [], breadcrumbs: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const items = Array.from(
        dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled)"),
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
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);
  useEffect(() => {
    let active = true;
    api(`v1/folders${parent ? `?parentId=${parent}` : ""}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [parent]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Move file"
      >
        <button
          className="icon-button close-modal"
          aria-label="Close move dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <h2>Move file</h2>
        <p className="modal-description">
          Choose a folder for {file.name}. The file URL stays the same.
        </p>
        <div className="folder-breadcrumbs">
          <button onClick={() => setParent(null)}>All files</button>
          {data.breadcrumbs.map((f: any) => (
            <span key={f.id}>
              <ChevronRight size={13} />
              <button onClick={() => setParent(f.id)}>{f.name}</button>
            </span>
          ))}
        </div>
        <div className="folder-picker-list">
          {data.folders.map((f: any) => (
            <button key={f.id} onClick={() => setParent(f.id)}>
              <FolderOpen size={19} />
              {f.name}
              <ChevronRight size={15} />
            </button>
          ))}
          {!data.folders.length && <p>No subfolders here.</p>}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="button primary full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`v1/files/${file.id}`, {
                method: "PATCH",
                body: JSON.stringify({ folderId: parent }),
              });
              onMoved();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <FolderOpen size={16} />
          )}
          Move here
        </button>
      </div>
    </div>
  );
}
