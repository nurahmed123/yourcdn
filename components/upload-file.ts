import { beginRequest } from "./request-progress";
export type UploadResult = { url: string; name: string; size: number };
export function uploadFile(
  file: File,
  options: { visibility?: string; folderId?: string | null; requestId: string },
  onProgress: (percent: number, processing: boolean) => void,
) {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/upload");
    const finish = beginRequest();
    xhr.onloadend = finish;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(
          Math.min(99, Math.round((e.loaded / e.total) * 100)),
          e.loaded === e.total,
        );
    };
    xhr.upload.onload = () => onProgress(99, true);
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw new Error(result.error || "Upload failed. Please retry.");
        onProgress(100, false);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () =>
      reject(new Error("Upload interrupted. Check your connection and retry."));
    const form = new FormData();
    form.append("file", file);
    form.append("visibility", options.visibility || "private");
    form.append("requestId", options.requestId);
    if (options.folderId) form.append("folderId", options.folderId);
    xhr.send(form);
  });
}
