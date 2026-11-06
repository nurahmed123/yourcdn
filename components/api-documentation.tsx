"use client";
import { useState } from "react";
import { uploadFile, type UploadResult } from "./upload-file";

const browserExample = `function upload(file, onProgress, onStatus) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Your authenticated backend forwards this one request to YourCDN.
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round(event.loaded / event.total * 100));
      }
    };
    xhr.upload.onload = () => onStatus("Processing…");
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        onStatus("Uploaded");
        resolve(data); // { url, name, size }
      } else reject(new Error(data.error));
    };
    xhr.onerror = () => reject(new Error("Connection interrupted"));
    const form = new FormData();
    form.append("file", file);
    form.append("visibility", "public");
    xhr.send(form); // Browser sets the multipart boundary automatically.
  });
}

// Animate your progress bar as bytes are sent:
// bar.style.transition = "width 180ms ease";
// upload(file, percent => {
//   bar.style.width = percent + "%";
//   label.textContent = percent + "%";
// });`;
const serverExample = `// Your application's authenticated Node.js upload handler.
// Check your own user's session and upload permission BEFORE forwarding.
const upstream = await fetch(
  process.env.YOURCDN_URL + "/api/v1/upload",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.YOURCDN_API_KEY,
      "Content-Type": request.headers.get("content-type"),
    },
    body: request.body,
    duplex: "half",
    signal: request.signal,
  }
);
return new Response(upstream.body, {
  status: upstream.status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
});`;
export function ApiDocumentation({
  canUpload = true,
}: {
  canUpload?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Choose a file to try a real upload.");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  return (
    <div className="docs-layout">
      <section className="panel docs">
        <div className="panel-title">
          <h2>One request. Your file URL.</h2>
          <span className="badge purple-badge">POST /api/v1/upload</span>
        </div>
        <p>
          Send a file. We upload and verify it in your workspace’s storage, then
          return its URL, name, and size. No reservation or completion requests.
        </p>
        <h3>Upload from your server</h3>
        <pre>{`curl -X POST "$YOURCDN_URL/api/v1/upload" \\
  -H "Authorization: Bearer $YOURCDN_API_KEY" \\
  -F "file=@photo.jpg" \\
  -F "visibility=public"`}</pre>
        <h3>Response · 201 Created</h3>
        <pre>{`{
  "url": "https://cdn.example.com/api/v1/content/FILE_ID",
  "name": "photo.jpg",
  "size": 12345
}`}</pre>
        <p>
          Size is in bytes. Private is the default visibility; use public for a
          URL anyone can open. Optional folderPath stores the file in a folder,
          such as website/images. Folder details are never added to this
          response.
        </p>
        <h3>Try an upload</h3>
        <p>
          {canUpload
            ? "This uploads a private file to your current workspace using your signed-in account."
            : "Your viewer role can read files but cannot upload. Ask a workspace editor or admin for upload access."}
        </p>
        <label>
          Choose file
          <input
            type="file"
            disabled={busy || !canUpload}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              setBusy(true);
              setResult(null);
              setProgress(0);
              setStatus("Uploading…");
              try {
                const data = await uploadFile(
                  file,
                  { requestId: crypto.randomUUID() },
                  (percent, processing) => {
                    setProgress(percent);
                    setStatus(
                      processing
                        ? "Processing…"
                        : percent === 100
                          ? "Uploaded"
                          : "Uploading…",
                    );
                  },
                );
                setResult(data);
              } catch (error) {
                setStatus((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <div
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="api-progress"
        >
          <div style={{ width: `${progress}%` }} />
        </div>
        <p role="status">
          {status} {progress > 0 && `${progress}%`}
        </p>
        {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
        <h3>Show progress in your application</h3>
        <p>
          Use XMLHttpRequest to measure bytes sent. Keep a Processing state
          after the transfer reaches 100%; the file is ready when the JSON
          response arrives. Keep the API key on your server.
        </p>
        <pre>{browserExample}</pre>
        <h3>Forward from your authenticated backend</h3>
        <p>
          After checking your application’s session and upload permissions,
          forward the body as a stream. Store YOURCDN_API_KEY and YOURCDN_URL in
          server environment variables.
        </p>
        <pre>{serverExample}</pre>
      </section>
      <aside className="panel docs-aside">
        <h3>Upload contract</h3>
        <p>
          One multipart file per request. Required API permission:{" "}
          <code>files:upload</code>.
        </p>
        <h3>Optional fields</h3>
        <p>
          <code>visibility</code>: private or public.
        </p>
        <p>
          <code>folderPath</code> or <code>folderId</code>: destination folder.
        </p>
        <p>
          <code>requestId</code>: a UUID. Reuse it when retrying the same file
          to avoid duplicates. Alternatively send an Idempotency-Key header.
        </p>
        <h3>Retries</h3>
        <p>
          A successful retry returns the same three fields with status 200.
          Reusing an ID for different contents returns 409.
        </p>
        <h3>Limits & errors</h3>
        <p>
          Workspace role, API key expiry, request quota, and file size limits
          apply. Local Node hosting allows up to 100 MB by default; Vercel
          hosting limits this endpoint to 4 MB per file. Larger files need
          hosting with a larger request limit.
        </p>
        <pre>{`{ "error": "Reason for failure" }`}</pre>
      </aside>
    </div>
  );
}
