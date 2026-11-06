import { beginRequest } from "./request-progress";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const finish = beginRequest();
  try {
    const response = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const result = await response.json();
    if (!response.ok)
      throw new HttpError(
        response.status,
        result.error || "Request failed. Try again.",
      );
    return result.data;
  } finally {
    finish();
  }
}
