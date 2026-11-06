import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { dispatch } from "@/lib/api";
import { ApiError } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const result = await dispatch(req, (await context.params).path);
    if (result instanceof Response) return result;
    return Response.json(
      { data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof ApiError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 503;
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof ZodError
          ? "Check the entered values and try again."
          : "The service is temporarily unavailable. Please try again.";
    // Do not log upstream errors: connection strings, signed URLs and email secrets can be embedded.
    return Response.json(
      { error: message },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(status === 429 ? { "Retry-After": "60" } : {}),
        },
      },
    );
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as PATCH,
  handler as OPTIONS,
};
